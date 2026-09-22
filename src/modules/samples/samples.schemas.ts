import { z } from "zod";

export const syncSamplesSchema = z.object({
  shopId: z.string().min(1),
  maxPages: z.coerce.number().int().min(1).max(10).optional(),
});

export const reviewSampleSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).optional().nullable(),
});

export const createSampleSchema = z.object({
  shopId: z.string().min(1),
  creatorId: z.string().min(1).optional().nullable(),
  productTitle: z.string().trim().max(200).optional().nullable(),
  externalProductId: z.string().trim().max(64).optional().nullable(),
  creatorUsername: z.string().trim().max(100).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const listSamplesQuerySchema = z.object({
  status: z
    .enum([
      "PENDING",
      "APPROVED",
      "REJECTED",
      "FULFILLING",
      "FULFILLED",
      "FAILED",
      "CANCELED",
    ])
    .optional(),
  shopId: z.string().min(1).optional(),
});
