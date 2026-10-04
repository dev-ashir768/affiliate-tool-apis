import { startShopVerifyWorker } from "./workers/shop-verify.processor.js";
import { startDiscoverySyncWorker } from "./workers/discovery-sync.processor.js";
import { startOutreachSendWorker } from "./workers/outreach-send.processor.js";
import { startAffiliateInviteWorker } from "./workers/affiliate-invite.processor.js";
import { startAutomationRunWorker } from "./workers/automation-run.processor.js";
import { registerDiscoveryCrawlSchedulers } from "./modules/discovery/discovery-crawl-scheduler.service.js";
import { logger } from "./lib/logger.js";
import { assertProductionBootConfig } from "./lib/production-guards.js";

if (!process.env.NODE_ENV) {
  logger.warn(
    "NODE_ENV unset; env parser defaults to development. Set NODE_ENV=production explicitly in deploy.",
  );
}
assertProductionBootConfig();

startShopVerifyWorker();
startDiscoverySyncWorker();
startOutreachSendWorker();
startAffiliateInviteWorker();
startAutomationRunWorker();

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
