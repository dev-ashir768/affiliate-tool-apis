import { startShopVerifyWorker } from "./workers/shop-verify.processor.js";
import { startCrawlerWorker } from "./workers/crawler.processor.js";
import { logger } from "./lib/logger.js";

startShopVerifyWorker();
startCrawlerWorker();
logger.info("worker started");
