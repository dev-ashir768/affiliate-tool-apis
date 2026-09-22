import { z } from "zod";

export const messagesShopQuerySchema = z.object({
  shopId: z.string().min(1),
  pageToken: z.string().optional().nullable(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  /** When true, refresh from TikTok OpenAPI. Default true. */
  sync: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
});

export const createConversationSchema = z.object({
  shopId: z.string().min(1),
  creatorId: z.string().min(1),
});

export const sendImMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

export const markReadSchema = z.object({
  shopId: z.string().min(1),
  conversationIds: z.array(z.string().min(1)).min(1).max(20),
});
