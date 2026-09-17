import { Worker, type Job } from "bullmq";
import { bullConnection, CRAWLER_QUEUE } from "../lib/queue.js";
import { logger } from "../lib/logger.js";

export type CrawlerDryRunJobData = {
  triggeredBy?: string;
  requestedAt: string;
};

export async function processCrawlerDryRun(job: Job<CrawlerDryRunJobData>) {
  // Noop health check — proves Redis + worker path without touching external sites.
  await new Promise((r) => setTimeout(r, 150));
  logger.info("crawler dry-run completed", {
    jobId: job.id,
    triggeredBy: job.data.triggeredBy ?? null,
  });
  return { ok: true as const, completedAt: new Date().toISOString() };
}

export function startCrawlerWorker() {
  const worker = new Worker(CRAWLER_QUEUE, processCrawlerDryRun, {
    connection: bullConnection(),
    concurrency: 2,
  });
  worker.on("failed", (job, err) => {
    logger.error("crawler dry-run failed", {
      jobId: job?.id,
      error: err.message,
    });
  });
  return worker;
}
