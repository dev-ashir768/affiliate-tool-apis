import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { decryptVault, encryptVault } from "../lib/crypto.js";
import { waitForBotInviteIfConfigured } from "../lib/bot-inbox.js";
import { ShopVerifyTerminalError } from "./shop-verify.errors.js";
import {
  liveAcceptSelector,
  liveTimeoutMs,
  resolveLiveInviteUrl,
} from "./shop-verify.live.js";
import type { ShopVerifyJobData } from "./shop-verify.processor.js";

type PlaywrightPage = {
  goto: (
    url: string,
    opts?: { waitUntil?: string; timeout?: number }
  ) => Promise<unknown>;
  click: (selector: string, opts?: { timeout?: number }) => Promise<void>;
  waitForSelector: (
    selector: string,
    opts?: { timeout?: number }
  ) => Promise<unknown>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  url: () => string;
  waitForLoadState: (
    state: "load" | "domcontentloaded" | "networkidle",
    opts?: { timeout?: number }
  ) => Promise<void>;
  close: () => Promise<void>;
};

type PlaywrightContext = {
  newPage: () => Promise<PlaywrightPage>;
  storageState: () => Promise<unknown>;
  close: () => Promise<void>;
};

type PlaywrightBrowser = {
  newContext: (opts?: { storageState?: unknown }) => Promise<PlaywrightContext>;
  close: () => Promise<void>;
};

type PlaywrightChromium = {
  launch: (opts?: { headless?: boolean }) => Promise<PlaywrightBrowser>;
};

function defaultFixtureHref(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(
    here,
    "../../fixtures/shop-verify/invite-accept.html"
  );
  return pathToFileURL(fixturePath).href;
}

export function buildFixtureUrl(opts: {
  shopId: string;
  region: string;
  auto?: "accept" | "reject" | "expire";
}): string {
  const base = (env.SHOP_VERIFY_FIXTURE_URL?.trim() || defaultFixtureHref()).replace(
    /\/$/,
    ""
  );
  const url = new URL(base);
  url.searchParams.set("shopId", opts.shopId);
  url.searchParams.set("region", opts.region);
  if (opts.auto) url.searchParams.set("auto", opts.auto);
  return url.href;
}

async function readOutcome(page: PlaywrightPage): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.body as HTMLElement | null;
    return el?.dataset?.verifyResult ?? null;
  });
}

async function waitForOutcome(
  page: PlaywrightPage,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const outcome = await readOutcome(page);
    if (outcome) return outcome;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new ShopVerifyTerminalError("VERIFY_TIMEOUT");
}

async function launchChromium(): Promise<PlaywrightChromium> {
  try {
    const playwright = await import("playwright");
    return playwright.chromium as unknown as PlaywrightChromium;
  } catch {
    throw new ShopVerifyTerminalError("PLAYWRIGHT_MISSING");
  }
}

async function runFixtureAccept(opts: {
  page: PlaywrightPage;
  shopId: string;
  region: string;
}): Promise<"accepted"> {
  const fixtureUrl = buildFixtureUrl({
    shopId: opts.shopId,
    region: opts.region,
    auto: "accept",
  });
  await opts.page.goto(fixtureUrl, {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });

  let outcome = await readOutcome(opts.page);
  if (!outcome) {
    await opts.page.click("#btn-accept", { timeout: 10_000 });
    outcome = await waitForOutcome(opts.page, 10_000);
  }

  if (outcome === "rejected") {
    throw new ShopVerifyTerminalError("INVITE_REJECTED");
  }
  if (outcome === "expired") {
    throw new ShopVerifyTerminalError("INVITE_EXPIRED");
  }
  if (outcome !== "accepted") {
    throw new ShopVerifyTerminalError("VERIFY_TIMEOUT");
  }
  return "accepted";
}

const LOGIN_URL_RE = /\/(login|signin|sign-in|passport|account\/register)\b/i;

function readBotSession(ciphertext: string | null): unknown {
  if (!ciphertext) throw new ShopVerifyTerminalError("BOT_SESSION_MISSING");
  try {
    return JSON.parse(decryptVault(ciphertext));
  } catch {
    throw new ShopVerifyTerminalError("BOT_SESSION_MISSING");
  }
}

/**
 * Live verify: find the invite mail sent to this shop's bot, open its link in
 * the bot's saved Seller Center session, and accept. Login itself is never
 * automated — a staff member captures the session with `npm run bot:login`.
 */
async function runLiveVerify(data: ShopVerifyJobData): Promise<void> {
  const { shopId, verificationJobId } = data;
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { botIdentity: true },
  });
  const bot = shop.botIdentity;
  if (!bot) throw new ShopVerifyTerminalError("BOT_SESSION_MISSING");
  const storageState = readBotSession(bot.sessionVaultCiphertext);

  // IMAP SINCE is day-granular; back off a day so timezone edges don't drop the mail.
  const since = new Date(shop.createdAt.getTime() - 24 * 60 * 60 * 1000);
  const hit = await waitForBotInviteIfConfigured(bot.email, since);
  const inviteUrl = hit?.inviteUrl ?? resolveLiveInviteUrl(shop.region);

  const timeout = liveTimeoutMs();
  const selector = liveAcceptSelector();
  const chromium = await launchChromium();
  const browser = await chromium.launch({ headless: env.SHOP_VERIFY_HEADLESS });
  try {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    try {
      await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout });

      if (LOGIN_URL_RE.test(page.url())) {
        await prisma.botIdentity.update({
          where: { id: bot.id },
          data: { sessionVaultCiphertext: null, sessionCapturedAt: null },
        });
        throw new ShopVerifyTerminalError("BOT_SESSION_EXPIRED");
      }

      try {
        await page.waitForSelector(selector, { timeout });
      } catch {
        throw new ShopVerifyTerminalError("INVITE_ACCEPT_NOT_FOUND");
      }
      await page.click(selector, { timeout });
      await page
        .waitForLoadState("networkidle", { timeout })
        .catch(() => undefined);

      const refreshed = await context.storageState();
      await prisma.botIdentity.update({
        where: { id: bot.id },
        data: { sessionVaultCiphertext: encryptVault(JSON.stringify(refreshed)) },
      });

      logger.info("live shop verify accepted invite", {
        shopId,
        inviteFromEmail: Boolean(hit?.inviteUrl),
      });
      await activateShopAfterVerify(shopId, verificationJobId, {
        sessionVaultCiphertext: encryptVault(
          JSON.stringify({
            mode: "playwright",
            target: "live",
            region: shop.region,
            inviteFromEmail: Boolean(hit?.inviteUrl),
            verifiedAt: new Date().toISOString(),
          }),
        ),
      });
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  } catch (err) {
    if (err instanceof ShopVerifyTerminalError) throw err;
    const message = err instanceof Error ? err.message : "verify failed";
    if (/timeout/i.test(message)) {
      throw new ShopVerifyTerminalError("VERIFY_TIMEOUT", message);
    }
    throw err;
  } finally {
    await browser.close();
  }
}

/**
 * Playwright shop verify.
 * - Default: dry-run activates without browser.
 * - Non-dry-run + SHOP_VERIFY_TARGET=fixture: local invite-accept HTML.
 * - Non-dry-run + SHOP_VERIFY_TARGET=live: invite link from the bot inbox (or the
 *   configured region URL) opened in the bot's saved session, then accepted.
 */
export async function runPlaywrightVerify(data: ShopVerifyJobData): Promise<void> {
  const { shopId, verificationJobId } = data;

  if (env.PLAYWRIGHT_SHOP_VERIFY_DRY_RUN) {
    logger.info("playwright shop verify dry-run", { shopId, verificationJobId });
    await activateShopAfterVerify(shopId, verificationJobId, {
      sessionVaultCiphertext: encryptVault(
        JSON.stringify({
          mode: "playwright-dry-run",
          verifiedAt: new Date().toISOString(),
        })
      ),
    });
    return;
  }

  if (env.SHOP_VERIFY_TARGET === "live") {
    await runLiveVerify(data);
    return;
  }

  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });

  const chromium = await launchChromium();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await runFixtureAccept({
        page,
        shopId,
        region: shop.region,
      });

      const storageState = await context.storageState();
      await activateShopAfterVerify(shopId, verificationJobId, {
        sessionVaultCiphertext: encryptVault(
          JSON.stringify({
            mode: "playwright",
            target: "fixture",
            region: shop.region,
            storageState,
            verifiedAt: new Date().toISOString(),
            fixture: true,
          })
        ),
      });
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  } catch (err) {
    if (err instanceof ShopVerifyTerminalError) throw err;
    const message = err instanceof Error ? err.message : "verify failed";
    if (/timeout/i.test(message)) {
      throw new ShopVerifyTerminalError("VERIFY_TIMEOUT", message);
    }
    throw err;
  } finally {
    await browser.close();
  }
}

async function activateShopAfterVerify(
  shopId: string,
  verificationJobId: string,
  extra: { sessionVaultCiphertext: string }
) {
  const current = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  if (current.status === "DISCONNECTED" || !current.botIdentityId) {
    await prisma.shopVerificationJob.update({
      where: { id: verificationJobId },
      data: {
        status: "FAILED",
        lastError: "Shop disconnected or missing bot identity",
      },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.shop.update({
      where: { id: shopId },
      data: {
        status: "ACTIVE",
        verifiedAt: new Date(),
        sessionVaultCiphertext: extra.sessionVaultCiphertext,
        statusReason: null,
      },
    });
    await tx.botIdentity.update({
      where: { id: current.botIdentityId! },
      data: { status: "ASSIGNED" },
    });
    await tx.shopVerificationJob.update({
      where: { id: verificationJobId },
      data: { status: "SUCCEEDED" },
    });
  });
}
