import { redis } from "../../lib/redis.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { decryptVault, encryptVault } from "../../lib/crypto.js";

/** In-process mirror used when Redis is unreachable (tests / brief outage). */
const memory = new Map<string, number>();
/** Cooldown after a failed probe so we retry periodically instead of latching forever. */
const REPROBE_COOLDOWN_MS = 5_000;
let lastProbeFailureAt = 0;
let degradedLogged = false;

async function ensureRedis(): Promise<boolean> {
  // Prefer live ready status so Redis can recover after a prior outage.
  if (redis.status === "ready") {
    if (degradedLogged) {
      logger.info("refresh-store redis recovered");
      degradedLogged = false;
    }
    return true;
  }

  if (
    lastProbeFailureAt > 0 &&
    Date.now() - lastProbeFailureAt < REPROBE_COOLDOWN_MS
  ) {
    return false;
  }

  if (
    redis.status === "wait" ||
    redis.status === "end" ||
    redis.status === "close"
  ) {
    try {
      await Promise.race([
        redis.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Redis connect timeout")), 2000)
        ),
      ]);
      lastProbeFailureAt = 0;
      if (degradedLogged) {
        logger.info("refresh-store redis recovered");
        degradedLogged = false;
      }
      return true;
    } catch (err) {
      lastProbeFailureAt = Date.now();
      markDegraded(err);
      if (env.NODE_ENV === "test") return false;
      throw new Error("Redis unavailable");
    }
  }

  if (
    redis.status === "connecting" ||
    redis.status === "connect" ||
    redis.status === "reconnecting"
  ) {
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Redis ready timeout")),
          2000
        );
        const onReady = () => {
          clearTimeout(timer);
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          clearTimeout(timer);
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          redis.off("ready", onReady);
          redis.off("error", onError);
        };
        redis.once("ready", onReady);
        redis.once("error", onError);
      });
      lastProbeFailureAt = 0;
      if (degradedLogged) {
        logger.info("refresh-store redis recovered");
        degradedLogged = false;
      }
      return true;
    } catch (err) {
      lastProbeFailureAt = Date.now();
      markDegraded(err);
      if (env.NODE_ENV === "test") return false;
      throw new Error("Redis unavailable");
    }
  }

  lastProbeFailureAt = Date.now();
  markDegraded(new Error(`Unexpected redis status: ${redis.status}`));
  if (env.NODE_ENV === "test") return false;
  throw new Error("Redis unavailable");
}

function markDegraded(err: unknown) {
  if (degradedLogged) return;
  degradedLogged = true;
  logger.error("refresh-store redis degraded; using in-memory mirror", {
    err: err instanceof Error ? err.message : String(err),
    status: redis.status,
  });
}

function memoryAlive(hash: string) {
  const exp = memory.get(hash);
  if (!exp) return false;
  if (exp < Date.now()) {
    memory.delete(hash);
    return false;
  }
  return true;
}

export async function mirrorRefresh(hash: string, ttlSec: number) {
  memory.set(hash, Date.now() + ttlSec * 1000);
  if (await ensureRedis()) {
    await redis.set(`refresh:${hash}`, "1", "EX", ttlSec);
  }
}

export async function revokeRefreshMirror(hash: string) {
  memory.delete(hash);
  if (await ensureRedis()) {
    await redis.del(`refresh:${hash}`);
  }
}

export async function isRefreshMirrored(hash: string) {
  if (await ensureRedis()) {
    return (await redis.exists(`refresh:${hash}`)) === 1;
  }
  // Production: never accept in-memory mirror (multi-instance / revocation unsafe).
  if (env.NODE_ENV === "production") return false;
  return memoryAlive(hash);
}

/**
 * Rotation grace: concurrent refreshes with the same token (parallel navigations /
 * prefetches) receive the pair minted by the first winner instead of a 401.
 * Stored encrypted — the value holds a live refresh token.
 */
export const ROTATION_GRACE_SEC = 30;
const graceMemory = new Map<string, { value: string; exp: number }>();

export type RotatedPair = { accessToken: string; refreshToken: string };

export async function setRotationGrace(hash: string, pair: RotatedPair) {
  const value = encryptVault(JSON.stringify(pair));
  graceMemory.set(hash, { value, exp: Date.now() + ROTATION_GRACE_SEC * 1000 });
  if (await ensureRedis()) {
    await redis.set(`refresh-grace:${hash}`, value, "EX", ROTATION_GRACE_SEC);
  }
}

export async function getRotationGrace(
  hash: string,
): Promise<RotatedPair | null> {
  let value: string | null = null;
  if (await ensureRedis()) {
    value = await redis.get(`refresh-grace:${hash}`);
  } else if (env.NODE_ENV !== "production") {
    const entry = graceMemory.get(hash);
    if (entry && entry.exp > Date.now()) value = entry.value;
    else graceMemory.delete(hash);
  }
  if (!value) return null;
  try {
    return JSON.parse(decryptVault(value)) as RotatedPair;
  } catch {
    return null;
  }
}

/**
 * Successor link: old refresh hash → the raw token that replaced it. If the
 * response carrying the new cookie never reached the browser (aborted fetch,
 * cancelled prefetch, closed tab), the browser retries with the old token; we
 * hand back the successor as long as the successor itself is still unused.
 */
export async function setRefreshSuccessor(oldHash: string, successorRaw: string) {
  if (await ensureRedis()) {
    await redis.set(
      `refresh-successor:${oldHash}`,
      encryptVault(successorRaw),
      "EX",
      refreshTtl(),
    );
  } else if (env.NODE_ENV !== "production") {
    graceMemory.set(`successor:${oldHash}`, {
      value: encryptVault(successorRaw),
      exp: Date.now() + refreshTtl() * 1000,
    });
  }
}

export async function getRefreshSuccessor(oldHash: string): Promise<string | null> {
  let value: string | null = null;
  if (await ensureRedis()) {
    value = await redis.get(`refresh-successor:${oldHash}`);
  } else if (env.NODE_ENV !== "production") {
    const entry = graceMemory.get(`successor:${oldHash}`);
    if (entry && entry.exp > Date.now()) value = entry.value;
  }
  if (!value) return null;
  try {
    return decryptVault(value);
  } catch {
    return null;
  }
}

export function refreshTtl() {
  return env.REFRESH_TOKEN_TTL_SEC;
}
