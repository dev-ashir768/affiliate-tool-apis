import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import {
  getTikTokShopConfigStatus,
  searchMarketplaceCreators,
  type MarketplaceCreator,
} from "../../lib/tiktok-shop/client.js";
import { env } from "../../config/env.js";
import {
  discoverySyncQueue,
  DISCOVERY_SYNC_QUEUE,
  getDiscoverySyncQueue,
} from "../../lib/queue.js";

export type DiscoveryTikTokSyncOptions = {
  maxPages?: number;
  keyword?: string | null;
  minFollowers?: number | null;
  pageSize?: 12 | 20;
};

export type DiscoveryTikTokSyncResult = {
  ok: true;
  imported: number;
  skipped: number;
  pages: number;
  source: "tiktok_affiliate_api";
  region: "US" | "UK";
};

function mapRegion(selection?: string | null): "US" | "UK" | null {
  if (!selection) return env.TIKTOK_SHOP_REGION;
  const s = selection.toUpperCase();
  if (s === "US" || s === "USA") return "US";
  if (s === "UK" || s === "GB" || s === "GBR") return "UK";
  return env.TIKTOK_SHOP_REGION;
}

function mapCreator(c: MarketplaceCreator) {
  const handle = (c.username || "").replace(/^@/, "").trim();
  if (!handle) return null;
  const categories = (c.category_ids ?? []).map(String).filter(Boolean);
  return {
    handle,
    displayName: c.nickname?.trim() || null,
    region: mapRegion(c.selection_region),
    followerCount:
      typeof c.follower_count === "number" ? c.follower_count : null,
    categories,
    bio: c.gmv_range?.formatted_range
      ? `GMV ${c.gmv_range.formatted_range}`
      : c.gmv?.amount
        ? `GMV ${c.gmv.amount} ${c.gmv.currency ?? ""}`.trim()
        : null,
    source: "tiktok_affiliate_api" as const,
    enabled: true,
  };
}

export function getDiscoveryTikTokStatus() {
  return getTikTokShopConfigStatus();
}

/** Run marketplace creator search and upsert into CreatorDiscoveryProfile. */
export async function syncDiscoveryFromTikTok(
  actorUserId: string | undefined,
  options: DiscoveryTikTokSyncOptions = {},
): Promise<DiscoveryTikTokSyncResult> {
  const status = getTikTokShopConfigStatus();
  if (!status.configured) {
    throw new AppError(
      "FAILED_PRECONDITION",
      `TikTok Shop OpenAPI not configured: missing ${status.missing.join(", ")}`,
      400,
    );
  }

  const maxPages = Math.min(Math.max(options.maxPages ?? 3, 1), 20);
  const pageSize = options.pageSize === 12 ? 12 : 20;

  let pageToken: string | null = null;
  let searchKey: string | null = null;
  let imported = 0;
  let skipped = 0;
  let pages = 0;

  for (let i = 0; i < maxPages; i++) {
    const page = await searchMarketplaceCreators({
      pageSize,
      pageToken,
      keyword: options.keyword,
      searchKey,
      minFollowers: options.minFollowers,
    });
    pages += 1;
    searchKey = page.searchKey ?? searchKey;

    for (const raw of page.creators) {
      const mapped = mapCreator(raw);
      if (!mapped) {
        skipped += 1;
        continue;
      }
      try {
        await prisma.creatorDiscoveryProfile.upsert({
          where: {
            platform_handle: { platform: "TIKTOK", handle: mapped.handle },
          },
          create: {
            handle: mapped.handle,
            displayName: mapped.displayName,
            region: mapped.region,
            followerCount: mapped.followerCount,
            categories: mapped.categories,
            bio: mapped.bio,
            source: mapped.source,
            enabled: true,
          },
          update: {
            displayName: mapped.displayName ?? undefined,
            region: mapped.region ?? undefined,
            followerCount: mapped.followerCount ?? undefined,
            categories: mapped.categories.length
              ? mapped.categories
              : undefined,
            bio: mapped.bio ?? undefined,
            source: mapped.source,
            enabled: true,
          },
        });
        imported += 1;
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
      meta: { imported, skipped, pages, keyword: options.keyword ?? null },
    });
  }

  return {
    ok: true,
    imported,
    skipped,
    pages,
    source: "tiktok_affiliate_api",
    region: env.TIKTOK_SHOP_REGION,
  };
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
  const status = getTikTokShopConfigStatus();
  if (!status.configured) {
    throw new AppError(
      "FAILED_PRECONDITION",
      `TikTok Shop OpenAPI not configured: missing ${status.missing.join(", ")}`,
      400,
    );
  }

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
    const message = err instanceof Error ? err.message : "Queue unavailable";
    throw new AppError(
      "INTERNAL",
      `Unable to enqueue discovery sync: ${message}`,
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
    queue: DISCOVERY_SYNC_QUEUE,
    counts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    },
    lastJobId: latest?.id != null ? String(latest.id) : null,
    lastJobState: latest ? await latest.getState() : null,
    lastRunAt: latest
      ? new Date(
          latest.finishedOn ?? latest.processedOn ?? latest.timestamp,
        ).toISOString()
      : null,
  };
}
