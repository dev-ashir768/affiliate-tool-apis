import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { initObservability } from "./lib/observability.js";
import { assertProductionBootConfig } from "./lib/production-guards.js";

if (!process.env.NODE_ENV) {
  logger.warn(
    "NODE_ENV unset; env parser defaults to development. Set NODE_ENV=production explicitly in deploy.",
  );
}
assertProductionBootConfig();

await initObservability();

const app = createApp();
app.listen(env.PORT, () => logger.info("api listening", { port: env.PORT }));
