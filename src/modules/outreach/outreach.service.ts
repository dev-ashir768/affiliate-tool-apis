import { setTimeout as delay } from "node:timers/promises";
import type { CreatorStage } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getEmailDeliveryStatus, sendOutreachEmail } from "../../lib/email.js";
import { outreachSendQueue, OUTREACH_SEND_QUEUE } from "../../lib/queue.js";
import { writeAuditLog } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { resolveCreatorIdsFromList } from "../creators/creators.service.js";

const BULK_MAX = 100;
const SEND_PACING_MS = 250;

function assertOutreachEmailReady() {
  const status = getEmailDeliveryStatus();
  if (!status.ready) {
    throw new AppError(
      "FAILED_PRECONDITION",
      status.note +
        (status.missing.length ? ` Missing: ${status.missing.join(", ")}` : ""),
      400,
      { email: status },
    );
  }
}

function renderTokens(
  input: string,
  vars: { handle: string; displayName: string; contactEmail: string },
) {
  return input
    .replaceAll("{{handle}}", vars.handle)
    .replaceAll("{{displayName}}", vars.displayName)
    .replaceAll("{{contactEmail}}", vars.contactEmail);
}

function toTemplate(row: {
  id: string;
  name: string;
  subject: string;
  bodyText: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    bodyText: row.bodyText,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessage(row: {
  id: string;
  templateId: string | null;
  campaignId: string | null;
  creatorId: string;
  toEmail: string | null;
  subject: string;
  bodyText: string;
  status: string;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  creator?: { handle: string; displayName: string | null };
}) {
  return {
    id: row.id,
    templateId: row.templateId,
    campaignId: row.campaignId,
    creatorId: row.creatorId,
    creatorHandle: row.creator?.handle ?? null,
    creatorDisplayName: row.creator?.displayName ?? null,
    toEmail: row.toEmail,
    subject: row.subject,
    bodyText: row.bodyText,
    status: row.status,
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function getOutreachEmailStatus() {
  return getEmailDeliveryStatus();
}

export async function listTemplates(organizationId: string) {
  const rows = await prisma.outreachTemplate.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
  });
  return { templates: rows.map(toTemplate) };
}

export async function createTemplate(
  organizationId: string,
  input: { name: string; subject: string; bodyText: string },
) {
  try {
    const row = await prisma.outreachTemplate.create({
      data: {
        organizationId,
        name: input.name.trim(),
        subject: input.subject.trim(),
        bodyText: input.bodyText,
      },
    });
    return toTemplate(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError("CONFLICT", "Template name already exists", 409);
    }
    throw err;
  }
}

export async function patchTemplate(
  organizationId: string,
  id: string,
  input: Partial<{ name: string; subject: string; bodyText: string }>,
) {
  const existing = await prisma.outreachTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Template not found", 404);
  const row = await prisma.outreachTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.subject !== undefined ? { subject: input.subject.trim() } : {}),
      ...(input.bodyText !== undefined ? { bodyText: input.bodyText } : {}),
    },
  });
  return toTemplate(row);
}

export async function listMessages(organizationId: string) {
  const rows = await prisma.outreachMessage.findMany({
    where: { organizationId },
    include: {
      creator: { select: { handle: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return { messages: rows.map(toMessage) };
}

async function resolveTemplateContent(
  organizationId: string,
  input: {
    templateId?: string;
    subject?: string;
    bodyText?: string;
  },
) {
  let subject = input.subject?.trim() ?? "";
  let bodyText = input.bodyText ?? "";
  let templateId: string | null = input.templateId ?? null;

  if (input.templateId) {
    const template = await prisma.outreachTemplate.findFirst({
      where: { id: input.templateId, organizationId },
    });
    if (!template) throw new AppError("NOT_FOUND", "Template not found", 404);
    subject = subject || template.subject;
    bodyText = bodyText || template.bodyText;
    templateId = template.id;
  }

  if (!subject || !bodyText) {
    throw new AppError(
      "VALIDATION_ERROR",
      "subject and bodyText required (or provide templateId)",
      400,
    );
  }

  return { subject, bodyText, templateId };
}

async function markCreatorInvited(creatorId: string, stage: CreatorStage) {
  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      stage: stage === "LEAD" || stage === "CONTACTED" ? "INVITED" : stage,
    },
  });
}

/** Deliver a single QUEUED outreach message (used by worker + sync send). */
export async function deliverOutreachMessage(messageId: string) {
  const message = await prisma.outreachMessage.findUnique({
    where: { id: messageId },
    include: {
      creator: true,
    },
  });
  if (!message) return { ok: false as const, reason: "not_found" };
  if (message.status === "SENT") {
    return { ok: true as const, status: "SENT" as const };
  }
  if (!message.toEmail) {
    await prisma.outreachMessage.update({
      where: { id: message.id },
      data: { status: "FAILED", lastError: "Creator has no contactEmail" },
    });
    return { ok: false as const, reason: "no_email" };
  }

  try {
    await sendOutreachEmail({
      to: message.toEmail,
      subject: message.subject,
      bodyText: message.bodyText,
    });
    await prisma.outreachMessage.update({
      where: { id: message.id },
      data: { status: "SENT", sentAt: new Date(), lastError: null },
    });
    await markCreatorInvited(message.creatorId, message.creator.stage);
    return { ok: true as const, status: "SENT" as const };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send failed";
    await prisma.outreachMessage.update({
      where: { id: message.id },
      data: { status: "FAILED", lastError: msg },
    });
    logger.info("outreach deliver failed", { messageId, error: msg });
    return { ok: false as const, reason: msg };
  }
}

export async function sendOutreach(
  organizationId: string,
  input: {
    creatorId: string;
    templateId?: string;
    campaignId?: string | null;
    subject?: string;
    bodyText?: string;
  },
) {
  assertOutreachEmailReady();

  const creator = await prisma.creator.findFirst({
    where: { id: input.creatorId, organizationId },
  });
  if (!creator) throw new AppError("NOT_FOUND", "Creator not found", 404);

  const { subject, bodyText, templateId } = await resolveTemplateContent(
    organizationId,
    input,
  );

  if (input.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, organizationId },
    });
    if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  }

  const vars = {
    handle: creator.handle,
    displayName: creator.displayName ?? creator.handle,
    contactEmail: creator.contactEmail ?? "",
  };
  const renderedSubject = renderTokens(subject, vars);
  const renderedBody = renderTokens(bodyText, vars);

  const message = await prisma.outreachMessage.create({
    data: {
      organizationId,
      templateId,
      campaignId: input.campaignId ?? null,
      creatorId: creator.id,
      toEmail: creator.contactEmail,
      subject: renderedSubject,
      bodyText: renderedBody,
      status: "QUEUED",
    },
    include: {
      creator: { select: { handle: true, displayName: true } },
    },
  });

  if (!creator.contactEmail) {
    const failed = await prisma.outreachMessage.update({
      where: { id: message.id },
      data: {
        status: "FAILED",
        lastError: "Creator has no contactEmail",
      },
      include: {
        creator: { select: { handle: true, displayName: true } },
      },
    });
    await prisma.creator.update({
      where: { id: creator.id },
      data: { stage: "CONTACTED" },
    });
    return toMessage(failed);
  }

  await deliverOutreachMessage(message.id);
  const fresh = await prisma.outreachMessage.findUniqueOrThrow({
    where: { id: message.id },
    include: {
      creator: { select: { handle: true, displayName: true } },
    },
  });
  return toMessage(fresh);
}

export async function bulkSendOutreach(
  organizationId: string,
  actorUserId: string | undefined,
  input: {
    creatorIds?: string[];
    listId?: string;
    templateId?: string;
    campaignId?: string | null;
    subject?: string;
    bodyText?: string;
    /** When true, send inline (capped). Default queues via BullMQ. */
    sync?: boolean;
  },
) {
  assertOutreachEmailReady();

  let listMeta: {
    listId: string;
    listName: string;
    totalMembers: number;
    truncated: boolean;
  } | null = null;
  let uniqueIds = [...new Set((input.creatorIds ?? []).map(String))];
  if (input.listId) {
    const resolved = await resolveCreatorIdsFromList(
      organizationId,
      input.listId,
      { limit: BULK_MAX },
    );
    uniqueIds = [...new Set([...uniqueIds, ...resolved.creatorIds])].slice(
      0,
      BULK_MAX,
    );
    listMeta = {
      listId: resolved.listId,
      listName: resolved.listName,
      totalMembers: resolved.totalMembers,
      truncated: resolved.truncated || resolved.totalMembers > BULK_MAX,
    };
  }
  if (uniqueIds.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "No creators to email — provide creatorIds or a non-empty listId",
      400,
    );
  }
  if (uniqueIds.length > BULK_MAX) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Max ${BULK_MAX} creators per bulk send`,
      400,
    );
  }

  const { subject, bodyText, templateId } = await resolveTemplateContent(
    organizationId,
    input,
  );

  if (input.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, organizationId },
    });
    if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  }

  const creators = await prisma.creator.findMany({
    where: { organizationId, id: { in: uniqueIds } },
  });
  if (creators.length === 0) {
    throw new AppError("NOT_FOUND", "No matching creators", 404);
  }

  const messageIds: string[] = [];
  let skippedNoEmail = 0;

  for (const creator of creators) {
    const vars = {
      handle: creator.handle,
      displayName: creator.displayName ?? creator.handle,
      contactEmail: creator.contactEmail ?? "",
    };
    const row = await prisma.outreachMessage.create({
      data: {
        organizationId,
        templateId,
        campaignId: input.campaignId ?? null,
        creatorId: creator.id,
        toEmail: creator.contactEmail,
        subject: renderTokens(subject, vars),
        bodyText: renderTokens(bodyText, vars),
        status: creator.contactEmail ? "QUEUED" : "FAILED",
        lastError: creator.contactEmail ? null : "Creator has no contactEmail",
      },
    });
    if (creator.contactEmail) messageIds.push(row.id);
    else skippedNoEmail += 1;
  }

  if (actorUserId) {
    await writeAuditLog({
      actorUserId,
      action: "outreach.bulk_send",
      entityType: "OutreachMessage",
      meta: {
        queued: messageIds.length,
        skippedNoEmail,
        campaignId: input.campaignId ?? null,
        templateId,
      },
    });
  }

  if (messageIds.length === 0) {
    return {
      queued: 0,
      skippedNoEmail,
      sent: 0,
      failed: skippedNoEmail,
      list: listMeta,
      jobId: null as string | null,
      status: "DONE" as const,
    };
  }

  if (input.sync) {
    let sent = 0;
    let failed = 0;
    for (const id of messageIds) {
      const result = await deliverOutreachMessage(id);
      if (result.ok) sent += 1;
      else failed += 1;
      await delay(SEND_PACING_MS);
    }
    return {
      queued: messageIds.length,
      skippedNoEmail,
      sent,
      failed: failed + skippedNoEmail,
      list: listMeta,
      jobId: null as string | null,
      status: "DONE" as const,
    };
  }

  try {
    const job = await outreachSendQueue.add(
      "bulk-send",
      {
        organizationId,
        messageIds,
        requestedAt: new Date().toISOString(),
      },
      {
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
      },
    );
    return {
      queued: messageIds.length,
      skippedNoEmail,
      sent: 0,
      failed: skippedNoEmail,
      list: listMeta,
      jobId: job.id != null ? String(job.id) : "unknown",
      status: "QUEUED" as const,
      queue: OUTREACH_SEND_QUEUE,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Queue unavailable";
    throw new AppError(
      "INTERNAL",
      `Unable to enqueue outreach send: ${message}`,
      503,
    );
  }
}

export async function processOutreachSendJob(input: {
  organizationId: string;
  messageIds: string[];
}) {
  let sent = 0;
  let failed = 0;
  for (const id of input.messageIds) {
    const msg = await prisma.outreachMessage.findFirst({
      where: { id, organizationId: input.organizationId },
    });
    if (!msg) {
      failed += 1;
      continue;
    }
    const result = await deliverOutreachMessage(id);
    if (result.ok) sent += 1;
    else failed += 1;
    await delay(SEND_PACING_MS);
  }
  return { sent, failed, total: input.messageIds.length };
}
