import { z } from "zod";

const emailStepSchema = z.object({
  kind: z.literal("EMAIL"),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 14).default(0),
  templateId: z.string().min(1).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  bodyText: z.string().trim().min(1).max(20_000).optional(),
});

const inviteProductSchema = z.object({
  id: z.string().trim().min(1).max(64),
  commissionPercent: z.number().min(10).max(80),
  shopAdsCommissionPercent: z.number().min(10).max(80).optional(),
});

const inviteStepSchema = z.object({
  kind: z.literal("AFFILIATE_INVITE"),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 14).default(0),
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
  products: z.array(inviteProductSchema).min(1).max(100),
});

const imStepSchema = z.object({
  kind: z.literal("CREATOR_IM"),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 14).default(0),
  bodyText: z.string().trim().min(1).max(2000),
});

export const createAutomationRunSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    campaignId: z.string().min(1).optional().nullable(),
    shopId: z.string().min(1).optional().nullable(),
    creatorIds: z.array(z.string().min(1)).max(100).optional(),
    listId: z.string().min(1).optional(),
    steps: z
      .array(
        z.discriminatedUnion("kind", [
          emailStepSchema,
          inviteStepSchema,
          imStepSchema,
        ]),
      )
      .min(1)
      .max(5),
  })
  .refine((v) => Boolean(v.listId) || (v.creatorIds?.length ?? 0) > 0, {
    message: "Provide creatorIds or listId",
    path: ["creatorIds"],
  })
  .superRefine((val, ctx) => {
    const needsShop = val.steps.some(
      (s) => s.kind === "AFFILIATE_INVITE" || s.kind === "CREATOR_IM",
    );
    if (needsShop && !val.shopId) {
      ctx.addIssue({
        code: "custom",
        message: "shopId is required when a step is AFFILIATE_INVITE or CREATOR_IM",
        path: ["shopId"],
      });
    }
    for (const [i, step] of val.steps.entries()) {
      if (step.kind === "EMAIL" && !step.templateId && (!step.subject || !step.bodyText)) {
        ctx.addIssue({
          code: "custom",
          message: "EMAIL step needs templateId or subject+bodyText",
          path: ["steps", i],
        });
      }
    }
  });
