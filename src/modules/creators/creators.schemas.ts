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

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brief: z.string().trim().max(10_000).optional().nullable(),
  offerNote: z.string().trim().max(2000).optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "DONE"]).optional(),
});

export const patchCampaignSchema = createCampaignSchema.partial();
