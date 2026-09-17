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
  /** Override fixture URL for Playwright verify (file:// or http://). Empty = packaged fixture. */
  SHOP_VERIFY_FIXTURE_URL: z.string().optional(),
  /** fixture = local HTML; live = region Seller Center URL (must configure URLs). */
  SHOP_VERIFY_TARGET: z.enum(["fixture", "live"]).default("fixture"),
  SHOP_VERIFY_LIVE_URL_US: z.string().url().optional(),
  SHOP_VERIFY_LIVE_URL_UK: z.string().url().optional(),
  /** CSS selector for invite accept on live pages (override when TikTok DOM changes). */
  SHOP_VERIFY_LIVE_ACCEPT_SELECTOR: z.string().default("[data-e2e='invite-accept'], button:has-text('Accept')"),
  SHOP_VERIFY_LIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** none = skip; console = log-only; imap = poll bot mailbox for invite mail. */
  BOT_INBOX_PROVIDER: z.enum(["none", "console", "imap"]).default("none"),
  BOT_INBOX_POLL_MS: z.coerce.number().int().positive().default(5_000),
  BOT_INBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  BOT_INBOX_SUBJECT_INCLUDES: z.string().default("invite"),
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().int().default(993),
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),
  IMAP_TLS: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  SENTRY_DSN: z.string().optional(),
  PASSWORD_RESET_TTL_SEC: z.coerce.number().default(3600),
  INVITE_TTL_SEC: z.coerce.number().default(604800),
  PLATFORM_SUPERADMIN_EMAIL: z.string().email().optional(),
  PLATFORM_SUPERADMIN_PASSWORD: z.string().min(8).optional(),
  /** Precomputed argon2id hash; use when native argon2 cannot run (e.g. blocked on Windows). */
  PLATFORM_SUPERADMIN_PASSWORD_HASH: z.string().min(1).optional(),
  /** console = log only; smtp = nodemailer */
  EMAIL_PROVIDER: z.enum(["console", "smtp", "resend"]).default("console"),
  EMAIL_FROM: z.string().optional(),
  EMAIL_LOGO_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
