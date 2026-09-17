import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  SESSION_VAULT_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().default(604800),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  TRUST_PROXY: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SHOP_VERIFY_MODE: z.enum(["stub", "playwright"]).default("stub"),
  /** When true (default), PLAYWRIGHT mode activates without real browser. */
  PLAYWRIGHT_SHOP_VERIFY_DRY_RUN: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  PASSWORD_RESET_TTL_SEC: z.coerce.number().default(3600),
  INVITE_TTL_SEC: z.coerce.number().default(604800),
  PLATFORM_SUPERADMIN_EMAIL: z.string().email().optional(),
  PLATFORM_SUPERADMIN_PASSWORD: z.string().min(8).optional(),
  /** Precomputed argon2id hash; use when native argon2 cannot run (e.g. blocked on Windows). */
  PLATFORM_SUPERADMIN_PASSWORD_HASH: z.string().min(1).optional(),
  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
