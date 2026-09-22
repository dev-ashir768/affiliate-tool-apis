import { Worker, type Job } from "bullmq";
import { bullConnection, DISCOVERY_SYNC_QUEUE } from "../lib/queue.js";
import { logger } from "../lib/logger.js";
import {
  refreshOrgCreatorMetrics,
  syncDiscoveryFromTikTok,
  type DiscoveryTikTokSyncOptions,
} from "../modules/discovery/tiktok-sync.service.js";
import {
  planDiscoveryCrawl,
  refreshDiscoveryProfileMetrics,
  runDiscoveryCrawlCell,
  type CrawlPlanInput,
} from "../modules/discovery/discovery-crawl.service.js";
import { runScheduledCrawlForRegion } from "../modules/discovery/discovery-crawl-scheduler.service.js";

export type DiscoverySyncJobData = {
  triggeredBy?: string;
  requestedAt: string;
  options?: DiscoveryTikTokSyncOptions;
  mode?:
    | "crm_metrics_refresh"
    | "crawl_plan"
    | "crawl_cell"
    | "discovery_metrics_refresh"
    | "crawl_schedule";
  organizationId?: string;
  shopId?: string;
  limit?: number;
  olderThanHours?: number;
  cellKey?: string;
  plan?: CrawlPlanInput;
  region?: "US" | "UK";
};

export async function processDiscoverySync(job: Job<DiscoverySyncJobData>) {
  if (job.data.mode === "crm_metrics_refresh") {
    if (!job.data.organizationId || !job.data.shopId) {
      throw new Error("organizationId and shopId required for metrics refresh");
    }
    const result = await refreshOrgCreatorMetrics({
      organizationId: job.data.organizationId,
      shopId: job.data.shopId,
      actorUserId: job.data.triggeredBy,
      limit: job.data.limit,
    });
    logger.info("crm creator metrics refresh completed", {
      jobId: job.id,
      ...result,
    });
    return result;
  }

  if (job.data.mode === "crawl_schedule") {
    const region = job.data.region ?? "US";
    const result = await runScheduledCrawlForRegion(region);
    logger.info("discovery crawl schedule tick completed", {
      jobId: job.id,
      region,
      enqueued: result?.enqueued ?? 0,
    });
    return result;
  }

  if (job.data.mode === "crawl_plan") {
    if (!job.data.plan) {
      throw new Error("plan payload required for crawl_plan");
    }
    const result = await planDiscoveryCrawl(
      job.data.triggeredBy,
      job.data.plan,
    );
    logger.info("discovery crawl plan completed", {
      jobId: job.id,
      enqueued: result.enqueued,
      skippedFresh: result.skippedFresh,
      totalCells: result.totalCells,
    });
    return result;
  }

  if (job.data.mode === "crawl_cell") {
    const cellKey = job.data.cellKey ?? job.data.options?.cellKey;
    if (!cellKey) {
      throw new Error("cellKey required for crawl_cell");
    }
    const result = await runDiscoveryCrawlCell(job.data.triggeredBy, {
      ...job.data.options,
      cellKey,
      propagateCrm: false,
      markCrawled: true,
    });
    logger.info("discovery crawl cell completed", {
      jobId: job.id,
      cellKey,
      imported: result.imported,
      updated: result.updated,
      pages: result.pages,
    });
    return result;
  }

  if (job.data.mode === "discovery_metrics_refresh") {
    if (!job.data.organizationId || !job.data.shopId) {
      throw new Error(
        "organizationId and shopId required for discovery metrics refresh",
      );
    }
    const result = await refreshDiscoveryProfileMetrics({
      organizationId: job.data.organizationId,
      shopId: job.data.shopId,
      actorUserId: job.data.triggeredBy,
      limit: job.data.limit,
      olderThanHours: job.data.olderThanHours,
    });
    logger.info("discovery profile metrics refresh completed", {
      jobId: job.id,
      ...result,
    });
    return result;
  }

  const result = await syncDiscoveryFromTikTok(job.data.triggeredBy, {
    maxPages: job.data.options?.maxPages ?? 5,
    keyword: job.data.options?.keyword,
    minFollowers: job.data.options?.minFollowers,
    pageSize: job.data.options?.pageSize,
    categoryIds: job.data.options?.categoryIds,
    shopId: job.data.options?.shopId,
    organizationId: job.data.options?.organizationId,
    propagateCrm: job.data.options?.propagateCrm,
    markCrawled: job.data.options?.markCrawled,
  });
  logger.info("discovery tiktok sync completed", {
    jobId: job.id,
    imported: result.imported,
    updated: result.updated,
    skipped: result.skipped,
    crmPropagated: result.crmPropagated,
    pages: result.pages,
    shopId: result.shopId,
    credentialSource: result.credentialSource,
  });
  return result;
}

export function startDiscoverySyncWorker() {
  const worker = new Worker(DISCOVERY_SYNC_QUEUE, processDiscoverySync, {
    connection: bullConnection(),
    concurrency: 2,
  });
  worker.on("failed", (job, err) => {
    logger.error("discovery tiktok sync failed", {
      jobId: job?.id,
      mode: job?.data?.mode,
      error: err.message,
    });
  });
  return worker;
}
