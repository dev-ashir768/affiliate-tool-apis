import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableOfflineQueue: false,
  retryStrategy(times: number) {
    if (env.NODE_ENV === "test") return null;
    return Math.min(times * 50, 2000);
  },
});

// Prevent unhandled 'error' spam when Redis is down (e.g. local tests)
redis.on("error", () => {});
