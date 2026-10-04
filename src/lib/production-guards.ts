import { env } from "../config/env.js";
import { AppError } from "./errors.js";

/** True when process is running as production. */
export function isProduction(): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Refuse stub / dry-run / fixture shop verify in production.
 * Call before enqueue and before worker activation.
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
 */
export function assertProductionBootConfig(): void {
  if (!isProduction()) return;

  assertShopVerifySafeForEnv();

  if (env.EMAIL_PROVIDER === "console") {
    throw new Error(
      "EMAIL_PROVIDER=console is not allowed in production. Use EMAIL_PROVIDER=smtp.",
    );
  }

  if (!env.PORTAL_BFF_SECRET) {
    throw new Error(
      "PORTAL_BFF_SECRET is required in production so refresh tokens are not returned to arbitrary API clients.",
    );
  }

  const vault = env.SESSION_VAULT_KEY.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(vault) && Buffer.byteLength(vault, "utf8") < 32) {
    throw new Error(
      "SESSION_VAULT_KEY must be 64 hex chars (preferred) or ≥32 UTF-8 bytes.",
    );
  }
}
