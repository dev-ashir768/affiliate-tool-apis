import { z } from "zod";

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  bodyText: z.string().trim().min(1).max(20_000),
});

export const patchTemplateSchema = createTemplateSchema.partial();

export const sendOutreachSchema = z.object({
  creatorId: z.string().min(1),
  templateId: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional().nullable(),
  subject: z.string().trim().min(1).max(200).optional(),
  bodyText: z.string().trim().min(1).max(20_000).optional(),
});

export const bulkSendOutreachSchema = z
  .object({
    creatorIds: z.array(z.string().min(1)).max(100).optional(),
    /** Expand list members into creatorIds (capped at 100). */
    listId: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    campaignId: z.string().min(1).optional().nullable(),
    subject: z.string().trim().min(1).max(200).optional(),
    bodyText: z.string().trim().min(1).max(20_000).optional(),
    /** Inline send (small batches). Default false → queue. */
    sync: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.listId) || (v.creatorIds?.length ?? 0) > 0, {
    message: "Provide creatorIds or listId",
    path: ["creatorIds"],
  });
