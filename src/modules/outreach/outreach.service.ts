import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getEmailProvider } from "../../lib/email.js";

function renderTokens(
  input: string,
  vars: { handle: string; displayName: string; contactEmail: string }
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

export async function listTemplates(organizationId: string) {
  const rows = await prisma.outreachTemplate.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
  });
  return { templates: rows.map(toTemplate) };
}

export async function createTemplate(
  organizationId: string,
  input: { name: string; subject: string; bodyText: string }
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
  input: Partial<{ name: string; subject: string; bodyText: string }>
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

export async function sendOutreach(
  organizationId: string,
  input: {
    creatorId: string;
    templateId?: string;
    campaignId?: string | null;
    subject?: string;
    bodyText?: string;
  }
) {
  const creator = await prisma.creator.findFirst({
    where: { id: input.creatorId, organizationId },
  });
  if (!creator) throw new AppError("NOT_FOUND", "Creator not found", 404);

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
      400
    );
  }

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

  try {
    await getEmailProvider().send({
      to: creator.contactEmail,
      subject: renderedSubject,
      text: renderedBody,
    });
    const sent = await prisma.outreachMessage.update({
      where: { id: message.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastError: null,
      },
      include: {
        creator: { select: { handle: true, displayName: true } },
      },
    });
    await prisma.creator.update({
      where: { id: creator.id },
      data: {
        stage:
          creator.stage === "LEAD" || creator.stage === "CONTACTED"
            ? "INVITED"
            : creator.stage,
      },
    });
    return toMessage(sent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send failed";
    const failed = await prisma.outreachMessage.update({
      where: { id: message.id },
      data: { status: "FAILED", lastError: msg },
      include: {
        creator: { select: { handle: true, displayName: true } },
      },
    });
    return toMessage(failed);
  }
}
