import { MeiliSearch, type Index } from "meilisearch";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";

export type DiscoverySearchDoc = {
  id: string;
  handle: string;
  displayName: string | null;
  region: string | null;
  followerCount: number | null;
  unitsSold: number | null;
  gmvCents: number | null;
  gmvRange: string | null;
  gmvAmount: string | null;
  bio: string | null;
  categories: string[];
  contactEmail: string | null;
  enabled: boolean;
  source: string;
  updatedAt: number;
};

let _client: MeiliSearch | null | undefined;
let _indexReady = false;

export function isMeiliConfigured(): boolean {
  return Boolean(env.MEILI_HOST);
}

function getClient(): MeiliSearch | null {
  if (!env.MEILI_HOST) return null;
  if (_client === undefined) {
    _client = new MeiliSearch({
      host: env.MEILI_HOST,
      apiKey: env.MEILI_API_KEY,
    });
  }
  return _client;
}

async function ensureIndex(): Promise<Index<DiscoverySearchDoc> | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const index = client.index<DiscoverySearchDoc>(env.MEILI_INDEX_DISCOVERY);
    if (!_indexReady) {
      await client.createIndex(env.MEILI_INDEX_DISCOVERY, {
        primaryKey: "id",
      }).catch(() => undefined);
      await index.updateSettings({
        searchableAttributes: [
          "handle",
          "displayName",
          "bio",
          "gmvRange",
          "categories",
          "contactEmail",
        ],
        filterableAttributes: [
          "enabled",
          "region",
          "followerCount",
          "unitsSold",
          "gmvCents",
          "source",
          "contactEmail",
        ],
        sortableAttributes: [
          "followerCount",
          "unitsSold",
          "gmvCents",
          "updatedAt",
        ],
      });
      _indexReady = true;
    }
    return index;
  } catch (err) {
    logger.info("meilisearch index ensure failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function toDiscoverySearchDoc(row: {
  id: string;
  handle: string;
  displayName: string | null;
  region: string | null;
  followerCount: number | null;
  unitsSold: number | null;
  gmvCents: number | null;
  gmvRange: string | null;
  gmvAmount: string | null;
  bio: string | null;
  categories: string[];
  contactEmail: string | null;
  enabled: boolean;
  source: string;
  updatedAt: Date;
}): DiscoverySearchDoc {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    region: row.region,
    followerCount: row.followerCount,
    unitsSold: row.unitsSold,
    gmvCents: row.gmvCents,
    gmvRange: row.gmvRange,
    gmvAmount: row.gmvAmount,
    bio: row.bio,
    categories: row.categories,
    contactEmail: row.contactEmail,
    enabled: row.enabled,
    source: row.source,
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Fire-and-forget upsert into Meili (never throws to callers). */
export async function indexDiscoveryProfile(row: {
  id: string;
  handle: string;
  displayName: string | null;
  region: string | null;
  followerCount: number | null;
  unitsSold?: number | null;
  gmvCents?: number | null;
  gmvRange?: string | null;
  gmvAmount?: string | null;
  bio: string | null;
  categories: string[];
  contactEmail?: string | null;
  enabled: boolean;
  source: string;
  updatedAt: Date;
}): Promise<void> {
  const index = await ensureIndex();
  if (!index) return;
  try {
    await index.addDocuments([
      toDiscoverySearchDoc({
        ...row,
        unitsSold: row.unitsSold ?? null,
        gmvCents: row.gmvCents ?? null,
        gmvRange: row.gmvRange ?? null,
        gmvAmount: row.gmvAmount ?? null,
        contactEmail: row.contactEmail ?? null,
      }),
    ]);
  } catch (err) {
    logger.info("meilisearch index upsert failed", {
      id: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function removeDiscoveryFromIndex(id: string): Promise<void> {
  const index = await ensureIndex();
  if (!index) return;
  try {
    await index.deleteDocument(id);
  } catch (err) {
    logger.info("meilisearch delete failed", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type MeiliDiscoverySearchParams = {
  page: number;
  pageSize: number;
  search?: string;
  region?: "US" | "UK";
  minFollowers?: number;
  maxFollowers?: number;
  minUnitsSold?: number;
  minGmvCents?: number;
  gmvRangeContains?: string;
  hasEmail?: boolean;
  sortBy?: "followers" | "units" | "updated" | "gmv";
  enabledOnly?: boolean;
};

/**
 * Search Meili when configured. Returns null to signal Postgres fallback.
 */
export async function searchDiscoveryInMeili(
  params: MeiliDiscoverySearchParams,
): Promise<{ ids: string[]; total: number; engine: "meilisearch" } | null> {
  const index = await ensureIndex();
  if (!index) return null;

  const filters: string[] = [];
  if (params.enabledOnly !== false) filters.push("enabled = true");
  if (params.region) filters.push(`region = "${params.region}"`);
  if (params.minFollowers != null) {
    filters.push(`followerCount >= ${params.minFollowers}`);
  }
  if (params.maxFollowers != null) {
    filters.push(`followerCount <= ${params.maxFollowers}`);
  }
  if (params.minUnitsSold != null) {
    filters.push(`unitsSold >= ${params.minUnitsSold}`);
  }
  if (params.minGmvCents != null) {
    filters.push(`gmvCents >= ${params.minGmvCents}`);
  }
  if (params.hasEmail === true) {
    filters.push("contactEmail IS NOT EMPTY");
  } else if (params.hasEmail === false) {
    filters.push("contactEmail IS EMPTY");
  }

  const sort =
    params.sortBy === "units"
      ? ["unitsSold:desc"]
      : params.sortBy === "updated"
        ? ["updatedAt:desc"]
        : params.sortBy === "gmv"
          ? ["gmvCents:desc"]
          : ["followerCount:desc"];

  const q = params.search?.trim() ?? "";
  // Meili filter can't do contains on gmvRange easily — fold into query.
  const query =
    params.gmvRangeContains?.trim() ?
      `${q} ${params.gmvRangeContains.trim()}`.trim()
    : q;

  try {
    const offset = (params.page - 1) * params.pageSize;
    const result = await index.search(query, {
      filter: filters.length ? filters.join(" AND ") : undefined,
      sort,
      limit: params.pageSize,
      offset,
      attributesToRetrieve: ["id"],
    });
    const ids = (result.hits ?? [])
      .map((h) => (h as { id?: string }).id)
      .filter((id): id is string => Boolean(id));
    return {
      ids,
      total: result.estimatedTotalHits ?? result.hits.length,
      engine: "meilisearch",
    };
  } catch (err) {
    logger.info("meilisearch search failed; falling back to postgres", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Full reindex from Postgres (ops). Batches of 500. */
export async function reindexDiscoveryToMeili(): Promise<{
  indexed: number;
  engine: "meilisearch" | "disabled";
}> {
  if (!isMeiliConfigured()) {
    return { indexed: 0, engine: "disabled" };
  }
  const index = await ensureIndex();
  if (!index) {
    return { indexed: 0, engine: "disabled" };
  }

  let indexed = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.creatorDiscoveryProfile.findMany({
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        handle: true,
        displayName: true,
        region: true,
        followerCount: true,
        unitsSold: true,
        gmvCents: true,
        gmvRange: true,
        gmvAmount: true,
        bio: true,
        categories: true,
        contactEmail: true,
        enabled: true,
        source: true,
        updatedAt: true,
      },
    });
    if (!rows.length) break;
    await index.addDocuments(rows.map(toDiscoverySearchDoc));
    indexed += rows.length;
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < 500) break;
  }
  return { indexed, engine: "meilisearch" };
}

export async function getMeiliStatus() {
  if (!isMeiliConfigured()) {
    return { configured: false, reachable: false, index: null as string | null };
  }
  try {
    const client = getClient()!;
    await client.health();
    const stats = await client
      .index(env.MEILI_INDEX_DISCOVERY)
      .getStats()
      .catch(() => null);
    return {
      configured: true,
      reachable: true,
      index: env.MEILI_INDEX_DISCOVERY,
      numberOfDocuments: stats?.numberOfDocuments ?? null,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      index: env.MEILI_INDEX_DISCOVERY,
      numberOfDocuments: null,
    };
  }
}
