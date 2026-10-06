import { Queue } from "bullmq";
import { env } from "../config/env.js";

export const SHOP_VERIFY_QUEUE = "shop-verify";
export const DISCOVERY_SYNC_QUEUE = "discovery-sync";
export const OUTREACH_SEND_QUEUE = "outreach-send";
export const AFFILIATE_INVITE_QUEUE = "affiliate-invite";
export const AUTOMATION_RUN_QUEUE = "automation-run";

export function bullConnection() {
  const url = new URL(env.REDIS_URL);
  const db = Number(url.pathname.slice(1) || 0);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isFinite(db) ? db : 0,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null as null,
  };
}

/** Keep Redis from accumulating finished jobs forever. */
const RETENTION = {
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
};

/**
 * Retries only where re-running is harmless. Outreach, affiliate invites and
 * automation steps message creators, so they run once and surface failures in
 * their run/message status instead of risking duplicate sends.
 */
const SAFE_RETRY = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
};

let _shopVerifyQueue: Queue | null = null;
let _discoverySyncQueue: Queue | null = null;
let _outreachSendQueue: Queue | null = null;
let _affiliateInviteQueue: Queue | null = null;
let _automationRunQueue: Queue | null = null;

/** Lazy Queue — avoids Redis connect on import when tests call the processor directly. */
export function getShopVerifyQueue(): Queue {
  if (!_shopVerifyQueue) {
    _shopVerifyQueue = new Queue(SHOP_VERIFY_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: { ...RETENTION, ...SAFE_RETRY },
    });
  }
  return _shopVerifyQueue;
}

export function getDiscoverySyncQueue(): Queue {
  if (!_discoverySyncQueue) {
    _discoverySyncQueue = new Queue(DISCOVERY_SYNC_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: { ...RETENTION, ...SAFE_RETRY },
    });
  }
  return _discoverySyncQueue;
}

export function getOutreachSendQueue(): Queue {
  if (!_outreachSendQueue) {
    _outreachSendQueue = new Queue(OUTREACH_SEND_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: RETENTION,
    });
  }
  return _outreachSendQueue;
}

export function getAffiliateInviteQueue(): Queue {
  if (!_affiliateInviteQueue) {
    _affiliateInviteQueue = new Queue(AFFILIATE_INVITE_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: RETENTION,
    });
  }
  return _affiliateInviteQueue;
}

export function getAutomationRunQueue(): Queue {
  if (!_automationRunQueue) {
    _automationRunQueue = new Queue(AUTOMATION_RUN_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: RETENTION,
    });
  }
  return _automationRunQueue;
}

export const shopVerifyQueue = {
  add: (...args: Parameters<Queue["add"]>) => getShopVerifyQueue().add(...args),
  close: () => (_shopVerifyQueue ? _shopVerifyQueue.close() : Promise.resolve()),
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
