import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import {
  discoverySyncQueue,
  DISCOVERY_SYNC_QUEUE,
  getDiscoverySyncQueue,
} from "../../lib/queue.js";
import { planDiscoveryCrawl } from "./discovery-crawl.service.js";

export const CRAWL_SCHEDULE_JOB_US = "discovery-crawl-schedule:us";
export const CRAWL_SCHEDULE_JOB_UK = "discovery-crawl-schedule:uk";

export type CrawlScheduleRegionConfig = {
  region: "US" | "UK";
  organizationId: string;
  shopId: string;
  jobId: string;
};

export function getConfiguredCrawlRegions(): CrawlScheduleRegionConfig[] {
  const regions: CrawlScheduleRegionConfig[] = [];
  if (
    env.DISCOVERY_CRAWL_US_ORGANIZATION_ID &&
    env.DISCOVERY_CRAWL_US_SHOP_ID
  ) {
    regions.push({
      region: "US",
      organizationId: env.DISCOVERY_CRAWL_US_ORGANIZATION_ID,
      shopId: env.DISCOVERY_CRAWL_US_SHOP_ID,
      jobId: CRAWL_SCHEDULE_JOB_US,
    });
  }
  if (
    env.DISCOVERY_CRAWL_UK_ORGANIZATION_ID &&
    env.DISCOVERY_CRAWL_UK_SHOP_ID
  ) {
    regions.push({
      region: "UK",
      organizationId: env.DISCOVERY_CRAWL_UK_ORGANIZATION_ID,
      shopId: env.DISCOVERY_CRAWL_UK_SHOP_ID,
      jobId: CRAWL_SCHEDULE_JOB_UK,
    });
  }
  return regions;
}

export async function runScheduledCrawlForRegion(
  region: "US" | "UK",
): Promise<Awaited<ReturnType<typeof planDiscoveryCrawl>> | null> {
  const cfg = getConfiguredCrawlRegions().find((r) => r.region === region);
  if (!cfg) {
    logger.info("discovery crawl schedule skipped — region not configured", {
      region,
    });
    return null;
  }
  return planDiscoveryCrawl(undefined, {
    organizationId: cfg.organizationId,
    shopId: cfg.shopId,
    region: cfg.region,
    maxCells: env.DISCOVERY_CRAWL_MAX_CELLS,
    skipDays: env.DISCOVERY_CRAWL_SKIP_DAYS,
    maxPages: env.DISCOVERY_CRAWL_MAX_PAGES,
    pageSize: 20,
  });
}

/**
 * Register / refresh BullMQ repeatable jobs for configured regions.
 * Safe to call on every worker boot (idempotent jobIds).
 */
export async function registerDiscoveryCrawlSchedulers(): Promise<{
  enabled: boolean;
  cron: string;
  registered: string[];
  removed: string[];
}> {
  const queue = getDiscoverySyncQueue();
  const cron = env.DISCOVERY_CRAWL_CRON;
  const configured = getConfiguredCrawlRegions();
  const registered: string[] = [];
  const removed: string[] = [];

  const existing = await queue.getRepeatableJobs();
  const knownIds = new Set([CRAWL_SCHEDULE_JOB_US, CRAWL_SCHEDULE_JOB_UK]);

  if (!env.DISCOVERY_CRAWL_SCHEDULER_ENABLED || configured.length === 0) {
    for (const job of existing) {
      if (job.id && knownIds.has(job.id)) {
        await queue.removeRepeatableByKey(job.key);
        removed.push(job.id);
      }
    }
    return {
      enabled: false,
      cron,
      registered,
      removed,
    };
  }

  const want = new Set(configured.map((c) => c.jobId));

  for (const job of existing) {
    if (job.id && knownIds.has(job.id) && !want.has(job.id)) {
      await queue.removeRepeatableByKey(job.key);
      removed.push(job.id);
    }
  }

  for (const cfg of configured) {
    await discoverySyncQueue.add(
      "discovery-crawl-schedule",
      {
        mode: "crawl_schedule" as const,
        region: cfg.region,
        requestedAt: new Date().toISOString(),
      },
      {
        jobId: cfg.jobId,
        repeat: { pattern: cron },
        removeOnComplete: 20,
        removeOnFail: 50,
      },
    );
    registered.push(cfg.jobId);
  }

  logger.info("discovery crawl schedulers registered", {
    cron,
    registered,
    removed,
  });

  return { enabled: true, cron, registered, removed };
}

export async function getDiscoveryCrawlSchedulerStatus() {
  const queue = getDiscoverySyncQueue();
  const repeatable = await queue.getRepeatableJobs();
  const ours = repeatable.filter(
    (j) => j.id === CRAWL_SCHEDULE_JOB_US || j.id === CRAWL_SCHEDULE_JOB_UK,
  );
  return {
    enabled: env.DISCOVERY_CRAWL_SCHEDULER_ENABLED,
    cron: env.DISCOVERY_CRAWL_CRON,
    maxCells: env.DISCOVERY_CRAWL_MAX_CELLS,
    skipDays: env.DISCOVERY_CRAWL_SKIP_DAYS,
    maxPages: env.DISCOVERY_CRAWL_MAX_PAGES,
    regions: getConfiguredCrawlRegions().map((r) => ({
      region: r.region,
      organizationId: r.organizationId,
      shopId: r.shopId,
      jobId: r.jobId,
    })),
    repeatable: ours.map((j) => ({
      id: j.id,
      pattern: j.pattern,
      next: j.next,
      key: j.key,
    })),
    queue: DISCOVERY_SYNC_QUEUE,
  };
}
