import type { ShopRegion } from "@prisma/client";
import { prisma, discoveryCrawlCells } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { writeAuditLog } from "../../lib/audit.js";
import {
  discoverySyncQueue,
  DISCOVERY_SYNC_QUEUE,
  getDiscoverySyncQueue,
} from "../../lib/queue.js";
import { getMarketplaceCreatorPerformance } from "../../lib/tiktok-shop/client.js";
import { getShopOpenApiCredentials } from "../shops/tiktok-oauth.service.js";
import {
  syncDiscoveryFromTikTok,
  type DiscoverySyncEnqueueResult,
  type DiscoveryTikTokSyncOptions,
} from "./tiktok-sync.service.js";
import {
  discoveryMetricsUpdateData,
  formatGmvBio,
  normalizeMarketplaceCreator,
} from "./creator-metrics.js";
import { DISCOVERY_KEYWORDS_US } from "./data/discovery-keywords.us.js";
import { resolveCrawlKeywords } from "./discovery-crawl-terms.service.js";

/** Default follower bands for crawl grid cells. */
export const DEFAULT_FOLLOWER_BANDS = [
  0, 1_000, 10_000, 50_000, 100_000, 500_000,
] as const;

export function buildCrawlCellKey(
  region: ShopRegion | "US" | "UK",
  keyword: string,
  minFollowers: number | null | undefined,
): string {
  const kw = keyword.trim().toLowerCase().replace(/\s+/g, " ");
  const band = minFollowers != null && minFollowers > 0 ? minFollowers : 0;
  return `${String(region).toLowerCase()}|${kw}|ge_${band}`;
}

/** @deprecated Prefer resolveCrawlKeywords — kept for sync status keywordSeedSize fallback. */
export function loadDiscoveryKeywords(): string[] {
  return DISCOVERY_KEYWORDS_US;
}

export type CrawlPlanInput = {
  shopId: string;
  organizationId: string;
  region?: "US" | "UK";
  /** Skip cells crawled within this many days (default 7). */
  skipDays?: number;
  maxPages?: number;
  pageSize?: 12 | 20;
  /** Cap how many cells to enqueue this run (ops safety). */
  maxCells?: number;
  followerBands?: number[];
  keywords?: string[];
};

export type CrawlPlanResult = {
  enqueued: number;
  skippedFresh: number;
  totalCells: number;
  region: "US" | "UK";
  shopId: string;
  jobIds: string[];
};

/**
 * Build keyword × follower-band grid and enqueue crawl-cell jobs.
 * Does not run TikTok calls inline — workers process cells.
 */
export async function planDiscoveryCrawl(
  triggeredBy: string | undefined,
  input: CrawlPlanInput,
): Promise<CrawlPlanResult> {
  if (!input.shopId || !input.organizationId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "shopId and organizationId required for crawl planner",
      400,
    );
  }

  const shop = await prisma.shop.findFirst({
    where: {
      id: input.shopId,
      organizationId: input.organizationId,
      status: { not: "DISCONNECTED" },
    },
    select: { id: true, region: true, oauthConnectedAt: true },
  });
  if (!shop) {
    throw new AppError("NOT_FOUND", "Shop not found for organization", 404);
  }
  if (!shop.oauthConnectedAt) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Shop must be OAuth-connected for crawl",
      400,
    );
  }

  const region: "US" | "UK" =
    input.region ?? (shop.region === "UK" ? "UK" : "US");
  const keywords = input.keywords?.length
    ? input.keywords
    : await resolveCrawlKeywords(region);
  const bands = input.followerBands?.length
    ? input.followerBands
    : [...DEFAULT_FOLLOWER_BANDS];
  const skipDays = Math.min(Math.max(input.skipDays ?? 7, 0), 90);
  const maxPages = Math.min(Math.max(input.maxPages ?? 10, 1), 20);
  const maxCells = Math.min(Math.max(input.maxCells ?? 500, 1), 5_000);
  const freshAfter =
    skipDays > 0 ? new Date(Date.now() - skipDays * 24 * 60 * 60 * 1000) : null;

  const cells: Array<{
    cellKey: string;
    keyword: string;
    minFollowers: number;
  }> = [];
  for (const keyword of keywords) {
    for (const minFollowers of bands) {
      cells.push({
        cellKey: buildCrawlCellKey(region, keyword, minFollowers),
        keyword,
        minFollowers,
      });
    }
  }

  let skippedFresh = 0;
  let enqueued = 0;
  const jobIds: string[] = [];

  for (const cell of cells) {
    if (enqueued >= maxCells) break;

    if (freshAfter) {
      const prior = await discoveryCrawlCells.findUnique({
        where: { cellKey: cell.cellKey },
        select: { lastRunAt: true, lastStatus: true },
      });
      if (
        prior?.lastStatus === "OK" &&
        prior.lastRunAt &&
        prior.lastRunAt >= freshAfter
      ) {
        skippedFresh += 1;
        continue;
      }
    }

    await discoveryCrawlCells.upsert({
      where: { cellKey: cell.cellKey },
      create: {
        cellKey: cell.cellKey,
        region,
        keyword: cell.keyword,
        minFollowers: cell.minFollowers,
      },
      update: {
        region,
        keyword: cell.keyword,
        minFollowers: cell.minFollowers,
      },
    });

    try {
      const job = await discoverySyncQueue.add(
        "discovery-crawl-cell",
        {
          mode: "crawl_cell" as const,
          triggeredBy,
          requestedAt: new Date().toISOString(),
          cellKey: cell.cellKey,
          options: {
            shopId: input.shopId,
            organizationId: input.organizationId,
            keyword: cell.keyword,
            minFollowers: cell.minFollowers,
            maxPages,
            pageSize: input.pageSize ?? 20,
            propagateCrm: false,
            markCrawled: true,
            cellKey: cell.cellKey,
          } satisfies DiscoveryTikTokSyncOptions,
        },
        {
          jobId: `crawl:${cell.cellKey}`,
          removeOnComplete: 1_000,
          removeOnFail: 200,
          attempts: 3,
          backoff: { type: "exponential", delay: 10_000 },
        },
      );
      jobIds.push(job.id != null ? String(job.id) : cell.cellKey);
      enqueued += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists|Job.*exists/i.test(msg)) {
        skippedFresh += 1;
        continue;
      }
      throw err;
    }
  }

  if (triggeredBy) {
    await writeAuditLog({
      actorUserId: triggeredBy,
      action: "discovery.crawl.plan",
      entityType: "DiscoveryCrawlCell",
      meta: {
        region,
        shopId: input.shopId,
        enqueued,
        skippedFresh,
        totalCells: cells.length,
        maxCells,
      },
    });
  }

  logger.info("discovery crawl plan enqueued", {
    region,
    enqueued,
    skippedFresh,
    totalCells: cells.length,
  });

  return {
    enqueued,
    skippedFresh,
    totalCells: cells.length,
    region,
    shopId: input.shopId,
    jobIds: jobIds.slice(0, 20),
  };
}

export async function enqueueDiscoveryCrawlPlan(
  triggeredBy: string | undefined,
  input: CrawlPlanInput,
): Promise<DiscoverySyncEnqueueResult> {
  try {
    const job = await discoverySyncQueue.add(
      "discovery-crawl-plan",
      {
        mode: "crawl_plan" as const,
        triggeredBy,
        requestedAt: new Date().toISOString(),
        plan: input,
      },
      {
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 1,
      },
    );
    return {
      jobId: job.id != null ? String(job.id) : "unknown",
      queue: DISCOVERY_SYNC_QUEUE,
      status: "QUEUED",
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : "Queue unavailable";
    throw new AppError(
      "INTERNAL",
      `Unable to enqueue crawl plan: ${message}`,
      503,
    );
  }
}

/**
 * Run one crawl cell: TikTok search upsert with propagateCrm=false.
 * Updates DiscoveryCrawlCell status row.
 */
export async function runDiscoveryCrawlCell(
  triggeredBy: string | undefined,
  options: DiscoveryTikTokSyncOptions & { cellKey: string },
) {
  const cellKey =
    options.cellKey ??
    buildCrawlCellKey("US", options.keyword ?? "", options.minFollowers);

  try {
    const result = await syncDiscoveryFromTikTok(triggeredBy, {
      ...options,
      propagateCrm: false,
      markCrawled: true,
      cellKey,
    });

    await discoveryCrawlCells.upsert({
      where: { cellKey },
      create: {
        cellKey,
        region: result.region,
        keyword: options.keyword ?? "",
        minFollowers: options.minFollowers ?? null,
        lastRunAt: new Date(),
        lastStatus: "OK",
        lastImported: result.imported,
        lastUpdated: result.updated,
        lastError: null,
      },
      update: {
        lastRunAt: new Date(),
        lastStatus: "OK",
        lastImported: result.imported,
        lastUpdated: result.updated,
        lastError: null,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await discoveryCrawlCells
      .upsert({
        where: { cellKey },
        create: {
          cellKey,
          region: "US",
          keyword: options.keyword ?? "",
          minFollowers: options.minFollowers ?? null,
          lastRunAt: new Date(),
          lastStatus: "FAILED",
          lastError: message.slice(0, 500),
        },
        update: {
          lastRunAt: new Date(),
          lastStatus: "FAILED",
          lastError: message.slice(0, 500),
        },
      })
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Refresh stale discovery profiles that have creatorOpenId via performance API.
 */
export async function refreshDiscoveryProfileMetrics(input: {
  organizationId: string;
  shopId: string;
  actorUserId?: string;
  limit?: number;
  olderThanHours?: number;
}): Promise<{ refreshed: number; skipped: number; failed: number }> {
  const credentials = await getShopOpenApiCredentials(
    input.organizationId,
    input.shopId,
  );
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const olderThanHours = Math.min(
    Math.max(input.olderThanHours ?? 168, 1),
    24 * 90,
  );
  const staleBefore = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const profileQuery = {
    where: {
      platform: "TIKTOK" as const,
      enabled: true,
      creatorOpenId: { not: null },
      OR: [{ metricsSyncedAt: null }, { metricsSyncedAt: { lt: staleBefore } }],
    },
    orderBy: [
      { metricsSyncedAt: "asc" as const },
      { updatedAt: "asc" as const },
    ],
    take: limit,
  };
  const profiles = await prisma.creatorDiscoveryProfile.findMany(
    profileQuery as never,
  );
  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const profile of profiles) {
    const openId = profile.creatorOpenId?.trim();
    if (!openId) {
      skipped += 1;
      continue;
    }
    try {
      const perf = await getMarketplaceCreatorPerformance({
        credentials,
        creatorOpenId: openId,
      });
      const mapped = normalizeMarketplaceCreator(
        {
          ...perf.raw,
          username: perf.username ?? profile.handle,
          nickname: perf.nickname ?? profile.displayName,
          creator_open_id: openId,
          follower_count: perf.followerCount,
          avatar: perf.avatarUrl ? { url: perf.avatarUrl } : undefined,
          gmv: perf.gmvAmount
            ? { amount: perf.gmvAmount, currency: perf.gmvCurrency }
            : undefined,
          gmv_range: perf.gmvRange
            ? {
                formatted_range: perf.gmvRange,
                currency: perf.gmvCurrency,
              }
            : undefined,
          units_sold: perf.unitsSold,
          email: perf.contactEmail,
          bio: perf.bio,
          selection_region: profile.region,
        },
        {
          fallbackRegion:
            profile.region === "UK"
              ? "UK"
              : profile.region === "US"
                ? "US"
                : "US",
        },
      );
      if (!mapped) {
        skipped += 1;
        continue;
      }
      if (!mapped.bio) {
        mapped.bio = formatGmvBio({
          gmvRange: mapped.gmvRange,
          gmvAmount: mapped.gmvAmount,
          gmvCurrency: mapped.gmvCurrency,
        });
      }

      await prisma.creatorDiscoveryProfile.update({
        where: { id: profile.id },
        data: {
          ...discoveryMetricsUpdateData(mapped),
          bio: mapped.bio ?? undefined,
          source: "tiktok_affiliate_api",
        },
      });
      refreshed += 1;
    } catch (err) {
      failed += 1;
      logger.info("discovery metrics refresh failed", {
        profileId: profile.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (input.actorUserId) {
    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "discovery.metrics.refresh",
      entityType: "CreatorDiscoveryProfile",
      meta: {
        organizationId: input.organizationId,
        shopId: input.shopId,
        refreshed,
        skipped,
        failed,
        olderThanHours,
      },
    });
  }

  return { refreshed, skipped, failed };
}

export async function enqueueDiscoveryMetricsRefresh(input: {
  triggeredBy: string | undefined;
  organizationId: string;
  shopId: string;
  limit?: number;
  olderThanHours?: number;
}): Promise<DiscoverySyncEnqueueResult> {
  try {
    const job = await discoverySyncQueue.add(
      "discovery-metrics-refresh",
      {
        mode: "discovery_metrics_refresh" as const,
        triggeredBy: input.triggeredBy,
        requestedAt: new Date().toISOString(),
        organizationId: input.organizationId,
        shopId: input.shopId,
        limit: input.limit,
        olderThanHours: input.olderThanHours,
      },
      {
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
      },
    );
    return {
      jobId: job.id != null ? String(job.id) : "unknown",
      queue: DISCOVERY_SYNC_QUEUE,
      status: "QUEUED",
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : "Queue unavailable";
    throw new AppError(
      "INTERNAL",
      `Unable to enqueue discovery metrics refresh: ${message}`,
      503,
    );
  }
}

export async function getDiscoveryCrawlStatus() {
  const [profileCount, withOpenId, withGmvCents, cellAgg, recentCells, queue] =
    await Promise.all([
      prisma.creatorDiscoveryProfile.count({ where: { enabled: true } }),
      prisma.creatorDiscoveryProfile.count({
        where: { enabled: true, creatorOpenId: { not: null } },
      }),
      prisma.creatorDiscoveryProfile.count({
        where: { enabled: true, gmvCents: { not: null } },
      }),
      discoveryCrawlCells.groupBy({
        by: ["lastStatus"],
        _count: { _all: true },
      }),
      discoveryCrawlCells.findMany({
        orderBy: { lastRunAt: "desc" },
        take: 15,
        select: {
          cellKey: true,
          region: true,
          keyword: true,
          minFollowers: true,
          lastRunAt: true,
          lastStatus: true,
          lastImported: true,
          lastUpdated: true,
          lastError: true,
        },
      }),
      getDiscoverySyncQueue()
        .getJobCounts("waiting", "active", "completed", "failed", "delayed")
        .catch(() => null),
    ]);

  const cellsByStatus: Record<string, number> = {};
  for (const row of cellAgg) {
    cellsByStatus[row.lastStatus ?? "NEVER"] = row._count._all;
  }

  return {
    index: {
      enabledProfiles: profileCount,
      withOpenId,
      withGmvCents,
      keywordSeedSize: loadDiscoveryKeywords().length,
      followerBands: [...DEFAULT_FOLLOWER_BANDS],
    },
    cells: {
      byStatus: cellsByStatus,
      recent: recentCells.map((c: (typeof recentCells)[number]) => ({
        ...c,
        lastRunAt: c.lastRunAt?.toISOString() ?? null,
      })),
    },
    queue: queue ? { name: DISCOVERY_SYNC_QUEUE, counts: queue } : null,
  };
}
