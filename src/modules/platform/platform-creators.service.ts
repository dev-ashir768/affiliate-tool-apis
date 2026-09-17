import type { CreatorStage, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";

function toPlatformCreator(row: {
  id: string;
  handle: string;
  displayName: string | null;
  contactEmail: string | null;
  region: string | null;
  followerCount: number | null;
  notes: string | null;
  stage: CreatorStage;
  createdAt: Date;
  updatedAt: Date;
  organization: { id: string; name: string; slug: string };
}) {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    contactEmail: row.contactEmail,
    region: row.region,
    followerCount: row.followerCount,
    notes: row.notes,
    stage: row.stage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    organization: row.organization,
  };
}

export async function listPlatformCreators(params: {
  page: number;
  pageSize: number;
  search?: string;
  organizationId?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const where: Prisma.CreatorWhereInput = {};
  if (params.organizationId) {
    where.organizationId = params.organizationId;
  }
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { handle: { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } },
      { contactEmail: { contains: q, mode: "insensitive" } },
      { organization: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const orderBy: Prisma.CreatorOrderByWithRelationInput =
    params.sortBy === "handle"
      ? { handle: params.sortOrder === "asc" ? "asc" : "desc" }
      : params.sortBy === "stage"
        ? { stage: params.sortOrder === "asc" ? "asc" : "desc" }
        : { updatedAt: params.sortOrder === "asc" ? "asc" : "desc" };

  const [total, rows] = await Promise.all([
    prisma.creator.count({ where }),
    prisma.creator.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    data: rows.map(toPlatformCreator),
    meta: { total, page: params.page, pageSize: params.pageSize },
  };
}

export async function createPlatformCreator(
  input: {
    organizationId: string;
    handle: string;
    displayName?: string | null;
    contactEmail?: string | null;
    region?: "US" | "UK" | null;
    followerCount?: number | null;
    notes?: string | null;
    stage?: CreatorStage;
  },
  actorUserId: string
) {
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
  });
  if (!org) throw new AppError("NOT_FOUND", "Organization not found", 404);

  const handle = input.handle.replace(/^@/, "").trim();
  try {
    const row = await prisma.creator.create({
      data: {
        organizationId: input.organizationId,
        handle,
        displayName: input.displayName ?? null,
        contactEmail: input.contactEmail?.trim() || null,
        region: input.region ?? null,
        followerCount: input.followerCount ?? null,
        notes: input.notes ?? null,
        stage: input.stage ?? "LEAD",
      },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    await writeAuditLog({
      actorUserId,
      action: "platform.creator.create",
      entityType: "Creator",
      entityId: row.id,
      meta: {
        organizationId: input.organizationId,
        handle: row.handle,
      },
    });

    return toPlatformCreator(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError(
        "CONFLICT",
        "Creator handle already exists in this organization",
        409
      );
    }
    throw err;
  }
}

export async function patchPlatformCreator(
  id: string,
  input: Partial<{
    handle: string;
    displayName: string | null;
    contactEmail: string | null;
    region: "US" | "UK" | null;
    followerCount: number | null;
    notes: string | null;
    stage: CreatorStage;
  }>,
  actorUserId: string
) {
  const existing = await prisma.creator.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Creator not found", 404);

  const data: Prisma.CreatorUpdateInput = {};
  if (input.handle !== undefined) {
    data.handle = input.handle.replace(/^@/, "").trim();
  }
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.contactEmail !== undefined) {
    data.contactEmail = input.contactEmail?.trim() || null;
  }
  if (input.region !== undefined) data.region = input.region;
  if (input.followerCount !== undefined) data.followerCount = input.followerCount;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.stage !== undefined) data.stage = input.stage;

  try {
    const row = await prisma.creator.update({
      where: { id },
      data,
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });
    await writeAuditLog({
      actorUserId,
      action: "platform.creator.patch",
      entityType: "Creator",
      entityId: id,
      meta: input,
    });
    return toPlatformCreator(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError(
        "CONFLICT",
        "Creator handle already exists in this organization",
        409
      );
    }
    throw err;
  }
}
