import { env } from "../config/env.js";
import { AppError } from "./errors.js";

/** Portal origin for Stripe redirects, invite links, and password reset (no trailing slash). */
export function portalBaseUrl(): string {
  const explicit = env.PORTAL_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const origin = env.CORS_ORIGINS.split(",")[0]?.trim();
  if (!origin) {
    throw new AppError("INTERNAL", "PORTAL_BASE_URL or CORS_ORIGINS is not configured", 500);
  }
  return origin.replace(/\/$/, "");
}
