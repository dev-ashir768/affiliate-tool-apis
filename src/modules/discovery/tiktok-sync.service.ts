import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import {
  getMarketplaceCreatorPerformance,
  getPlatformEnvCredentials,
  getTikTokShopConfigStatus,
  searchMarketplaceCreators,
  type MarketplaceCreator,
  type TikTokShopCredentials,
} from "../../lib/tiktok-shop/client.js";
import { env } from "../../config/env.js";
import {
  discoverySyncQueue,
  DISCOVERY_SYNC_QUEUE,
  getDiscoverySyncQueue,
} from "../../lib/queue.js";
import { getShopOpenApiCredentials } from "../shops/tiktok-oauth.service.js";
import {
  discoveryMetricsCreateData,
  discoveryMetricsUpdateData,
  formatGmvBio,
  metricsUpdateData,
  normalizeMarketplaceCreator,
  type MarketplaceMetrics,
} from "./creator-metrics.js";
import { indexDiscoveryProfile } from "../../lib/meilisearch.js";

export type DiscoveryTikTokSyncOptions = {
  maxPages?: number;
  keyword?: string | null;
  minFollowers?: number | null;
  pageSize?: 12 | 20;
  categoryIds?: string[] | null;
  shopId?: string | null;
  organizationId?: string | null;
  /** Push metrics into CRM Creator rows (default true). */
  propagateCrm?: boolean;
  /** Stamp lastCrawledAt on discovery upserts (crawl cells). */
  markCrawled?: boolean;
  /** Optional crawl cell key for status tracking. */
  cellKey?: string | null;
};

export type DiscoveryTikTokSyncResult = {
  ok: true;
  imported: number;
  updated: number;
  skipped: number;
  crmPropagated: number;
  pages: number;
  source: "tiktok_affiliate_api";
  region: "US" | "UK";
  shopId: string | null;
  credentialSource: "shop_oauth" | "env_fallback";
};

function mapCreatorFromSearch(
  c: MarketplaceCreator,
  fallbackRegion: "US" | "UK",
): MarketplaceMetrics | null {
  return normalizeMarketplaceCreator(c, { fallbackRegion });
}

async function upsertDiscoveryProfile(
  mapped: MarketplaceMetrics,
  opts: { markCrawled?: boolean } = {},
) {
  const existing = await prisma.creatorDiscoveryProfile.findUnique({
    where: {
      platform_handle: { platform: "TIKTOK", handle: mapped.handle },
    },
    select: { id: true },
  });

  const crawledStamp = opts.markCrawled ? { lastCrawledAt: new Date() } : {};

  const row = await prisma.creatorDiscoveryProfile.upsert({
    where: {
      platform_handle: { platform: "TIKTOK", handle: mapped.handle },
    },
    create: {
      handle: mapped.handle,
      ...discoveryMetricsCreateData(mapped),
      categories: mapped.categories,
      bio: mapped.bio,
      source: "tiktok_affiliate_api",
      enabled: true,
      ...crawledStamp,
    },
    update: {
      ...discoveryMetricsUpdateData(mapped),
      categories: mapped.categories.length ? mapped.categories : undefined,
      bio: mapped.bio ?? undefined,
      source: "tiktok_affiliate_api",
      enabled: true,
      ...crawledStamp,
    },
  });

  void indexDiscoveryProfile(row);

  return { created: !existing };
}

/** Push marketplace snapshot into every org CRM row for this handle/open_id. */
async function propagateMetricsToCrm(mapped: MarketplaceMetrics) {
  const orFilters: Array<{ handle?: string; creatorOpenId?: string }> = [
    { handle: mapped.handle },
  ];
  if (mapped.creatorOpenId) {
    orFilters.push({ creatorOpenId: mapped.creatorOpenId });
  }

  const result = await prisma.creator.updateMany({
    where: {
      platform: "TIKTOK",
      OR: orFilters,
    },
    data: {
      ...metricsUpdateData(mapped),
    },
  });
  return result.count;
}

export function getDiscoveryTikTokStatus() {
  return getTikTokShopConfigStatus();
}

async function resolveSyncCredentials(
  options: DiscoveryTikTokSyncOptions,
): Promise<{
  credentials: TikTokShopCredentials;
  shopId: string | null;
  region: "US" | "UK";
  credentialSource: "shop_oauth" | "env_fallback";
}> {
  if (options.shopId) {
    if (!options.organizationId) {
      throw new AppError(
        "VALIDATION_ERROR",
        "organizationId is required when shopId is set",
        400,
      );
    }
    const shop = await prisma.shop.findFirst({
      where: {
        id: options.shopId,
        organizationId: options.organizationId,
        status: { not: "DISCONNECTED" },
      },
    });
    if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
    if (!shop.oauthConnectedAt) {
      throw new AppError(
        "SHOP_NOT_READY",
        "Shop has not completed TikTok OAuth. Open Shops → Authorize TikTok.",
        400,
      );
    }
    const credentials = await getShopOpenApiCredentials(
      options.organizationId,
      options.shopId,
    );
    return {
      credentials,
      shopId: shop.id,
      region: shop.region,
      credentialSource: "shop_oauth",
    };
  }

  const envCreds = getPlatformEnvCredentials();
  if (!envCreds) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Provide shopId (OAuth-connected shop) or set platform env access token + cipher",
      400,
    );
  }
  return {
    credentials: envCreds,
    shopId: null,
    region: env.TIKTOK_SHOP_REGION,
    credentialSource: "env_fallback",
  };
}

/** Run marketplace creator search and upsert into CreatorDiscoveryProfile. */
export async function syncDiscoveryFromTikTok(
  actorUserId: string | undefined,
  options: DiscoveryTikTokSyncOptions = {},
): Promise<DiscoveryTikTokSyncResult> {
  const appStatus = getTikTokShopConfigStatus();
  if (!appStatus.appConfigured) {
    throw new AppError(
      "FAILED_PRECONDITION",
      `TikTok app not configured: missing ${appStatus.missing.join(", ")}`,
      400,
    );
  }

  const resolved = await resolveSyncCredentials(options);
  const maxPages = Math.min(Math.max(options.maxPages ?? 3, 1), 20);
  const pageSize = options.pageSize === 12 ? 12 : 20;
  const propagateCrm = options.propagateCrm !== false;

  let pageToken: string | null = null;
  let searchKey: string | null = null;
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let crmPropagated = 0;
  let pages = 0;

  for (let i = 0; i < maxPages; i++) {
    const page = await searchMarketplaceCreators({
      credentials: resolved.credentials,
      pageSize,
      pageToken,
      keyword: options.keyword,
      searchKey,
      minFollowers: options.minFollowers,
      categoryIds: options.categoryIds,
    });
    pages += 1;
    searchKey = page.searchKey ?? searchKey;

    for (const raw of page.creators) {
      const mapped = mapCreatorFromSearch(raw, resolved.region);
      if (!mapped) {
        skipped += 1;
        continue;
      }
      try {
        const { created } = await upsertDiscoveryProfile(mapped, {
          markCrawled: options.markCrawled === true,
        });
        if (created) imported += 1;
        else updated += 1;

        if (propagateCrm) {
          crmPropagated += await propagateMetricsToCrm(mapped);
        }
      } catch (err) {
        skipped += 1;
        logger.info("discovery tiktok upsert skipped", {
          handle: mapped.handle,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  if (actorUserId) {
    await writeAuditLog({
      actorUserId,
      action: "discovery.tiktok.sync",
      entityType: "CreatorDiscoveryProfile",
      meta: {
        imported,
        updated,
        skipped,
        crmPropagated,
        pages,
        keyword: options.keyword ?? null,
        shopId: resolved.shopId,
        credentialSource: resolved.credentialSource,
        minFollowers: options.minFollowers ?? null,
        categoryIds: options.categoryIds ?? null,
      },
    });
  }

  return {
    ok: true,
    imported,
    updated,
    skipped,
    crmPropagated,
    pages,
    source: "tiktok_affiliate_api",
    region: resolved.region,
    shopId: resolved.shopId,
    credentialSource: resolved.credentialSource,
  };
}

/**
 * Refresh CRM creators that already have creatorOpenId via GetMarketplaceCreatorPerformance.
 * Also updates the shared discovery profile.
 */
export async function refreshOrgCreatorMetrics(input: {
  organizationId: string;
  shopId: string;
  actorUserId?: string;
  limit?: number;
}): Promise<{
  refreshed: number;
  skipped: number;
  failed: number;
}> {
  await resolveSyncCredentials({
    shopId: input.shopId,
    organizationId: input.organizationId,
  });
  const credentials = await getShopOpenApiCredentials(
    input.organizationId,
    input.shopId,
  );

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const creators = await prisma.creator.findMany({
    where: {
      organizationId: input.organizationId,
      platform: "TIKTOK",
      creatorOpenId: { not: null },
    },
    orderBy: [{ metricsSyncedAt: "asc" }, { updatedAt: "asc" }],
    take: limit,
  });

  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const creator of creators) {
    const openId = creator.creatorOpenId?.trim();
    if (!openId) {
      skipped += 1;
      continue;
    }
    try {
      const perf = await getMarketplaceCreatorPerformance({
        credentials,
        creatorOpenId: openId,
      });
      const mapped =
        normalizeMarketplaceCreator(
          {
            ...perf.raw,
            username: perf.username ?? creator.handle,
            nickname: perf.nickname ?? creator.displayName,
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
            video_gmv: perf.videoGmvAmount
              ? { amount: perf.videoGmvAmount }
              : undefined,
            live_gmv: perf.liveGmvAmount
              ? { amount: perf.liveGmvAmount }
              : undefined,
            product_card_gmv: perf.productCardGmvAmount
              ? { amount: perf.productCardGmvAmount }
              : undefined,
            gpm:
              perf.gpmAmount || perf.gpmRange
                ? {
                    amount: perf.gpmAmount ?? undefined,
                    currency: perf.gpmCurrency ?? undefined,
                    formatted_range: perf.gpmRange ?? undefined,
                  }
                : undefined,
            avg_commission: perf.avgCommissionRange
              ? { formatted_range: perf.avgCommissionRange }
              : undefined,
            units_sold: perf.unitsSold,
            email: perf.contactEmail,
            bio: perf.bio,
            selection_region: creator.region,
          },
          { fallbackRegion: creator.region === "UK" ? "UK" : "US" },
        ) ?? null;

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

      const handle = mapped.handle || creator.handle;

      await prisma.creator.update({
        where: { id: creator.id },
        data: {
          ...metricsUpdateData(mapped),
          handle,
          ...(mapped.contactEmail && !creator.contactEmail
            ? { contactEmail: mapped.contactEmail }
            : {}),
        },
      });

      await prisma.creatorDiscoveryProfile.upsert({
        where: {
          platform_handle: {
            platform: "TIKTOK",
            handle,
          },
        },
        create: {
          handle,
          ...discoveryMetricsCreateData(mapped),
          categories: mapped.categories,
          bio: mapped.bio,
          source: "tiktok_affiliate_api",
          enabled: true,
        },
        update: {
          ...discoveryMetricsUpdateData(mapped),
          bio: mapped.bio ?? undefined,
          source: "tiktok_affiliate_api",
          enabled: true,
        },
      });

      refreshed += 1;
    } catch (err) {
      failed += 1;
      logger.info("creator metrics refresh failed", {
        creatorId: creator.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (input.actorUserId) {
    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "creators.metrics.refresh",
      entityType: "Creator",
      meta: {
        organizationId: input.organizationId,
        shopId: input.shopId,
        refreshed,
        skipped,
        failed,
      },
    });
  }

  return { refreshed, skipped, failed };
}

export type DiscoverySyncEnqueueResult = {
  jobId: string;
  queue: string;
  status: "QUEUED";
};

export async function enqueueDiscoveryTikTokSync(
  triggeredBy: string | undefined,
  options: DiscoveryTikTokSyncOptions = {},
): Promise<DiscoverySyncEnqueueResult> {
  await resolveSyncCredentials(options);

  try {
    const job = await discoverySyncQueue.add(
      "tiktok-marketplace-sync",
      {
        triggeredBy,
        requestedAt: new Date().toISOString(),
        options,
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
      `Unable to enqueue discovery sync: ${message}`,
      503,
    );
  }
}

export async function enqueueCreatorMetricsRefresh(input: {
  triggeredBy: string | undefined;
  organizationId: string;
  shopId: string;
  limit?: number;
}): Promise<DiscoverySyncEnqueueResult> {
  await resolveSyncCredentials({
    shopId: input.shopId,
    organizationId: input.organizationId,
  });

  try {
    const job = await discoverySyncQueue.add(
      "tiktok-crm-metrics-refresh",
      {
        mode: "crm_metrics_refresh",
        triggeredBy: input.triggeredBy,
        requestedAt: new Date().toISOString(),
        organizationId: input.organizationId,
        shopId: input.shopId,
        limit: input.limit,
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
      `Unable to enqueue metrics refresh: ${message}`,
      503,
    );
  }
}

export async function getDiscoverySyncQueueStatus() {
  const queue = getDiscoverySyncQueue();
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
  );
  const [latest] = await queue.getJobs(
    ["completed", "failed", "active", "waiting", "delayed"],
    0,
    0,
  );

  return {
    counts,
    latest: latest
      ? {
          id: latest.id,
          name: latest.name,
          finishedOn: latest.finishedOn ?? null,
          failedReason: latest.failedReason ?? null,
        }
      : null,
  };
}

export async function getOrgDiscoveryTikTokStatus(organizationId: string) {
  const config = getTikTokShopConfigStatus();
  const shops = await prisma.shop.findMany({
    where: {
      organizationId,
      status: { not: "DISCONNECTED" },
    },
    select: {
      id: true,
      displayName: true,
      region: true,
      status: true,
      oauthConnectedAt: true,
      externalShopId: true,
      tiktokGrantedScopes: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    config,
    shops: shops.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      region: s.region,
      status: s.status,
      oauthConnected: Boolean(s.oauthConnectedAt),
      externalShopId: s.externalShopId,
      hasCreatorMarketplaceScope: s.tiktokGrantedScopes.includes(
        "seller.creator_marketplace.read",
      ),
    })),
  };
}
