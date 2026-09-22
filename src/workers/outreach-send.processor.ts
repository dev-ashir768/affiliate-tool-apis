import { Worker, type Job } from "bullmq";
import {
  bullConnection,
  OUTREACH_SEND_QUEUE,
} from "../lib/queue.js";
import { logger } from "../lib/logger.js";
import { processOutreachSendJob } from "../modules/outreach/outreach.service.js";

export type OutreachSendJobData = {
  organizationId: string;
  messageIds: string[];
  requestedAt: string;
};

export async function processOutreachSend(job: Job<OutreachSendJobData>) {
  const result = await processOutreachSendJob({
    organizationId: job.data.organizationId,
    messageIds: job.data.messageIds,
  });
  logger.info("outreach bulk send completed", {
    jobId: job.id,
    ...result,
  });
  return result;
}

export function startOutreachSendWorker() {
  const worker = new Worker(OUTREACH_SEND_QUEUE, processOutreachSend, {
    connection: bullConnection(),
    concurrency: 1,
  });
  worker.on("failed", (job, err) => {
    logger.error("outreach bulk send failed", {
      jobId: job?.id,
      error: err.message,
    });
  });
  return worker;
}
