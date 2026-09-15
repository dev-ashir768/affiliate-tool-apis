import { Queue } from "bullmq";
import { env } from "../config/env.js";

export const SHOP_VERIFY_QUEUE = "shop-verify";

export function bullConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

let _shopVerifyQueue: Queue | null = null;

/** Lazy Queue — avoids Redis connect on import when tests call the processor directly. */
export function getShopVerifyQueue(): Queue {
  if (!_shopVerifyQueue) {
    _shopVerifyQueue = new Queue(SHOP_VERIFY_QUEUE, {
      connection: bullConnection(),
    });
  }
  return _shopVerifyQueue;
}

export const shopVerifyQueue = {
  add: (...args: Parameters<Queue["add"]>) => getShopVerifyQueue().add(...args),
  close: () => (_shopVerifyQueue ? _shopVerifyQueue.close() : Promise.resolve()),
};
