import { z } from "zod";

export const discoverySearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  region: z.enum(["US", "UK"]).optional(),
  minFollowers: z.coerce.number().int().nonnegative().optional(),
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
  profiles: z
    .array(createDiscoveryProfileSchema)
    .min(1)
    .max(500),
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
