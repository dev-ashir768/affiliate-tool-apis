import { z } from "zod";

export const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export const patchCurrentOrgSchema = z.object({
  name: z.string().min(1),
});

export const acceptInviteSchema = z.object({
  password: z.string().min(8).optional(),
  name: z.string().min(1).optional(),
});
