import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

/** True when process is running as production. */
export function isProduction(): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Refuse stub / dry-run / fixture shop verify in production.
 * Call before enqueue and before worker activation — not at process boot,
 * so the API can serve when live TikTok seller verify is not configured yet.
 */
export function assertShopVerifySafeForEnv(): void {
  if (!isProduction()) return;

  if (env.SHOP_VERIFY_MODE !== "playwright") {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Production refuses SHOP_VERIFY_MODE=stub. Set SHOP_VERIFY_MODE=playwright.",
      503,
    );
  }
  if (env.PLAYWRIGHT_SHOP_VERIFY_DRY_RUN) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Production refuses PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=true. Set it to false.",
      503,
    );
  }
  if (env.SHOP_VERIFY_TARGET !== "live") {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Production refuses SHOP_VERIFY_TARGET=fixture. Set SHOP_VERIFY_TARGET=live.",
      503,
    );
  }
  if (!env.SHOP_VERIFY_LIVE_URL_US && !env.SHOP_VERIFY_LIVE_URL_UK) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Production shop verify requires SHOP_VERIFY_LIVE_URL_US and/or SHOP_VERIFY_LIVE_URL_UK.",
      503,
    );
  }
}

/**
 * Boot-time checks for API/worker. Throws so misconfigured prod never serves.
 * Local/dev (NODE_ENV≠production) is unaffected.
 *
 * Shop-verify live config is NOT required at boot — enforced when verify runs.
 * EMAIL_PROVIDER=console warns (does not crash) until SMTP is configured.
 */
export function assertProductionBootConfig(): void {
  if (!isProduction()) return;

  if (env.EMAIL_PROVIDER === "console") {
    logger.warn(
      "EMAIL_PROVIDER=console in production — transactional email will only log. Set EMAIL_PROVIDER=smtp when ready.",
    );
  }

  if (!env.JWT_PRIVATE_KEY) {
    logger.warn(
      "JWT_PRIVATE_KEY unset in production — access tokens use HS256 and the portal must hold the signing secret. Configure the Ed25519 keypair.",
    );
  }

  if (!env.PORTAL_BFF_SECRET) {
    throw new Error(
      "PORTAL_BFF_SECRET is required in production so refresh tokens are not returned to arbitrary API clients.",
    );
  }

  if (!env.PORTAL_BASE_URL?.trim()) {
    throw new Error(
      "PORTAL_BASE_URL is required in production for Stripe return URLs, invites, and password-reset links.",
    );
  }

  try {
    const portal = new URL(env.PORTAL_BASE_URL.trim());
    if (portal.protocol !== "https:") {
      throw new Error("PORTAL_BASE_URL must use https in production.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("https")) throw err;
    throw new Error("PORTAL_BASE_URL must be a valid absolute URL.");
  }

  const vault = env.SESSION_VAULT_KEY.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(vault) && Buffer.byteLength(vault, "utf8") < 32) {
    throw new Error(
      "SESSION_VAULT_KEY must be 64 hex chars (preferred) or ≥32 UTF-8 bytes.",
    );
  }
}
