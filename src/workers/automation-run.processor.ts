import { Worker, type Job } from "bullmq";
import {
  bullConnection,
  AUTOMATION_RUN_QUEUE,
} from "../lib/queue.js";
import { logger } from "../lib/logger.js";
import { processAutomationStepJob } from "../modules/automations/automations.service.js";

export type AutomationStepJobData = {
  organizationId: string;
  runId: string;
  stepId: string;
  requestedAt: string;
};

export async function processAutomationStep(
  job: Job<AutomationStepJobData>,
) {
  const result = await processAutomationStepJob({
    organizationId: job.data.organizationId,
    runId: job.data.runId,
    stepId: job.data.stepId,
  });
  logger.info("automation step job completed", {
    jobId: job.id,
    runId: job.data.runId,
    stepId: job.data.stepId,
    ...result,
  });
  return result;
}

export function startAutomationRunWorker() {
  const worker = new Worker(AUTOMATION_RUN_QUEUE, processAutomationStep, {
    connection: bullConnection(),
    concurrency: 1,
  });
  worker.on("failed", (job, err) => {
    logger.error("automation step job failed", {
      jobId: job?.id,
      error: err.message,
    });
  });
  return worker;
}
