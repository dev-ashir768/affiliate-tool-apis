import { setTimeout as delay } from "node:timers/promises";
import { type AutomationStepKind, type Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { automationRunQueue, AUTOMATION_RUN_QUEUE } from "../../lib/queue.js";
import { getEmailDeliveryStatus } from "../../lib/email.js";
import { deliverOutreachMessage } from "../outreach/outreach.service.js";
import { createAffiliateInvite } from "../invites/invites.service.js";
import { resolveCreatorIdsFromList } from "../creators/creators.service.js";
import {
  openConversationWithCreator,
  sendConversationMessage,
} from "../messages/messages.service.js";

const EMAIL_PACING_MS = 250;
const IM_PACING_MS = 400;

type EmailStepConfig = {
  kind: "EMAIL";
  delayMinutes: number;
  templateId?: string;
  subject?: string;
  bodyText?: string;
};

type InviteStepConfig = {
  kind: "AFFILIATE_INVITE";
  delayMinutes: number;
  inviteName: string;
  message?: string | null;
  endAt: string;
  sellerContactEmail?: string | null;
  hasFreeSample?: boolean;
  sampleApprovalExempt?: boolean;
  products: Array<{
    id: string;
    commissionPercent: number;
    shopAdsCommissionPercent?: number;
  }>;
};

type ImStepConfig = {
  kind: "CREATOR_IM";
  delayMinutes: number;
  bodyText: string;
};

type StepConfig = EmailStepConfig | InviteStepConfig | ImStepConfig;

function renderTokens(
  input: string,
  vars: { handle: string; displayName: string; contactEmail: string },
) {
  return input
    .replaceAll("{{handle}}", vars.handle)
    .replaceAll("{{displayName}}", vars.displayName)
    .replaceAll("{{contactEmail}}", vars.contactEmail);
}

function toRun(row: {
  id: string;
  campaignId: string | null;
  shopId: string | null;
  name: string;
  status: string;
  creatorIds: string[];
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  steps?: Array<{
    id: string;
    stepIndex: number;
    kind: string;
    status: string;
    delayMinutes: number;
    config: Prisma.JsonValue;
    result: Prisma.JsonValue;
    lastError: string | null;
    scheduledAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>;
  shop?: { displayName: string | null } | null;
  campaign?: { name: string } | null;
}) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    campaignName: row.campaign?.name ?? null,
    shopId: row.shopId,
    shopDisplayName: row.shop?.displayName ?? null,
    name: row.name,
    status: row.status,
    creatorIds: row.creatorIds,
    lastError: row.lastError,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    steps: (row.steps ?? [])
      .slice()
      .sort((a, b) => a.stepIndex - b.stepIndex)
      .map((s) => ({
        id: s.id,
        stepIndex: s.stepIndex,
        kind: s.kind,
        status: s.status,
        delayMinutes: s.delayMinutes,
        config: s.config,
        result: s.result,
        lastError: s.lastError,
        scheduledAt: s.scheduledAt?.toISOString() ?? null,
        startedAt: s.startedAt?.toISOString() ?? null,
        finishedAt: s.finishedAt?.toISOString() ?? null,
      })),
  };
}

async function enqueueStepJob(input: {
  organizationId: string;
  runId: string;
  stepId: string;
  delayMinutes: number;
}) {
  const delayMs = Math.max(0, input.delayMinutes) * 60_000;
  const scheduledAt = new Date(Date.now() + delayMs);
  await prisma.automationRunStep.update({
    where: { id: input.stepId },
    data: { scheduledAt },
  });
  const job = await automationRunQueue.add(
    "step",
    {
      organizationId: input.organizationId,
      runId: input.runId,
      stepId: input.stepId,
      requestedAt: new Date().toISOString(),
    },
    {
      delay: delayMs,
      removeOnComplete: 50,
      removeOnFail: 50,
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
    },
  );
  return job.id != null ? String(job.id) : "unknown";
}

export async function listAutomationRuns(organizationId: string) {
  const rows = await prisma.automationRun.findMany({
    where: { organizationId },
    include: {
      steps: true,
      shop: { select: { displayName: true } },
      campaign: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return { runs: rows.map(toRun) };
}

export async function getAutomationRun(organizationId: string, runId: string) {
  const row = await prisma.automationRun.findFirst({
    where: { id: runId, organizationId },
    include: {
      steps: true,
      shop: { select: { displayName: true } },
      campaign: { select: { name: true } },
    },
  });
  if (!row) throw new AppError("NOT_FOUND", "Automation run not found", 404);
  return toRun(row);
}

export async function createAutomationRun(
  organizationId: string,
  actorUserId: string | undefined,
  input: {
    name: string;
    campaignId?: string | null;
    shopId?: string | null;
    creatorIds?: string[];
    listId?: string;
    steps: StepConfig[];
  },
) {
  let uniqueIds = [...new Set((input.creatorIds ?? []).map(String))];
  if (input.listId) {
    const resolved = await resolveCreatorIdsFromList(
      organizationId,
      input.listId,
      { limit: 100 },
    );
    uniqueIds = [...new Set([...uniqueIds, ...resolved.creatorIds])].slice(
      0,
      100,
    );
  }
  const creators = await prisma.creator.findMany({
    where: { organizationId, id: { in: uniqueIds } },
    select: { id: true },
  });
  if (creators.length === 0) {
    throw new AppError("NOT_FOUND", "No matching creators", 404);
  }
  const creatorIds = creators.map((c) => c.id);

  if (input.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, organizationId },
    });
    if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  }

  if (input.shopId) {
    const shop = await prisma.shop.findFirst({
      where: {
        id: input.shopId,
        organizationId,
        status: { not: "DISCONNECTED" },
      },
    });
    if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
    if (!shop.oauthConnectedAt) {
      throw new AppError(
        "SHOP_NOT_READY",
        "Shop has not completed TikTok OAuth",
        400,
      );
    }
  }

  const hasEmail = input.steps.some((s) => s.kind === "EMAIL");
  if (hasEmail) {
    const email = getEmailDeliveryStatus();
    if (!email.ready) {
      throw new AppError(
        "FAILED_PRECONDITION",
        email.note +
          (email.missing.length ? ` Missing: ${email.missing.join(", ")}` : ""),
        400,
        { email },
      );
    }
  }

  for (const step of input.steps) {
    if (step.kind === "EMAIL" && step.templateId) {
      const tpl = await prisma.outreachTemplate.findFirst({
        where: { id: step.templateId, organizationId },
      });
      if (!tpl) {
        throw new AppError("NOT_FOUND", "Outreach template not found", 404);
      }
    }
  }

  const run = await prisma.automationRun.create({
    data: {
      organizationId,
      campaignId: input.campaignId ?? null,
      shopId: input.shopId ?? null,
      name: input.name.trim(),
      status: "QUEUED",
      creatorIds,
      steps: {
        create: input.steps.map((step, stepIndex) => ({
          stepIndex,
          kind: step.kind as AutomationStepKind,
          delayMinutes: step.delayMinutes ?? 0,
          status: "PENDING",
          config: step as unknown as Prisma.InputJsonValue,
        })),
      },
    },
    include: {
      steps: true,
      shop: { select: { displayName: true } },
      campaign: { select: { name: true } },
    },
  });

  const first = run.steps.find((s) => s.stepIndex === 0);
  if (!first) {
    throw new AppError("INTERNAL", "Automation run has no steps", 500);
  }

  let jobId: string;
  try {
    jobId = await enqueueStepJob({
      organizationId,
      runId: run.id,
      stepId: first.id,
      delayMinutes: first.delayMinutes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Queue unavailable";
    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", lastError: message },
    });
    throw new AppError(
      "INTERNAL",
      `Unable to enqueue automation: ${message}`,
      503,
    );
  }

  if (actorUserId) {
    await writeAuditLog({
      actorUserId,
      action: "automation.run.create",
      entityType: "AutomationRun",
      entityId: run.id,
      meta: {
        creators: creatorIds.length,
        steps: input.steps.map((s) => s.kind),
        jobId,
      },
    });
  }

  return {
    run: toRun(run),
    jobId,
    status: "QUEUED" as const,
    queue: AUTOMATION_RUN_QUEUE,
  };
}

async function resolveEmailContent(
  organizationId: string,
  config: EmailStepConfig,
): Promise<{ subject: string; bodyText: string; templateId: string | null }> {
  if (config.templateId) {
    const tpl = await prisma.outreachTemplate.findFirst({
      where: { id: config.templateId, organizationId },
    });
    if (!tpl) throw new AppError("NOT_FOUND", "Template not found", 404);
    return {
      subject: tpl.subject,
      bodyText: tpl.bodyText,
      templateId: tpl.id,
    };
  }
  if (!config.subject || !config.bodyText) {
    throw new AppError(
      "VALIDATION_ERROR",
      "EMAIL step needs templateId or subject+bodyText",
      400,
    );
  }
  return {
    subject: config.subject,
    bodyText: config.bodyText,
    templateId: null,
  };
}

async function executeEmailStep(input: {
  organizationId: string;
  runId: string;
  stepId: string;
  creatorIds: string[];
  campaignId: string | null;
  config: EmailStepConfig;
}) {
  const content = await resolveEmailContent(input.organizationId, input.config);
  const creators = await prisma.creator.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: input.creatorIds },
    },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const messageIds: string[] = [];

  for (const creator of creators) {
    const vars = {
      handle: creator.handle,
      displayName: creator.displayName ?? creator.handle,
      contactEmail: creator.contactEmail ?? "",
    };
    const message = await prisma.outreachMessage.create({
      data: {
        organizationId: input.organizationId,
        templateId: content.templateId,
        campaignId: input.campaignId,
        creatorId: creator.id,
        toEmail: creator.contactEmail,
        subject: renderTokens(content.subject, vars),
        bodyText: renderTokens(content.bodyText, vars),
        status: creator.contactEmail ? "QUEUED" : "FAILED",
        lastError: creator.contactEmail ? null : "Creator has no contactEmail",
      },
    });
    messageIds.push(message.id);
    if (!creator.contactEmail) {
      skipped += 1;
      continue;
    }
    const result = await deliverOutreachMessage(message.id);
    if (result.ok) sent += 1;
    else failed += 1;
    await delay(EMAIL_PACING_MS);
  }

  return { sent, failed, skipped, messageIds };
}

async function executeInviteStep(input: {
  organizationId: string;
  actorUserId: string | undefined;
  runId: string;
  shopId: string | null;
  campaignId: string | null;
  creatorIds: string[];
  config: InviteStepConfig;
}) {
  if (!input.shopId) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "shopId required for AFFILIATE_INVITE step",
      400,
    );
  }

  const result = await createAffiliateInvite(
    input.organizationId,
    input.actorUserId,
    {
      shopId: input.shopId,
      campaignId: input.campaignId,
      name: input.config.inviteName,
      message: input.config.message,
      endAt: input.config.endAt,
      sellerContactEmail: input.config.sellerContactEmail,
      hasFreeSample: input.config.hasFreeSample,
      sampleApprovalExempt: input.config.sampleApprovalExempt,
      products: input.config.products,
      creatorIds: input.creatorIds,
      sync: true,
    },
  );

  return {
    inviteId: result.invite.id,
    status: result.status,
    sent: result.sent,
    failed: result.failed,
    conflicts: result.conflicts,
    skipped: result.skipped,
  };
}

async function executeImStep(input: {
  organizationId: string;
  actorUserId: string | undefined;
  shopId: string | null;
  creatorIds: string[];
  config: ImStepConfig;
}) {
  if (!input.shopId) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "shopId required for CREATOR_IM step",
      400,
    );
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ creatorId: string; error: string }> = [];

  for (const creatorId of input.creatorIds) {
    const creator = await prisma.creator.findFirst({
      where: { id: creatorId, organizationId: input.organizationId },
      select: {
        id: true,
        handle: true,
        displayName: true,
        contactEmail: true,
        creatorOpenId: true,
      },
    });
    if (!creator?.creatorOpenId) {
      skipped += 1;
      continue;
    }
    try {
      const opened = await openConversationWithCreator(
        input.organizationId,
        input.actorUserId,
        { shopId: input.shopId, creatorId },
      );
      const text = renderTokens(input.config.bodyText, {
        handle: creator.handle,
        displayName: creator.displayName ?? creator.handle,
        contactEmail: creator.contactEmail ?? "",
      });
      await sendConversationMessage(
        input.organizationId,
        input.actorUserId,
        opened.conversation.id,
        text,
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      errors.push({
        creatorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await delay(IM_PACING_MS);
  }

  return { sent, failed, skipped, errors: errors.slice(0, 20) };
}

async function finalizeRun(runId: string) {
  const steps = await prisma.automationRunStep.findMany({
    where: { runId },
    orderBy: { stepIndex: "asc" },
  });
  const anyFailed = steps.some((s) => s.status === "FAILED");
  const anyDone = steps.some((s) => s.status === "DONE");
  const allDone = steps.every(
    (s) => s.status === "DONE" || s.status === "SKIPPED",
  );

  let status: "COMPLETED" | "PARTIAL" | "FAILED" = "COMPLETED";
  if (allDone && !anyFailed) status = "COMPLETED";
  else if (anyDone && anyFailed) status = "PARTIAL";
  else if (anyFailed) status = "FAILED";

  await prisma.automationRun.update({
    where: { id: runId },
    data: {
      status,
      completedAt: new Date(),
      lastError: anyFailed
        ? (steps.find((s) => s.lastError)?.lastError ??
          "One or more steps failed")
        : null,
    },
  });
}

export async function processAutomationStepJob(input: {
  organizationId: string;
  runId: string;
  stepId: string;
}) {
  const run = await prisma.automationRun.findFirst({
    where: { id: input.runId, organizationId: input.organizationId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
  if (!run) {
    return { ok: false as const, reason: "run_not_found" };
  }
  if (run.status === "CANCELED") {
    return { ok: false as const, reason: "canceled" };
  }

  const step = run.steps.find((s) => s.id === input.stepId);
  if (!step) {
    return { ok: false as const, reason: "step_not_found" };
  }
  if (step.status === "DONE" || step.status === "SKIPPED") {
    return { ok: true as const, status: step.status };
  }

  await prisma.automationRun.update({
    where: { id: run.id },
    data: {
      status: "RUNNING",
      startedAt: run.startedAt ?? new Date(),
      lastError: null,
    },
  });
  await prisma.automationRunStep.update({
    where: { id: step.id },
    data: { status: "RUNNING", startedAt: new Date(), lastError: null },
  });

  const config = step.config as unknown as StepConfig;

  try {
    let result: Prisma.InputJsonValue;
    if (config.kind === "EMAIL") {
      result = await executeEmailStep({
        organizationId: run.organizationId,
        runId: run.id,
        stepId: step.id,
        creatorIds: run.creatorIds,
        campaignId: run.campaignId,
        config,
      });
    } else if (config.kind === "CREATOR_IM") {
      result = await executeImStep({
        organizationId: run.organizationId,
        actorUserId: undefined,
        shopId: run.shopId,
        creatorIds: run.creatorIds,
        config,
      });
    } else {
      result = await executeInviteStep({
        organizationId: run.organizationId,
        actorUserId: undefined,
        runId: run.id,
        shopId: run.shopId,
        campaignId: run.campaignId,
        creatorIds: run.creatorIds,
        config,
      });
    }

    await prisma.automationRunStep.update({
      where: { id: step.id },
      data: {
        status: "DONE",
        result,
        finishedAt: new Date(),
      },
    });

    const next = run.steps.find((s) => s.stepIndex === step.stepIndex + 1);
    if (next) {
      await enqueueStepJob({
        organizationId: run.organizationId,
        runId: run.id,
        stepId: next.id,
        delayMinutes: next.delayMinutes,
      });
    } else {
      await finalizeRun(run.id);
    }

    logger.info("automation step done", {
      runId: run.id,
      stepId: step.id,
      kind: step.kind,
      stepIndex: step.stepIndex,
    });
    return { ok: true as const, status: "DONE" as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.automationRunStep.update({
      where: { id: step.id },
      data: {
        status: "FAILED",
        lastError: message,
        finishedAt: new Date(),
      },
    });
    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        lastError: message,
        completedAt: new Date(),
      },
    });
    logger.error("automation step failed", {
      runId: run.id,
      stepId: step.id,
      error: message,
    });
    if (err instanceof AppError) throw err;
    throw new AppError("INTERNAL", message, 500);
  }
}
