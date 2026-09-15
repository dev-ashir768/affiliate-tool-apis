import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { shopVerifyQueue } from "../../lib/queue.js";
import type { ShopVerifyJobData } from "../../workers/shop-verify.processor.js";

function verifyModeFromEnv(): "STUB" | "PLAYWRIGHT" {
  return env.SHOP_VERIFY_MODE === "playwright" ? "PLAYWRIGHT" : "STUB";
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

  await prisma.shop.update({
    where: { id: shop.id },
    data: { status: "VERIFYING", statusReason: null },
  });

  const jobData: ShopVerifyJobData = {
    shopId: shop.id,
    organizationId,
    mode,
    verificationJobId: verificationJob.id,
  };

  // Skip BullMQ in test — Redis is often unreachable (ETIMEDOUT); processor is unit-tested directly.
  if (env.NODE_ENV !== "test") {
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
      // Job row remains QUEUED; caller/worker can still process when Redis recovers.
    }
  }

  return {
    verificationJobId: verificationJob.id,
    status: "VERIFYING" as const,
  };
}
