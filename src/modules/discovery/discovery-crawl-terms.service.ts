import type { ShopRegion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { DISCOVERY_KEYWORDS_US } from "./data/discovery-keywords.us.js";

function normalizeKeyword(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function regionKeyOf(region: "US" | "UK" | null | undefined): string {
  return region ?? "ALL";
}

export async function listCrawlTerms(params: {
  region?: "US" | "UK";
  enabled?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = params.page ?? 1;
  const pageSize = Math.min(params.pageSize ?? 50, 200);
  const where: {
    enabled?: boolean;
    keyword?: { contains: string; mode: "insensitive" };
    OR?: Array<{ region: "US" | "UK" | null }>;
  } = {};

  if (params.enabled != null) where.enabled = params.enabled;
  if (params.region) {
    where.OR = [{ region: params.region }, { region: null }];
  }
  if (params.search?.trim()) {
    where.keyword = {
      contains: params.search.trim(),
      mode: "insensitive",
    };
  }

  const [total, rows] = await Promise.all([
    prisma.discoveryCrawlTerm.count({ where }),
    prisma.discoveryCrawlTerm.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { keyword: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      region: r.region,
      regionKey: r.regionKey,
      enabled: r.enabled,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    meta: { total, page, pageSize },
  };
}

export async function createCrawlTerm(
  input: {
    keyword: string;
    region?: "US" | "UK" | null;
    enabled?: boolean;
    sortOrder?: number;
  },
  actorUserId?: string,
) {
  const keyword = normalizeKeyword(input.keyword);
  if (!keyword) {
    throw new AppError("VALIDATION_ERROR", "keyword required", 400);
  }
  const region = input.region ?? null;
  try {
    const row = await prisma.discoveryCrawlTerm.create({
      data: {
        keyword,
        region,
        regionKey: regionKeyOf(region),
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    if (actorUserId) {
      await writeAuditLog({
        actorUserId,
        action: "discovery.crawl_term.create",
        entityType: "DiscoveryCrawlTerm",
        entityId: row.id,
      });
    }
    return {
      id: row.id,
      keyword: row.keyword,
      region: row.region,
      regionKey: row.regionKey,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError("CONFLICT", "Keyword already exists for region", 409);
    }
    throw err;
  }
}

export async function patchCrawlTerm(
  id: string,
  input: {
    keyword?: string;
    region?: "US" | "UK" | null;
    enabled?: boolean;
    sortOrder?: number;
  },
  actorUserId?: string,
) {
  const data: {
    keyword?: string;
    region?: ShopRegion | null;
    regionKey?: string;
    enabled?: boolean;
    sortOrder?: number;
  } = {};
  if (input.keyword != null) data.keyword = normalizeKeyword(input.keyword);
  if (input.region !== undefined) {
    data.region = input.region;
    data.regionKey = regionKeyOf(input.region);
  }
  if (input.enabled != null) data.enabled = input.enabled;
  if (input.sortOrder != null) data.sortOrder = input.sortOrder;

  try {
    const row = await prisma.discoveryCrawlTerm.update({
      where: { id },
      data,
    });
    if (actorUserId) {
      await writeAuditLog({
        actorUserId,
        action: "discovery.crawl_term.patch",
        entityType: "DiscoveryCrawlTerm",
        entityId: row.id,
      });
    }
    return {
      id: row.id,
      keyword: row.keyword,
      region: row.region,
      regionKey: row.regionKey,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      throw new AppError("NOT_FOUND", "Crawl term not found", 404);
    }
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError("CONFLICT", "Keyword already exists for region", 409);
    }
    throw err;
  }
}

export async function deleteCrawlTerm(id: string, actorUserId?: string) {
  try {
    await prisma.discoveryCrawlTerm.delete({ where: { id } });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      throw new AppError("NOT_FOUND", "Crawl term not found", 404);
    }
    throw err;
  }
  if (actorUserId) {
    await writeAuditLog({
      actorUserId,
      action: "discovery.crawl_term.delete",
      entityType: "DiscoveryCrawlTerm",
      entityId: id,
    });
  }
  return { ok: true as const };
}

/**
 * Seed file → DB when empty (idempotent). Call from planner / seed / ops.
 */
export async function ensureCrawlTermsSeeded(): Promise<{
  seeded: number;
  total: number;
}> {
  const existing = await prisma.discoveryCrawlTerm.count();
  if (existing > 0) {
    return { seeded: 0, total: existing };
  }
  let seeded = 0;
  for (let i = 0; i < DISCOVERY_KEYWORDS_US.length; i++) {
    const keyword = normalizeKeyword(DISCOVERY_KEYWORDS_US[i]!);
    if (!keyword) continue;
    try {
      await prisma.discoveryCrawlTerm.create({
        data: {
          keyword,
          region: null,
          regionKey: "ALL",
          enabled: true,
          sortOrder: i,
        },
      });
      seeded += 1;
    } catch {
      /* unique race — ignore */
    }
  }
  const total = await prisma.discoveryCrawlTerm.count();
  return { seeded, total };
}

/** Keywords for crawl planner: DB enabled terms for region (+ global), else seed file. */
export async function resolveCrawlKeywords(
  region?: "US" | "UK",
): Promise<string[]> {
  await ensureCrawlTermsSeeded();
  const rows = await prisma.discoveryCrawlTerm.findMany({
    where: {
      enabled: true,
      OR: region
        ? [{ region }, { region: null }]
        : undefined,
    },
    orderBy: [{ sortOrder: "asc" }, { keyword: "asc" }],
    select: { keyword: true },
  });
  if (rows.length) {
    return [...new Set(rows.map((r) => r.keyword))];
  }
  return [...DISCOVERY_KEYWORDS_US];
}
