import { UnrecoverableError, Worker, type Job } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { bullConnection, SHOP_VERIFY_QUEUE } from "../lib/queue.js";
import { runPlaywrightVerify } from "./shop-verify.playwright.scaffold.js";
import { isShopVerifyTerminalError } from "./shop-verify.errors.js";
import { logger } from "../lib/logger.js";

export type ShopVerifyJobData = {
  shopId: string;
  organizationId: string;
  mode: "STUB" | "PLAYWRIGHT";
  verificationJobId: string;
};

const ACTIVATABLE_STATUSES = new Set([
  "PENDING_INVITE",
  "VERIFYING",
  "FAILED",
]);

export async function processShopVerify(job: Job<ShopVerifyJobData>) {
  const { shopId, mode, verificationJobId } = job.data;

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) {
    logger.info("shop-verify skipped; shop missing", { shopId, jobId: job.id });
    return;
  }
  if (!ACTIVATABLE_STATUSES.has(shop.status)) {
    logger.info("shop-verify skipped; shop not activatable", {
      shopId,
      status: shop.status,
      jobId: job.id,
    });
    return;
  }
  if (!shop.botIdentityId) {
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        status: "FAILED",
        statusReason: "Missing bot identity; cannot activate shop",
      },
    });
    await prisma.shopVerificationJob.update({
      where: { id: verificationJobId },
      data: {
        status: "FAILED",
        lastError: "Missing bot identity; cannot activate shop",
      },
    });
    logger.error("shop-verify refused; missing botIdentityId", {
      shopId,
      jobId: job.id,
    });
    return;
  }

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

      // Re-check before activate — shop may have been disconnected mid-job
      const current = await prisma.shop.findUniqueOrThrow({
        where: { id: shopId },
      });
      if (current.status === "DISCONNECTED" || !current.botIdentityId) {
        logger.info("shop-verify aborted before activate", {
          shopId,
          status: current.status,
          botIdentityId: current.botIdentityId,
          jobId: job.id,
        });
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
            sessionVaultCiphertext: null,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "verify failed";
    const still = await prisma.shop.findUnique({ where: { id: shopId } });
    if (still && still.status !== "DISCONNECTED") {
      await prisma.shop.update({
        where: { id: shopId },
        data: { status: "FAILED", statusReason: message },
      });
    }
    await prisma.shopVerificationJob.update({
      where: { id: verificationJobId },
      data: { status: "FAILED", lastError: message },
    });
    if (isShopVerifyTerminalError(err)) {
      throw new UnrecoverableError(message);
    }
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
