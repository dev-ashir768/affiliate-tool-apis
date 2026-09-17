import { AppError } from "../../lib/errors.js";
import {
  CRAWLER_QUEUE,
  crawlerQueue,
  getCrawlerQueue,
} from "../../lib/queue.js";

export type CrawlerStatusPayload = {
  status: "IDLE" | "RUNNING" | "DEGRADED";
  lastRunAt: string | null;
  lastJobId: string | null;
  lastJobState: string | null;
  queue: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  note: string;
};

export type CrawlerRunResult = {
  jobId: string;
  queue: string;
  status: "QUEUED";
};

function deriveStatus(
  counts: CrawlerStatusPayload["counts"],
): CrawlerStatusPayload["status"] {
  if (counts.active > 0) return "RUNNING";
  if (counts.failed > 0 && counts.completed === 0 && counts.waiting === 0) {
    return "DEGRADED";
  }
  return "IDLE";
}

export async function getCrawlerStatus(): Promise<CrawlerStatusPayload> {
  const queue = getCrawlerQueue();
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
  );

  const [latest] = await queue.getJobs(
    ["completed", "failed", "active", "waiting", "delayed"],
    0,
    0,
  );

  let lastRunAt: string | null = null;
  let lastJobId: string | null = null;
  let lastJobState: string | null = null;

  if (latest) {
    lastJobId = latest.id != null ? String(latest.id) : null;
    lastJobState = await latest.getState();
    const finishedOn = latest.finishedOn ?? latest.processedOn ?? latest.timestamp;
    lastRunAt = finishedOn ? new Date(finishedOn).toISOString() : null;
  }

  const normalized = {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };

  return {
    status: deriveStatus(normalized),
    lastRunAt,
    lastJobId,
    lastJobState,
    queue: CRAWLER_QUEUE,
    counts: normalized,
    note:
      "Dry-run jobs hit Redis via the crawler-check worker. Merchant shop verify still uses the shop-verify queue.",
  };
}

export async function enqueueCrawlerDryRun(triggeredBy?: string): Promise<CrawlerRunResult> {
  try {
    const job = await crawlerQueue.add(
      "dry-run",
      {
        triggeredBy,
        requestedAt: new Date().toISOString(),
      },
      {
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 1,
      },
    );

    return {
      jobId: job.id != null ? String(job.id) : "unknown",
      queue: CRAWLER_QUEUE,
      status: "QUEUED",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Queue unavailable";
    throw new AppError(
      "INTERNAL",
      `Unable to enqueue crawler dry-run: ${message}`,
      503,
    );
  }
}
