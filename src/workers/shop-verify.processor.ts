import { Worker, type Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { bullConnection, SHOP_VERIFY_QUEUE } from "../lib/queue.js";
import { runPlaywrightVerify } from "./shop-verify.playwright.scaffold.js";
import { logger } from "../lib/logger.js";

export type ShopVerifyJobData = {
  shopId: string;
  organizationId: string;
  mode: "STUB" | "PLAYWRIGHT";
  verificationJobId: string;
};

export async function processShopVerify(job: Job<ShopVerifyJobData>) {
  const { shopId, mode, verificationJobId } = job.data;

  await prisma.shopVerificationJob.update({
    where: { id: verificationJobId },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      bullJobId: job.id != null ? String(job.id) : null,
    },
  });
  await prisma.shop.update({
    where: { id: shopId },
    data: { status: "VERIFYING" },
  });

  try {
    if (mode === "PLAYWRIGHT") {
      await runPlaywrightVerify(job.data);
    } else {
      await new Promise((r) => setTimeout(r, 200));

      const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });

      await prisma.$transaction(async (tx) => {
        await tx.shop.update({
          where: { id: shopId },
          data: {
            status: "ACTIVE",
            verifiedAt: new Date(),
            sessionVaultCiphertext: null,
            statusReason: null,
          },
        });

        if (shop.botIdentityId) {
          await tx.botIdentity.update({
            where: { id: shop.botIdentityId },
            data: { status: "ASSIGNED" },
          });
        }

        await tx.shopVerificationJob.update({
          where: { id: verificationJobId },
          data: { status: "SUCCEEDED" },
        });
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "verify failed";
    await prisma.shop.update({
      where: { id: shopId },
      data: { status: "FAILED", statusReason: message },
    });
    await prisma.shopVerificationJob.update({
      where: { id: verificationJobId },
      data: { status: "FAILED", lastError: message },
    });
    throw err;
  }
}

export function startShopVerifyWorker() {
  const worker = new Worker(SHOP_VERIFY_QUEUE, processShopVerify, {
    connection: bullConnection(),
    concurrency: 5,
  });
  worker.on("failed", (job, err) =>
    logger.error("shop-verify failed", { jobId: job?.id, err: err.message })
  );
  return worker;
}
