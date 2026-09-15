import { randomBytes } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { redis } from "../lib/redis.js";

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttlSec = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttlSec)
return 1
`;

let redisAvailable: boolean | null = null;

/** Best-effort Redis readiness; never throws — rate limit fails open. */
async function ensureRedis(): Promise<boolean> {
  // Prefer live ready status so Redis can recover after a prior outage.
  if (redis.status === "ready") {
    redisAvailable = true;
    return true;
  }
  if (redisAvailable === false) return false;

  if (
    redis.status === "wait" ||
    redis.status === "end" ||
    redis.status === "close"
  ) {
    try {
      await Promise.race([
        redis.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Redis connect timeout")), 1500)
        ),
      ]);
      if (redis.status === "ready") {
        redisAvailable = true;
        return true;
      }
    } catch {
      redisAvailable = false;
      return false;
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
          1500
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
      redisAvailable = true;
      return true;
    } catch {
      redisAvailable = false;
      return false;
    }
  }

  redisAvailable = false;
  return false;
}

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Redis sliding-window rate limiter.
 * When Redis is unreachable, requests are allowed through (fail open)
 * so local/dev API stays usable; production should keep Redis reachable.
 */
export function rateLimit({
  key,
  limit,
  windowSec,
}: {
  key: (req: Request) => string;
  limit: number;
  windowSec: number;
}): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!(await ensureRedis())) {
        next();
        return;
      }

      const redisKey = `rl:${key(req)}`;
      const now = Date.now();
      const member = `${now}:${randomBytes(6).toString("hex")}`;
      const allowed = (await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        redisKey,
        String(now),
        String(windowSec * 1000),
        String(limit),
        member,
        String(windowSec)
      )) as number;

      if (allowed === 0) {
        next(
          new AppError(
            "RATE_LIMITED",
            "Too many requests, please try again later",
            429
          )
        );
        return;
      }

      next();
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      // Redis command failure — fail open
      redisAvailable = false;
      next();
    }
  };
}

/** Default IP-based key helpers for route wiring. */
export function rateLimitKey(prefix: string) {
  return (req: Request) => `${prefix}:${clientKey(req)}`;
}
