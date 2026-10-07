import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { flushObservability, initObservability } from "./lib/observability.js";
import { assertProductionBootConfig } from "./lib/production-guards.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import {
  affiliateInviteQueue,
  automationRunQueue,
  discoverySyncQueue,
  outreachSendQueue,
  shopVerifyQueue,
} from "./lib/queue.js";
import { closeAllBotActivations } from "./modules/shops/bot-activation.service.js";

if (!process.env.NODE_ENV) {
  logger.warn(
    "NODE_ENV unset; env parser defaults to development. Set NODE_ENV=production explicitly in deploy.",
  );
}
assertProductionBootConfig();

await initObservability();

const app = createApp();
const server = app.listen(env.PORT, () =>
  logger.info("api listening", { port: env.PORT }),
);

let shuttingDown = false;

/** Stop accepting connections, let in-flight requests finish, then close pools. */
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("api shutting down", { signal });
  const force = setTimeout(() => {
    logger.error("api shutdown timed out; forcing exit");
    process.exit(1);
  }, 15_000);
  force.unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await Promise.all([
      closeAllBotActivations(),
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
    logger.error("api shutdown error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
