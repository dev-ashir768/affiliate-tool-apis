import { startShopVerifyWorker } from "./workers/shop-verify.processor.js";
import { startDiscoverySyncWorker } from "./workers/discovery-sync.processor.js";
import { startOutreachSendWorker } from "./workers/outreach-send.processor.js";
import { startAffiliateInviteWorker } from "./workers/affiliate-invite.processor.js";
import { startAutomationRunWorker } from "./workers/automation-run.processor.js";
import { registerDiscoveryCrawlSchedulers } from "./modules/discovery/discovery-crawl-scheduler.service.js";
import { logger } from "./lib/logger.js";
import { assertProductionBootConfig } from "./lib/production-guards.js";
import { flushObservability, initObservability } from "./lib/observability.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import {
  affiliateInviteQueue,
  automationRunQueue,
  discoverySyncQueue,
  outreachSendQueue,
  shopVerifyQueue,
} from "./lib/queue.js";

if (!process.env.NODE_ENV) {
  logger.warn(
    "NODE_ENV unset; env parser defaults to development. Set NODE_ENV=production explicitly in deploy.",
  );
}
assertProductionBootConfig();

await initObservability();

const workers = [
  startShopVerifyWorker(),
  startDiscoverySyncWorker(),
  startOutreachSendWorker(),
  startAffiliateInviteWorker(),
  startAutomationRunWorker(),
];

void registerDiscoveryCrawlSchedulers()
  .then((r) => {
    logger.info("discovery crawl scheduler boot", r);
  })
  .catch((err) => {
    logger.error("discovery crawl scheduler register failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

logger.info("worker started");

let shuttingDown = false;

/**
 * Let in-flight jobs finish before exit. Without this, a PM2 restart kills
 * active jobs mid-way and BullMQ re-runs them as stalled (duplicate sends).
 */
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker shutting down", { signal });
  const force = setTimeout(() => {
    logger.error("worker shutdown timed out; forcing exit");
    process.exit(1);
  }, 30_000);
  force.unref();
  try {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all([
      shopVerifyQueue.close(),
      discoverySyncQueue.close(),
      outreachSendQueue.close(),
      affiliateInviteQueue.close(),
      automationRunQueue.close(),
    ]);
    await prisma.$disconnect();
    redis.disconnect();
    await flushObservability();
  } catch (err) {
    logger.error("worker shutdown error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
