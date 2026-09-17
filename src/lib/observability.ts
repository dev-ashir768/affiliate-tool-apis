import { env } from "../config/env.js";
import { logger } from "./logger.js";

/** Optional Sentry bootstrap — no-op without DSN or @sentry/node. */
export async function initObservability() {
  if (!env.SENTRY_DSN) {
    logger.info("observability: SENTRY_DSN unset; skipping");
    return;
  }
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
    });
    logger.info("observability: Sentry initialized");
  } catch {
    logger.info(
      "observability: @sentry/node not installed; set optionalDependency or npm i @sentry/node"
    );
  }
}
