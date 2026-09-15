import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { shopVerifyQueue } from "../../lib/queue.js";
import type { ShopVerifyJobData } from "../../workers/shop-verify.processor.js";

function verifyModeFromEnv(): "STUB" | "PLAYWRIGHT" {
  return env.SHOP_VERIFY_MODE === "playwright" ? "PLAYWRIGHT" : "STUB";
}

/** Test skip unless FORCE_SHOP_VERIFY_ENQUEUE=1 (for enqueue-failure unit tests). */
function shouldEnqueue(): boolean {
  if (env.NODE_ENV !== "test") return true;
  return process.env.FORCE_SHOP_VERIFY_ENQUEUE === "1";
}

export async function requestVerify(organizationId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, organizationId },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);

  if (shop.status !== "PENDING_INVITE" && shop.status !== "FAILED") {
    throw new AppError(
      "SHOP_NOT_READY",
      `Shop status ${shop.status} cannot start verify`,
      409
    );
  }

  const mode = verifyModeFromEnv();

  const verificationJob = await prisma.shopVerificationJob.create({
    data: {
      shopId: shop.id,
      mode,
      status: "QUEUED",
    },
  });

  const jobData: ShopVerifyJobData = {
    shopId: shop.id,
    organizationId,
    mode,
    verificationJobId: verificationJob.id,
  };

  // Intentional test skip — leave PENDING_INVITE; processShopVerify sets VERIFYING.
  if (!shouldEnqueue()) {
    return {
      verificationJobId: verificationJob.id,
      status: "PENDING_INVITE" as const,
    };
  }

  try {
    const bullJob = await shopVerifyQueue.add("verify", jobData, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });
    await prisma.shopVerificationJob.update({
      where: { id: verificationJob.id },
      data: { bullJobId: String(bullJob.id) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "enqueue failed";
    logger.error("shop-verify enqueue failed", {
      shopId: shop.id,
      verificationJobId: verificationJob.id,
      err: message,
    });
    await prisma.shop.update({
      where: { id: shop.id },
      data: { status: "FAILED", statusReason: message },
    });
    await prisma.shopVerificationJob.update({
      where: { id: verificationJob.id },
      data: { status: "FAILED", lastError: message },
    });
    throw new AppError("INTERNAL", `Failed to enqueue shop verify: ${message}`, 503);
  }

  await prisma.shop.update({
    where: { id: shop.id },
    data: { status: "VERIFYING", statusReason: null },
  });

  return {
    verificationJobId: verificationJob.id,
    status: "VERIFYING" as const,
  };
}
