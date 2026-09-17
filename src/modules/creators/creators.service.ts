import type { CreatorStage, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

function toCreator(row: {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  region: string | null;
  followerCount: number | null;
  notes: string | null;
  stage: CreatorStage;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    displayName: row.displayName,
    region: row.region,
    followerCount: row.followerCount,
    notes: row.notes,
    stage: row.stage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCreators(organizationId: string) {
  const rows = await prisma.creator.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
  });
  return { creators: rows.map(toCreator) };
}

export async function createCreator(
  organizationId: string,
  input: {
    handle: string;
    displayName?: string | null;
    region?: "US" | "UK" | null;
    followerCount?: number | null;
    notes?: string | null;
    stage?: CreatorStage;
  }
) {
  const handle = input.handle.replace(/^@/, "").trim();
  try {
    const row = await prisma.creator.create({
      data: {
        organizationId,
        handle,
        displayName: input.displayName ?? null,
        region: input.region ?? null,
        followerCount: input.followerCount ?? null,
        notes: input.notes ?? null,
        stage: input.stage ?? "LEAD",
      },
    });
    return toCreator(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError("CONFLICT", "Creator handle already exists", 409);
    }
    throw err;
  }
}

export async function patchCreator(
  organizationId: string,
  id: string,
  input: Partial<{
    handle: string;
    displayName: string | null;
    region: "US" | "UK" | null;
    followerCount: number | null;
    notes: string | null;
    stage: CreatorStage;
  }>
) {
  const existing = await prisma.creator.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Creator not found", 404);

  const data: Prisma.CreatorUpdateInput = {};
  if (input.handle !== undefined) {
    data.handle = input.handle.replace(/^@/, "").trim();
  }
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.region !== undefined) data.region = input.region;
  if (input.followerCount !== undefined) data.followerCount = input.followerCount;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.stage !== undefined) data.stage = input.stage;

  try {
    const row = await prisma.creator.update({ where: { id }, data });
    return toCreator(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError("CONFLICT", "Creator handle already exists", 409);
    }
    throw err;
  }
}

export async function deleteCreator(organizationId: string, id: string) {
  const existing = await prisma.creator.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Creator not found", 404);
  await prisma.creator.delete({ where: { id } });
  return { ok: true as const };
}

export async function listCreatorLists(organizationId: string) {
  const rows = await prisma.creatorList.findMany({
    where: { organizationId },
    include: { _count: { select: { members: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return {
    lists: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      memberCount: r._count.members,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export async function createCreatorList(
  organizationId: string,
  input: { name: string; description?: string | null }
) {
  try {
    const row = await prisma.creatorList.create({
      data: {
        organizationId,
        name: input.name.trim(),
        description: input.description ?? null,
      },
    });
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      memberCount: 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError("CONFLICT", "List name already exists", 409);
    }
    throw err;
  }
}

export async function addCreatorToList(
  organizationId: string,
  listId: string,
  creatorId: string
) {
  const list = await prisma.creatorList.findFirst({
    where: { id: listId, organizationId },
  });
  if (!list) throw new AppError("NOT_FOUND", "List not found", 404);
  const creator = await prisma.creator.findFirst({
    where: { id: creatorId, organizationId },
  });
  if (!creator) throw new AppError("NOT_FOUND", "Creator not found", 404);

  try {
    await prisma.creatorListMember.create({
      data: { listId, creatorId },
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError("CONFLICT", "Creator already on list", 409);
    }
    throw err;
  }
  return { ok: true as const };
}

export async function listCampaigns(organizationId: string) {
  const rows = await prisma.campaign.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
  });
  return {
    campaigns: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      brief: r.brief,
      offerNote: r.offerNote,
      deadline: r.deadline?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export async function createCampaign(
  organizationId: string,
  input: {
    name: string;
    brief?: string | null;
    offerNote?: string | null;
    deadline?: string | null;
    status?: "DRAFT" | "ACTIVE" | "PAUSED" | "DONE";
  }
) {
  const row = await prisma.campaign.create({
    data: {
      organizationId,
      name: input.name.trim(),
      brief: input.brief ?? null,
      offerNote: input.offerNote ?? null,
      deadline: input.deadline ? new Date(input.deadline) : null,
      status: input.status ?? "DRAFT",
    },
  });
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    brief: row.brief,
    offerNote: row.offerNote,
    deadline: row.deadline?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function patchCampaign(
  organizationId: string,
  id: string,
  input: Partial<{
    name: string;
    brief: string | null;
    offerNote: string | null;
    deadline: string | null;
    status: "DRAFT" | "ACTIVE" | "PAUSED" | "DONE";
  }>
) {
  const existing = await prisma.campaign.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Campaign not found", 404);

  const row = await prisma.campaign.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.brief !== undefined ? { brief: input.brief } : {}),
      ...(input.offerNote !== undefined ? { offerNote: input.offerNote } : {}),
      ...(input.deadline !== undefined
        ? { deadline: input.deadline ? new Date(input.deadline) : null }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    brief: row.brief,
    offerNote: row.offerNote,
    deadline: row.deadline?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
