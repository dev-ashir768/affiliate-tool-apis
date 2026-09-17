import { Queue } from "bullmq";
import { env } from "../config/env.js";

export const SHOP_VERIFY_QUEUE = "shop-verify";
export const CRAWLER_QUEUE = "crawler-check";

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
let _crawlerQueue: Queue | null = null;

/** Lazy Queue — avoids Redis connect on import when tests call the processor directly. */
export function getShopVerifyQueue(): Queue {
  if (!_shopVerifyQueue) {
    _shopVerifyQueue = new Queue(SHOP_VERIFY_QUEUE, {
      connection: bullConnection(),
    });
  }
  return _shopVerifyQueue;
}

export function getCrawlerQueue(): Queue {
  if (!_crawlerQueue) {
    _crawlerQueue = new Queue(CRAWLER_QUEUE, {
      connection: bullConnection(),
    });
  }
  return _crawlerQueue;
}

export const shopVerifyQueue = {
  add: (...args: Parameters<Queue["add"]>) => getShopVerifyQueue().add(...args),
  close: () => (_shopVerifyQueue ? _shopVerifyQueue.close() : Promise.resolve()),
};

export const crawlerQueue = {
  add: (...args: Parameters<Queue["add"]>) => getCrawlerQueue().add(...args),
  close: () => (_crawlerQueue ? _crawlerQueue.close() : Promise.resolve()),
};
