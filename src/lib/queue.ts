import { Queue } from "bullmq";
import { env } from "../config/env.js";

export const SHOP_VERIFY_QUEUE = "shop-verify";
export const CRAWLER_QUEUE = "crawler-check";
export const DISCOVERY_SYNC_QUEUE = "discovery-sync";
export const OUTREACH_SEND_QUEUE = "outreach-send";
export const AFFILIATE_INVITE_QUEUE = "affiliate-invite";
export const AUTOMATION_RUN_QUEUE = "automation-run";

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
let _discoverySyncQueue: Queue | null = null;
let _outreachSendQueue: Queue | null = null;
let _affiliateInviteQueue: Queue | null = null;
let _automationRunQueue: Queue | null = null;

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

export function getDiscoverySyncQueue(): Queue {
  if (!_discoverySyncQueue) {
    _discoverySyncQueue = new Queue(DISCOVERY_SYNC_QUEUE, {
      connection: bullConnection(),
    });
  }
  return _discoverySyncQueue;
}

export function getOutreachSendQueue(): Queue {
  if (!_outreachSendQueue) {
    _outreachSendQueue = new Queue(OUTREACH_SEND_QUEUE, {
      connection: bullConnection(),
    });
  }
  return _outreachSendQueue;
}

export function getAffiliateInviteQueue(): Queue {
  if (!_affiliateInviteQueue) {
    _affiliateInviteQueue = new Queue(AFFILIATE_INVITE_QUEUE, {
      connection: bullConnection(),
    });
  }
  return _affiliateInviteQueue;
}

export function getAutomationRunQueue(): Queue {
  if (!_automationRunQueue) {
    _automationRunQueue = new Queue(AUTOMATION_RUN_QUEUE, {
      connection: bullConnection(),
    });
  }
  return _automationRunQueue;
}

export const shopVerifyQueue = {
  add: (...args: Parameters<Queue["add"]>) => getShopVerifyQueue().add(...args),
  close: () => (_shopVerifyQueue ? _shopVerifyQueue.close() : Promise.resolve()),
};

export const crawlerQueue = {
  add: (...args: Parameters<Queue["add"]>) => getCrawlerQueue().add(...args),
  close: () => (_crawlerQueue ? _crawlerQueue.close() : Promise.resolve()),
};

export const discoverySyncQueue = {
  add: (...args: Parameters<Queue["add"]>) =>
    getDiscoverySyncQueue().add(...args),
  close: () =>
    _discoverySyncQueue ? _discoverySyncQueue.close() : Promise.resolve(),
};

export const outreachSendQueue = {
  add: (...args: Parameters<Queue["add"]>) =>
    getOutreachSendQueue().add(...args),
  close: () =>
    _outreachSendQueue ? _outreachSendQueue.close() : Promise.resolve(),
};

export const affiliateInviteQueue = {
  add: (...args: Parameters<Queue["add"]>) =>
    getAffiliateInviteQueue().add(...args),
  close: () =>
    _affiliateInviteQueue
      ? _affiliateInviteQueue.close()
      : Promise.resolve(),
};

export const automationRunQueue = {
  add: (...args: Parameters<Queue["add"]>) =>
    getAutomationRunQueue().add(...args),
  close: () =>
    _automationRunQueue ? _automationRunQueue.close() : Promise.resolve(),
};
