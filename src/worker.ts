import { startShopVerifyWorker } from "./workers/shop-verify.processor.js";
import { logger } from "./lib/logger.js";

startShopVerifyWorker();
logger.info("worker started");
