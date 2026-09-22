import { z } from "zod";

/** UI sends percent (e.g. 15 = 15%). Converted to TikTok units (×100) server-side. */
const commissionPercent = z.number().min(10).max(80);

export const inviteProductSchema = z.object({
  id: z.string().trim().min(1).max(64),
  /** Percent, e.g. 15 for 15%. Min 10% per TikTok. */
  commissionPercent: commissionPercent,
  shopAdsCommissionPercent: commissionPercent.optional(),
});

export const createAffiliateInviteSchema = z
  .object({
    shopId: z.string().min(1),
    campaignId: z.string().min(1).optional().nullable(),
    name: z.string().trim().min(1).max(120),
    message: z.string().trim().max(2000).optional().nullable(),
    /** ISO datetime; must be in the future. */
    endAt: z.string().datetime(),
    sellerContactEmail: z
      .string()
      .trim()
      .email()
      .optional()
      .nullable()
      .or(z.literal("")),
    hasFreeSample: z.boolean().optional(),
    sampleApprovalExempt: z.boolean().optional(),
    products: z.array(inviteProductSchema).min(1).max(100),
    /** Explicit CRM creator ids (max 50). Omit when using listId. */
    creatorIds: z.array(z.string().min(1)).max(50).optional(),
    /** Expand list members into creatorIds (capped at 50). */
    listId: z.string().min(1).optional(),
    /** When true, call TikTok inline. Default queues. */
    sync: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.listId) || (v.creatorIds?.length ?? 0) > 0, {
    message: "Provide creatorIds or listId",
    path: ["creatorIds"],
  });

export const listProductsQuerySchema = z.object({
  shopId: z.string().min(1),
  pageToken: z.string().optional().nullable(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
