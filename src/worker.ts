import { startShopVerifyWorker } from "./workers/shop-verify.processor.js";
import { startCrawlerWorker } from "./workers/crawler.processor.js";
import { startDiscoverySyncWorker } from "./workers/discovery-sync.processor.js";
import { logger } from "./lib/logger.js";

startShopVerifyWorker();
startCrawlerWorker();
startDiscoverySyncWorker();
logger.info("worker started");
