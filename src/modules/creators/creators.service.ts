import type { Creator, CreatorStage, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";

/** Metrics optional so mapping stays valid if the TS server lags behind `prisma generate`. */
type CreatorRow = {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  creatorOpenId: string | null;
  contactEmail?: string | null;
  region: string | null;
  followerCount: number | null;
  notes: string | null;
  stage: CreatorStage;
  createdAt: Date;
  updatedAt: Date;
  avatarUrl?: string | null;
  gmvAmount?: string | null;
  gmvCurrency?: string | null;
  gmvRange?: string | null;
  videoGmvAmount?: string | null;
  liveGmvAmount?: string | null;
  productCardGmvAmount?: string | null;
  avgCommissionRange?: string | null;
  unitsSold?: number | null;
  gpmAmount?: string | null;
  gpmCurrency?: string | null;
  gpmRange?: string | null;
  metricsSyncedAt?: Date | null;
};

function toCreator(row: CreatorRow) {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    displayName: row.displayName,
    creatorOpenId: row.creatorOpenId,
    contactEmail: row.contactEmail ?? null,
    region: row.region,
    followerCount: row.followerCount,
    avatarUrl: row.avatarUrl ?? null,
    gmvAmount: row.gmvAmount ?? null,
    gmvCurrency: row.gmvCurrency ?? null,
    gmvRange: row.gmvRange ?? null,
    videoGmvAmount: row.videoGmvAmount ?? null,
    liveGmvAmount: row.liveGmvAmount ?? null,
    productCardGmvAmount: row.productCardGmvAmount ?? null,
    avgCommissionRange: row.avgCommissionRange ?? null,
    unitsSold: row.unitsSold ?? null,
    gpmAmount: row.gpmAmount ?? null,
    gpmCurrency: row.gpmCurrency ?? null,
    gpmRange: row.gpmRange ?? null,
    metricsSyncedAt: row.metricsSyncedAt?.toISOString() ?? null,
    notes: row.notes,
    stage: row.stage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCreators(organizationId: string) {
  const rows = (await prisma.creator.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
  })) as Creator[];
  return { creators: rows.map(toCreator) };
}

export async function createCreator(
  organizationId: string,
  input: {
    handle: string;
    displayName?: string | null;
    creatorOpenId?: string | null;
    contactEmail?: string | null;
    region?: "US" | "UK" | null;
    followerCount?: number | null;
    notes?: string | null;
    stage?: CreatorStage;
  },
) {
  const handle = input.handle.replace(/^@/, "").trim();
  try {
    const row = await prisma.creator.create({
      data: {
        organizationId,
        handle,
        displayName: input.displayName ?? null,
        creatorOpenId: input.creatorOpenId?.trim() || null,
        contactEmail: input.contactEmail?.trim() || null,
        region: input.region ?? null,
        followerCount: input.followerCount ?? null,
        notes: input.notes ?? null,
        stage: input.stage ?? "LEAD",
      },
    });
    return toCreator(row as Creator);
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
    creatorOpenId: string | null;
    contactEmail: string | null;
    region: "US" | "UK" | null;
    followerCount: number | null;
    notes: string | null;
    stage: CreatorStage;
  }>,
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
  if (input.creatorOpenId !== undefined) {
    data.creatorOpenId = input.creatorOpenId?.trim() || null;
  }
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
  if (input.region !== undefined) data.region = input.region;
  if (input.followerCount !== undefined)
    data.followerCount = input.followerCount;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.stage !== undefined) data.stage = input.stage;

  try {
    const row = await prisma.creator.update({ where: { id }, data });
    return toCreator(row as Creator);
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
  input: { name: string; description?: string | null },
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
  creatorId: string,
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

export async function bulkAddCreatorsToList(
  organizationId: string,
  listId: string,
  creatorIds: string[],
) {
  const list = await prisma.creatorList.findFirst({
    where: { id: listId, organizationId },
  });
  if (!list) throw new AppError("NOT_FOUND", "List not found", 404);

  const uniqueIds = [...new Set(creatorIds.map(String))];
  const creators = await prisma.creator.findMany({
    where: { organizationId, id: { in: uniqueIds } },
    select: { id: true },
  });
  const found = new Set(creators.map((c) => c.id));
  const missing = uniqueIds.filter((id) => !found.has(id));

  let added = 0;
  let skipped = 0;
  for (const creatorId of found) {
    try {
      await prisma.creatorListMember.create({
        data: { listId, creatorId },
      });
      added += 1;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return {
    ok: true as const,
    added,
    skipped,
    missing,
    totalRequested: uniqueIds.length,
  };
}

/** Resolve CRM creator ids on a list (for invite/outreach bulk actions). */
export async function resolveCreatorIdsFromList(
  organizationId: string,
  listId: string,
  opts: { limit?: number } = {},
) {
  const list = await prisma.creatorList.findFirst({
    where: { id: listId, organizationId },
  });
  if (!list) throw new AppError("NOT_FOUND", "List not found", 404);

  const total = await prisma.creatorListMember.count({ where: { listId } });
  const members = await prisma.creatorListMember.findMany({
    where: { listId },
    select: { creatorId: true },
    orderBy: { createdAt: "asc" },
    ...(opts.limit != null ? { take: opts.limit } : {}),
  });

  return {
    listId: list.id,
    listName: list.name,
    creatorIds: members.map((m) => m.creatorId),
    totalMembers: total,
    truncated: opts.limit != null && total > opts.limit,
  };
}

export async function listCreatorListMembers(
  organizationId: string,
  listId: string,
) {
  const list = await prisma.creatorList.findFirst({
    where: { id: listId, organizationId },
  });
  if (!list) throw new AppError("NOT_FOUND", "List not found", 404);

  const members = await prisma.creatorListMember.findMany({
    where: { listId },
    include: {
      creator: {
        select: {
          id: true,
          handle: true,
          displayName: true,
          stage: true,
          followerCount: true,
          gmvRange: true,
          contactEmail: true,
          creatorOpenId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    list: {
      id: list.id,
      name: list.name,
      description: list.description,
    },
    members: members.map((m) => ({
      creatorId: m.creatorId,
      addedAt: m.createdAt.toISOString(),
      handle: m.creator.handle,
      displayName: m.creator.displayName,
      stage: m.creator.stage,
      followerCount: m.creator.followerCount,
      gmvRange: m.creator.gmvRange,
      contactEmail: m.creator.contactEmail,
      hasOpenId: Boolean(m.creator.creatorOpenId),
    })),
  };
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
  },
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
  }>,
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

/**
 * Queue the same target-collab (or email→invite automation) across multiple OAuth shops.
 */
export async function runCampaignAcrossShops(
  organizationId: string,
  campaignId: string,
  actorUserId: string | undefined,
  input: {
    shopIds: string[];
    listId?: string;
    creatorIds?: string[];
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
    withEmailStep?: boolean;
    templateId?: string;
    emailDelayMinutes?: number;
  },
) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  });
  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found", 404);

  const uniqueShopIds = [...new Set(input.shopIds.map(String))];
  if (uniqueShopIds.length === 0) {
    throw new AppError("VALIDATION_ERROR", "shopIds required", 400);
  }
  if (uniqueShopIds.length > 5) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Max 5 shops per multi-shop run",
      400,
    );
  }

  const shops = await prisma.shop.findMany({
    where: {
      organizationId,
      id: { in: uniqueShopIds },
      status: { not: "DISCONNECTED" },
    },
  });
  if (shops.length !== uniqueShopIds.length) {
    throw new AppError("NOT_FOUND", "One or more shops not found", 404);
  }
  const notReady = shops.filter((s) => !s.oauthConnectedAt);
  if (notReady.length) {
    throw new AppError(
      "SHOP_NOT_READY",
      `Authorize TikTok first: ${notReady.map((s) => s.displayName || s.id).join(", ")}`,
      400,
    );
  }

  let creatorIds = [...new Set((input.creatorIds ?? []).map(String))];
  let listMeta: {
    listId: string;
    listName: string;
    totalMembers: number;
    truncated: boolean;
  } | null = null;
  if (input.listId) {
    const resolved = await resolveCreatorIdsFromList(
      organizationId,
      input.listId,
      { limit: 50 },
    );
    creatorIds = resolved.creatorIds;
    listMeta = {
      listId: resolved.listId,
      listName: resolved.listName,
      totalMembers: resolved.totalMembers,
      truncated: resolved.truncated,
    };
  }
  if (creatorIds.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "No creators — provide creatorIds or a non-empty listId",
      400,
    );
  }

  const { createAffiliateInvite } =
    await import("../invites/invites.service.js");
  const { createAutomationRun } =
    await import("../automations/automations.service.js");

  const results: Array<{
    shopId: string;
    shopName: string | null;
    ok: boolean;
    inviteId?: string;
    automationRunId?: string;
    jobId?: string | null;
    error?: string;
  }> = [];

  for (const shop of shops) {
    try {
      if (input.withEmailStep && input.templateId) {
        const run = await createAutomationRun(organizationId, actorUserId, {
          name: `${input.inviteName} · ${shop.displayName || shop.id}`,
          campaignId,
          shopId: shop.id,
          creatorIds,
          steps: [
            {
              kind: "EMAIL",
              delayMinutes: 0,
              templateId: input.templateId,
            },
            {
              kind: "AFFILIATE_INVITE",
              delayMinutes: input.emailDelayMinutes ?? 60,
              inviteName: input.inviteName,
              message: input.message,
              endAt: input.endAt,
              sellerContactEmail: input.sellerContactEmail,
              hasFreeSample: input.hasFreeSample,
              sampleApprovalExempt: input.sampleApprovalExempt,
              products: input.products,
            },
          ],
        });
        results.push({
          shopId: shop.id,
          shopName: shop.displayName,
          ok: true,
          automationRunId: run.run.id,
          jobId: run.jobId,
        });
      } else {
        const invite = await createAffiliateInvite(
          organizationId,
          actorUserId,
          {
            shopId: shop.id,
            campaignId,
            name: input.inviteName,
            message: input.message,
            endAt: input.endAt,
            sellerContactEmail: input.sellerContactEmail,
            hasFreeSample: input.hasFreeSample,
            sampleApprovalExempt: input.sampleApprovalExempt,
            products: input.products,
            creatorIds,
            sync: false,
          },
        );
        results.push({
          shopId: shop.id,
          shopName: shop.displayName,
          ok: true,
          inviteId: invite.invite.id,
          jobId: invite.jobId,
        });
      }
    } catch (err) {
      results.push({
        shopId: shop.id,
        shopName: shop.displayName,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (campaign.status === "DRAFT") {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "ACTIVE" },
    });
  }

  if (actorUserId) {
    await writeAuditLog({
      actorUserId,
      action: "campaign.multi_shop_run",
      entityType: "Campaign",
      entityId: campaignId,
      meta: {
        shops: uniqueShopIds.length,
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        withEmailStep: Boolean(input.withEmailStep),
      },
    });
  }

  return {
    campaignId,
    list: listMeta,
    results,
    okCount: results.filter((r) => r.ok).length,
    failCount: results.filter((r) => !r.ok).length,
  };
}
