import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { encryptVault } from "../lib/crypto.js";
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
  close: () => Promise<void>;
};

type PlaywrightContext = {
  newPage: () => Promise<PlaywrightPage>;
  storageState: () => Promise<unknown>;
  close: () => Promise<void>;
};

type PlaywrightBrowser = {
  newContext: () => Promise<PlaywrightContext>;
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

async function runLiveAccept(opts: {
  page: PlaywrightPage;
  region: "US" | "UK";
}): Promise<void> {
  const url = resolveLiveInviteUrl(opts.region);
  const selector = liveAcceptSelector();
  const timeout = liveTimeoutMs();

  await opts.page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout,
  });
  await opts.page.waitForSelector(selector, { timeout });
  await opts.page.click(selector, { timeout });
}

/**
 * Playwright shop verify.
 * - Default: dry-run activates without browser.
 * - Non-dry-run + SHOP_VERIFY_TARGET=fixture: local invite-accept HTML.
 * - Non-dry-run + SHOP_VERIFY_TARGET=live: configured Seller Center URL + accept selector.
 * - Optional BOT_INBOX_PROVIDER waits for invite mail before browser (live path).
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

  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { botIdentity: true },
  });

  if (env.SHOP_VERIFY_TARGET === "live" && shop.botIdentity?.email) {
    const hit = await waitForBotInviteIfConfigured(shop.botIdentity.email);
    if (hit) {
      logger.info("bot invite detected before live verify", {
        shopId,
        subject: hit.subject,
      });
    }
  }

  const chromium = await launchChromium();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const target = env.SHOP_VERIFY_TARGET;
      if (target === "live") {
        await runLiveAccept({ page, region: shop.region });
      } else {
        await runFixtureAccept({
          page,
          shopId,
          region: shop.region,
        });
      }

      const storageState = await context.storageState();
      await activateShopAfterVerify(shopId, verificationJobId, {
        sessionVaultCiphertext: encryptVault(
          JSON.stringify({
            mode: "playwright",
            target,
            region: shop.region,
            storageState,
            verifiedAt: new Date().toISOString(),
            fixture: target === "fixture",
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
