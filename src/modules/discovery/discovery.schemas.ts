import { z } from "zod";

export const discoverySearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  region: z.enum(["US", "UK"]).optional(),
  minFollowers: z.coerce.number().int().nonnegative().optional(),
  maxFollowers: z.coerce.number().int().nonnegative().optional(),
  minUnitsSold: z.coerce.number().int().nonnegative().optional(),
  /** Exact GMV floor in cents (from parsed gmvAmount). */
  minGmvCents: z.coerce.number().int().nonnegative().optional(),
  /** Match Partner-style GMV band labels stored in gmvRange (e.g. "150K", "$1K"). */
  gmvRangeContains: z.string().trim().max(40).optional(),
  hasEmail: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (typeof v === "boolean") return v;
      return v === "true";
    }),
  sortBy: z
    .enum(["followers", "units", "updated", "gmv"])
    .optional()
    .default("followers"),
});

export const createDiscoveryProfileSchema = z.object({
  handle: z.string().trim().min(1).max(100),
  displayName: z.string().trim().max(200).optional().nullable(),
  region: z.enum(["US", "UK"]).optional().nullable(),
  followerCount: z.number().int().nonnegative().optional().nullable(),
  categories: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  bio: z.string().trim().max(2000).optional().nullable(),
  source: z.string().trim().max(40).optional(),
  enabled: z.boolean().optional(),
});

export const importDiscoverySchema = z.object({
  profiles: z.array(createDiscoveryProfileSchema).min(1).max(500),
});

export const tiktokDiscoverySyncSchema = z.object({
  maxPages: z.coerce.number().int().min(1).max(20).optional(),
  keyword: z.string().trim().max(100).optional().nullable(),
  minFollowers: z.coerce.number().int().nonnegative().optional().nullable(),
  pageSize: z.union([z.literal(12), z.literal(20)]).optional(),
  /** Niche category ids from TikTok (optional). */
  categoryIds: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .optional()
    .nullable(),
  /** OAuth-connected shop. Required for merchant sync; optional for platform env fallback. */
  shopId: z.string().min(1).optional().nullable(),
  /** Platform ops: required when shopId is set. Ignored on merchant routes (uses auth org). */
  organizationId: z.string().min(1).optional().nullable(),
  /**
   * After discovery upsert, push followers/GMV into matching CRM Creator rows.
   * Default true.
   */
  propagateCrm: z.boolean().optional(),
  /** When true, run inline instead of BullMQ (ops/debug). Default false. */
  sync: z.boolean().optional(),
});

export const refreshCreatorMetricsSchema = z.object({
  shopId: z.string().min(1),
  /** Limit how many CRM creators to refresh (default 50, max 100). */
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** When true, run inline. Default false → queue. */
  sync: z.boolean().optional(),
});

export const discoveryCrawlPlanSchema = z.object({
  shopId: z.string().min(1),
  organizationId: z.string().min(1),
  region: z.enum(["US", "UK"]).optional(),
  skipDays: z.coerce.number().int().min(0).max(90).optional(),
  maxPages: z.coerce.number().int().min(1).max(20).optional(),
  pageSize: z.union([z.literal(12), z.literal(20)]).optional(),
  maxCells: z.coerce.number().int().min(1).max(5_000).optional(),
  followerBands: z
    .array(z.number().int().nonnegative())
    .min(1)
    .max(20)
    .optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(500).optional(),
  /** When true, run planner inline (enqueue cells immediately). Default false → queue plan job. */
  sync: z.boolean().optional(),
});

export const discoveryMetricsRefreshSchema = z.object({
  shopId: z.string().min(1),
  organizationId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  olderThanHours: z.coerce.number().int().min(1).max(24 * 90).optional(),
  sync: z.boolean().optional(),
});

export const createOrderSchema = z.object({
  externalOrderId: z.string().trim().min(1).max(120),
  gmvCents: z.number().int().nonnegative(),
  currency: z.string().trim().min(3).max(8).default("USD"),
  status: z.enum(["PENDING", "PAID", "REFUNDED", "CANCELED"]).optional(),
  orderedAt: z.string().datetime(),
  shopId: z.string().min(1).optional().nullable(),
  creatorId: z.string().min(1).optional().nullable(),
  commissionCents: z.number().int().nonnegative().optional(),
});

export const syncOrdersSchema = z.object({
  shopId: z.string().min(1),
  lookbackDays: z.coerce.number().int().min(1).max(90).optional(),
  maxPages: z.coerce.number().int().min(1).max(10).optional(),
});
