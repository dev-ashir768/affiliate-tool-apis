import { Worker, type Job } from "bullmq";
import {
  bullConnection,
  SHOP_OPEN_COLLAB_CREATORS_QUEUE,
} from "../lib/queue.js";
import { logger } from "../lib/logger.js";
import {
  persistSyncStatus,
  runOpenCollabCreatorsSync,
} from "../modules/shops/open-collab-creators-sync.service.js";

export type ShopOpenCollabCreatorsJobData = {
  organizationId: string;
  shopId: string;
  triggeredBy?: string;
  requestedAt: string;
};

export async function processShopOpenCollabCreators(
  job: Job<ShopOpenCollabCreatorsJobData>,
) {
  try {
    return await runOpenCollabCreatorsSync(job.data);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Open collaboration creator sync failed";
    await persistSyncStatus(job.data.organizationId, job.data.shopId, {
      status: "FAILED",
      jobId: job.id != null ? String(job.id) : null,
      productsScanned: 0,
      creatorsUpserted: 0,
      creatorsLinkedToList: 0,
      failedProducts: 0,
      lastError: message,
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export function startShopOpenCollabCreatorsWorker() {
  const worker = new Worker(
    SHOP_OPEN_COLLAB_CREATORS_QUEUE,
    processShopOpenCollabCreators,
    {
      connection: bullConnection(),
      concurrency: 2,
    },
  );
  worker.on("failed", (job, error) => {
    logger.error("shop open-collab creators sync failed", {
      jobId: job?.id,
      shopId: job?.data?.shopId,
      error: error.message,
    });
  });
  return worker;
}
