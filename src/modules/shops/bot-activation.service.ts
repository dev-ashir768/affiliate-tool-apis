import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { encryptVault } from "../../lib/crypto.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

/**
 * In-portal bot activation: a server-side Chromium the merchant drives through
 * screenshots + forwarded input, so they sign in to TikTok as their bot (solving
 * any captcha themselves) and we keep the resulting session. Login is never
 * automated here — we only relay what the person does.
 */

const VIEWPORT = { width: 1280, height: 800 };
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 3;

type CdpSession = {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  on: (event: string, handler: (payload: Record<string, unknown>) => void) => void;
  detach: () => Promise<void>;
};
type Route = {
  request: () => { url: () => string };
  abort: (code?: string) => Promise<void>;
  continue: () => Promise<void>;
};
type Page = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  url: () => string;
  isClosed: () => boolean;
  on: (event: "close", handler: () => void) => void;
  close: () => Promise<void>;
};
type Context = {
  newPage: () => Promise<Page>;
  pages: () => Page[];
  newCDPSession: (page: Page) => Promise<CdpSession>;
  route: (pattern: string, handler: (route: Route) => Promise<void>) => Promise<void>;
  on: (event: "page", handler: (page: Page) => void) => void;
  storageState: () => Promise<unknown>;
  close: () => Promise<void>;
};
type Browser = {
  newContext: (opts: Record<string, unknown>) => Promise<Context>;
  close: () => Promise<void>;
};

type Session = {
  id: string;
  shopId: string;
  organizationId: string;
  botId: string;
  browser: Browser;
  context: Context;
  page: Page;
  cdp: CdpSession | null;
  frame: Buffer | null;
  frameSeq: number;
  lastActivity: number;
  timer: ReturnType<typeof setInterval>;
};

const sessions = new Map<string, Session>();

/* ── outbound request guard (no reaching the server's own network) ── */

export function isPrivateAddress(ip: string): boolean {
  if (ip === "::1" || ip === "::" || ip.startsWith("fe80:") || /^f[cd]/i.test(ip)) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

const hostVerdicts = new Map<string, { ok: boolean; at: number }>();

export async function hostAllowed(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return false;
  }
  const cached = hostVerdicts.get(host);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.ok;
  let ok: boolean;
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    ok = false;
  }
  hostVerdicts.set(host, { ok, at: Date.now() });
  return ok;
}

/** Only standard web ports, so the server's own public IP can't reach API/DB/Redis ports. */
export async function urlAllowed(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return true;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.port && url.port !== "443" && url.port !== "80") return false;
  return hostAllowed(url.hostname);
}

async function guardRoute(route: Route) {
  if (await urlAllowed(route.request().url())) return route.continue();
  return route.abort("blockedbyclient");
}

/* ── session helpers ── */

async function launchBrowser(): Promise<Browser> {
  try {
    const playwright = await import("playwright");
    return (await playwright.chromium.launch({ headless: true })) as unknown as Browser;
  } catch (err) {
    logger.error("bot activation: chromium launch failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Bot sign-in isn't available right now. Please try again later.",
      503,
    );
  }
}

async function attachScreencast(session: Session, page: Page) {
  if (session.cdp) await session.cdp.detach().catch(() => undefined);
  session.page = page;
  const cdp = await session.context.newCDPSession(page);
  session.cdp = cdp;
  cdp.on("Page.screencastFrame", (payload) => {
    session.frame = Buffer.from(String(payload.data), "base64");
    session.frameSeq += 1;
    void cdp
      .send("Page.screencastFrameAck", { sessionId: payload.sessionId })
      .catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 60,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  });
}

function touch(session: Session) {
  session.lastActivity = Date.now();
}

async function closeSession(session: Session, reason: string) {
  sessions.delete(session.id);
  clearInterval(session.timer);
  await session.cdp?.detach().catch(() => undefined);
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
  logger.info("bot activation session closed", { shopId: session.shopId, reason });
}

async function ownedBotForShop(organizationId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, organizationId },
    include: { botIdentity: true },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
  const bot = shop.botIdentity;
  if (!bot || bot.ownerOrganizationId !== organizationId) {
    throw new AppError("NOT_FOUND", "This shop has no bot to activate", 404);
  }
  if (shop.status === "DISCONNECTED") {
    throw new AppError("CONFLICT", "Reconnect the shop before activating its bot", 409);
  }
  return { shop, bot };
}

function sessionFor(organizationId: string, shopId: string): Session {
  for (const s of sessions.values()) {
    if (s.organizationId === organizationId && s.shopId === shopId) return s;
  }
  throw new AppError(
    "NOT_FOUND",
    "Sign-in window closed. Start bot activation again.",
    404,
  );
}

/* ── public API ── */

export async function startBotActivation(organizationId: string, shopId: string) {
  const { shop, bot } = await ownedBotForShop(organizationId, shopId);

  for (const s of [...sessions.values()]) {
    if (s.organizationId === organizationId) await closeSession(s, "replaced");
  }
  if (sessions.size >= MAX_SESSIONS) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Bot sign-in is busy. Please try again in a few minutes.",
      503,
    );
  }

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      acceptDownloads: false,
      locale: shop.region === "UK" ? "en-GB" : "en-US",
    });
    await context.route("**/*", guardRoute);
    const page = await context.newPage();

    const session: Session = {
      id: randomUUID(),
      shopId,
      organizationId,
      botId: bot.id,
      browser,
      context,
      page,
      cdp: null,
      frame: null,
      frameSeq: 0,
      lastActivity: Date.now(),
      timer: setInterval(() => {
        if (Date.now() - session.lastActivity > IDLE_TIMEOUT_MS) {
          void closeSession(session, "idle");
        }
      }, 30_000),
    };
    sessions.set(session.id, session);

    // Sign-in flows often open a popup; always stream the newest live tab.
    context.on("page", (p) => {
      void attachScreencast(session, p).catch(() => undefined);
      p.on("close", () => {
        const next = context.pages().filter((x) => !x.isClosed()).at(-1);
        if (next && session.page === p) void attachScreencast(session, next).catch(() => undefined);
      });
    });

    await attachScreencast(session, page);
    const loginUrl =
      shop.region === "UK" ? env.SHOP_VERIFY_LOGIN_URL_UK : env.SHOP_VERIFY_LOGIN_URL_US;
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);

    logger.info("bot activation session started", { shopId });
    return { width: VIEWPORT.width, height: VIEWPORT.height, botEmail: bot.email };
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
}

/** Latest screen as a JPEG data URL, or null when nothing changed since `afterSeq`. */
export function getActivationFrame(
  organizationId: string,
  shopId: string,
  afterSeq: number,
): { seq: number; image: string } | null {
  const session = sessionFor(organizationId, shopId);
  touch(session);
  if (!session.frame || session.frameSeq <= afterSeq) return null;
  return {
    seq: session.frameSeq,
    image: `data:image/jpeg;base64,${session.frame.toString("base64")}`,
  };
}

export type ActivationInput =
  | { type: "mouse"; action: "down" | "up" | "move"; x: number; y: number; button?: "left" | "right" }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string };

const KEY_CODES: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Backspace: { code: "Backspace", keyCode: 8 },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
};

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(n)));
}

export async function sendActivationInput(
  organizationId: string,
  shopId: string,
  events: ActivationInput[],
) {
  const session = sessionFor(organizationId, shopId);
  touch(session);
  const cdp = session.cdp;
  if (!cdp) return;

  for (const e of events) {
    if (e.type === "mouse") {
      const button = e.button ?? "left";
      const mask = button === "right" ? 2 : 1;
      // A move carries a button only while dragging (e.g. a slider captcha).
      const params =
        e.action === "down"
          ? { type: "mousePressed", button, buttons: mask, clickCount: 1 }
          : e.action === "up"
            ? { type: "mouseReleased", button, buttons: 0, clickCount: 1 }
            : e.button
              ? { type: "mouseMoved", button, buttons: mask }
              : { type: "mouseMoved", button: "none", buttons: 0 };
      await cdp.send("Input.dispatchMouseEvent", {
        ...params,
        x: clamp(e.x, VIEWPORT.width),
        y: clamp(e.y, VIEWPORT.height),
      });
    } else if (e.type === "wheel") {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: clamp(e.x, VIEWPORT.width),
        y: clamp(e.y, VIEWPORT.height),
        deltaX: e.deltaX,
        deltaY: e.deltaY,
      });
    } else if (e.type === "text") {
      await cdp.send("Input.insertText", { text: e.text });
    } else if (e.type === "key") {
      const k = KEY_CODES[e.key];
      if (!k) continue;
      const base = { key: e.key, code: k.code, windowsVirtualKeyCode: k.keyCode };
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k.text ? { text: k.text } : {}) });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    }
  }
}

export async function completeBotActivation(
  organizationId: string,
  shopId: string,
  opts: { force?: boolean } = {},
) {
  const session = sessionFor(organizationId, shopId);
  touch(session);
  const { bot } = await ownedBotForShop(organizationId, shopId);
  const signedIn = !/\/(login|signin|sign-in|passport|account\/register)\b/i.test(
    session.page.url(),
  );
  if (!signedIn && !opts.force) {
    return { activated: false, looksSignedIn: false };
  }

  const storageState = await session.context.storageState();
  await prisma.botIdentity.update({
    where: { id: bot.id },
    data: {
      sessionVaultCiphertext: encryptVault(JSON.stringify(storageState)),
      sessionCapturedAt: new Date(),
    },
  });
  await closeSession(session, "completed");
  return { activated: true, looksSignedIn: signedIn };
}

export async function cancelBotActivation(organizationId: string, shopId: string) {
  for (const s of [...sessions.values()]) {
    if (s.organizationId === organizationId && s.shopId === shopId) {
      await closeSession(s, "cancelled");
    }
  }
}

export async function closeAllBotActivations() {
  await Promise.all([...sessions.values()].map((s) => closeSession(s, "shutdown")));
}
