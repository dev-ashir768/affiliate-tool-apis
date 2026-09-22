import { Worker, type Job } from "bullmq";
import {
  bullConnection,
  AFFILIATE_INVITE_QUEUE,
} from "../lib/queue.js";
import { logger } from "../lib/logger.js";
import { processAffiliateInviteJob } from "../modules/invites/invites.service.js";

export type AffiliateInviteJobData = {
  organizationId: string;
  inviteId: string;
  requestedAt: string;
};

export async function processAffiliateInvite(job: Job<AffiliateInviteJobData>) {
  const result = await processAffiliateInviteJob({
    organizationId: job.data.organizationId,
    inviteId: job.data.inviteId,
  });
  logger.info("affiliate invite job completed", {
    jobId: job.id,
    inviteId: job.data.inviteId,
    ...result,
  });
  return result;
}

export function startAffiliateInviteWorker() {
  const worker = new Worker(AFFILIATE_INVITE_QUEUE, processAffiliateInvite, {
    connection: bullConnection(),
    concurrency: 1,
  });
  worker.on("failed", (job, err) => {
    logger.error("affiliate invite job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });
  return worker;
}
