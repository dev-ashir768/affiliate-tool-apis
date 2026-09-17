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
