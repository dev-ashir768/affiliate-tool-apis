import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { encryptVault } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import type { ShopVerifyJobData } from "./shop-verify.processor.js";

/**
 * Playwright shop verify.
 * - Default: dry-run activates the shop (same outcome as stub) so PLAYWRIGHT mode
 *   is usable without TikTok credentials.
 * - Set PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=false and install `playwright` to run a
 *   real Chromium session that stores a vaulted session placeholder.
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

  let chromium: {
    launch: (opts?: { headless?: boolean }) => Promise<{
      newPage: () => Promise<{
        goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
        title: () => Promise<string>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  };

  try {
    const playwright = await import("playwright");
    chromium = playwright.chromium;
  } catch {
    throw new AppError(
      "INTERNAL",
      "playwright package is not installed; set PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=true or npm i -D playwright",
      501
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15_000 });
    const title = await page.title();
    await page.close();

    await activateShopAfterVerify(shopId, verificationJobId, {
      sessionVaultCiphertext: encryptVault(
        JSON.stringify({
          mode: "playwright",
          title,
          verifiedAt: new Date().toISOString(),
        })
      ),
    });
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
