import { env } from "../config/env.js";
import { logger } from "./logger.js";

type SentryLike = {
  captureException: (err: unknown, ctx?: Record<string, unknown>) => unknown;
  flush: (timeoutMs?: number) => Promise<boolean>;
};

let sentry: SentryLike | null = null;

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
    sentry = Sentry as unknown as SentryLike;
    logger.info("observability: Sentry initialized");
  } catch {
    logger.info(
      "observability: @sentry/node not installed; set optionalDependency or npm i @sentry/node"
    );
  }
}

/** Report an unexpected error (no-op when Sentry is not initialized). */
export function captureError(err: unknown, extra?: Record<string, unknown>) {
  sentry?.captureException(err, extra ? { extra } : undefined);
}

/** Drain pending Sentry events before process exit. */
export async function flushObservability(timeoutMs = 2000) {
  await sentry?.flush(timeoutMs).catch(() => false);
}
