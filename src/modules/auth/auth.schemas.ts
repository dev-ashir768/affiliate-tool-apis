import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  organizationName: z.string().min(1),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export const totpCodeSchema = z.object({
  code: z.string().trim().min(6).max(32),
});

export const verifyTotpSchema = z.object({
  code: z.string().trim().min(6).max(32),
  rememberDevice: z.boolean().optional(),
});

export const adminResetTotpSchema = z.object({
  userId: z.string().min(1),
});
