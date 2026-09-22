import { z } from "zod";

export const createCreatorSchema = z.object({
  handle: z.string().trim().min(1).max(100),
  displayName: z.string().trim().max(200).optional().nullable(),
  contactEmail: z
    .string()
    .trim()
    .email()
    .optional()
    .nullable()
    .or(z.literal("")),
  region: z.enum(["US", "UK"]).optional().nullable(),
  followerCount: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  creatorOpenId: z.string().trim().min(1).max(200).optional().nullable(),
  stage: z
    .enum(["LEAD", "CONTACTED", "INVITED", "ACTIVE", "REJECTED"])
    .optional(),
});

export const patchCreatorSchema = createCreatorSchema.partial();

export const createCreatorListSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
});

export const addListMemberSchema = z.object({
  creatorId: z.string().min(1),
});

export const bulkAddListMembersSchema = z.object({
  creatorIds: z.array(z.string().min(1)).min(1).max(200),
});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brief: z.string().trim().max(10_000).optional().nullable(),
  offerNote: z.string().trim().max(2000).optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "DONE"]).optional(),
});

export const patchCampaignSchema = createCampaignSchema.partial();

const multiShopProductSchema = z.object({
  id: z.string().trim().min(1).max(64),
  commissionPercent: z.number().min(10).max(80),
  shopAdsCommissionPercent: z.number().min(10).max(80).optional(),
});

export const runCampaignAcrossShopsSchema = z
  .object({
    shopIds: z.array(z.string().min(1)).min(1).max(5),
    listId: z.string().min(1).optional(),
    creatorIds: z.array(z.string().min(1)).max(50).optional(),
    inviteName: z.string().trim().min(1).max(120),
    message: z.string().trim().max(2000).optional().nullable(),
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
    products: z.array(multiShopProductSchema).min(1).max(100),
    /** When true, also queue an EMAIL→INVITE automation per shop (needs templateId). */
    withEmailStep: z.boolean().optional(),
    templateId: z.string().min(1).optional(),
    emailDelayMinutes: z
      .number()
      .int()
      .min(0)
      .max(60 * 24)
      .optional(),
  })
  .refine((v) => Boolean(v.listId) || (v.creatorIds?.length ?? 0) > 0, {
    message: "Provide creatorIds or listId",
    path: ["creatorIds"],
  })
  .superRefine((v, ctx) => {
    if (v.withEmailStep && !v.templateId) {
      ctx.addIssue({
        code: "custom",
        message: "templateId required when withEmailStep is true",
        path: ["templateId"],
      });
    }
  });
