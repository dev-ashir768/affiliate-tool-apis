import { Worker, type Job } from "bullmq";
import { bullConnection, DISCOVERY_SYNC_QUEUE } from "../lib/queue.js";
import { logger } from "../lib/logger.js";
import {
  syncDiscoveryFromTikTok,
  type DiscoveryTikTokSyncOptions,
} from "../modules/discovery/tiktok-sync.service.js";

export type DiscoverySyncJobData = {
  triggeredBy?: string;
  requestedAt: string;
  options?: DiscoveryTikTokSyncOptions;
};

export async function processDiscoverySync(job: Job<DiscoverySyncJobData>) {
  const result = await syncDiscoveryFromTikTok(job.data.triggeredBy, {
    maxPages: job.data.options?.maxPages ?? 5,
    keyword: job.data.options?.keyword,
    minFollowers: job.data.options?.minFollowers,
    pageSize: job.data.options?.pageSize,
  });
  logger.info("discovery tiktok sync completed", {
    jobId: job.id,
    imported: result.imported,
    skipped: result.skipped,
    pages: result.pages,
  });
  return result;
}

export function startDiscoverySyncWorker() {
  const worker = new Worker(DISCOVERY_SYNC_QUEUE, processDiscoverySync, {
    connection: bullConnection(),
    concurrency: 1,
  });
  worker.on("failed", (job, err) => {
    logger.error("discovery tiktok sync failed", {
      jobId: job?.id,
      error: err.message,
    });
  });
  return worker;
}
