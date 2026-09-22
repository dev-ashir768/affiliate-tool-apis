import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import {
  createTargetCollaboration,
  searchShopProducts,
} from "../../lib/tiktok-shop/client.js";
import { getShopOpenApiCredentials } from "../shops/tiktok-oauth.service.js";
import { resolveCreatorIdsFromList } from "../creators/creators.service.js";
import {
  affiliateInviteQueue,
  AFFILIATE_INVITE_QUEUE,
} from "../../lib/queue.js";

type InviteProductStored = {
  id: string;
  targetCommissionRate: number;
  shopAdsCommissionRate?: number;
};

function percentToTikTokRate(percent: number): number {
  return Math.round(percent * 100);
}

function toInvite(row: {
  id: string;
  shopId: string;
  campaignId: string | null;
  name: string;
  message: string | null;
  endAt: Date;
  sellerContactEmail: string | null;
  hasFreeSample: boolean;
  sampleApprovalExempt: boolean;
  products: Prisma.JsonValue;
  externalCollaborationId: string | null;
  status: string;
  lastError: string | null;
  conflicts: Prisma.JsonValue;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  recipients?: Array<{
    id: string;
    creatorId: string;
    creatorOpenId: string;
    status: string;
    lastError: string | null;
    creator?: { handle: string; displayName: string | null };
  }>;
  shop?: { displayName: string | null; region: string };
}) {
  return {
    id: row.id,
    shopId: row.shopId,
    shopDisplayName: row.shop?.displayName ?? null,
    shopRegion: row.shop?.region ?? null,
    campaignId: row.campaignId,
    name: row.name,
    message: row.message,
    endAt: row.endAt.toISOString(),
    sellerContactEmail: row.sellerContactEmail,
    hasFreeSample: row.hasFreeSample,
    sampleApprovalExempt: row.sampleApprovalExempt,
    products: row.products,
    externalCollaborationId: row.externalCollaborationId,
    status: row.status,
    lastError: row.lastError,
    conflicts: row.conflicts,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    recipients: (row.recipients ?? []).map((r) => ({
      id: r.id,
      creatorId: r.creatorId,
      creatorOpenId: r.creatorOpenId,
      creatorHandle: r.creator?.handle ?? null,
      creatorDisplayName: r.creator?.displayName ?? null,
      status: r.status,
      lastError: r.lastError,
    })),
  };
}

async function countInvitesToday(organizationId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return prisma.affiliateInviteRecipient.count({
    where: {
      invite: {
        organizationId,
        createdAt: { gte: start },
        status: { in: ["QUEUED", "SENT", "PARTIAL"] },
      },
      status: { in: ["PENDING", "INVITED"] },
    },
  });
}

/** Resolve open_id: CRM field, else discovery profile by handle. */
async function resolveCreatorOpenIds(
  organizationId: string,
  creators: Array<{
    id: string;
    handle: string;
    creatorOpenId: string | null;
  }>,
): Promise<{
  ready: Array<{ creatorId: string; creatorOpenId: string; handle: string }>;
  skipped: Array<{ creatorId: string; handle: string; reason: string }>;
}> {
  const ready: Array<{
    creatorId: string;
    creatorOpenId: string;
    handle: string;
  }> = [];
  const skipped: Array<{ creatorId: string; handle: string; reason: string }> =
    [];

  const missing = creators.filter((c) => !c.creatorOpenId?.trim());
  const discovery =
    missing.length > 0
      ? await prisma.creatorDiscoveryProfile.findMany({
          where: {
            platform: "TIKTOK",
            handle: { in: missing.map((c) => c.handle) },
            creatorOpenId: { not: null },
          },
          select: { handle: true, creatorOpenId: true },
        })
      : [];
  const byHandle = new Map(
    discovery
      .filter((d) => d.creatorOpenId)
      .map((d) => [d.handle, d.creatorOpenId as string]),
  );

  for (const c of creators) {
    let openId = c.creatorOpenId?.trim() || null;
    if (!openId) {
      openId = byHandle.get(c.handle) ?? null;
      if (openId) {
        await prisma.creator.update({
          where: { id: c.id },
          data: { creatorOpenId: openId },
        });
      }
    }
    if (!openId) {
      skipped.push({
        creatorId: c.id,
        handle: c.handle,
        reason: "Missing creatorOpenId — re-sync discovery then Save to CRM",
      });
      continue;
    }
    ready.push({
      creatorId: c.id,
      creatorOpenId: openId,
      handle: c.handle,
    });
  }

  void organizationId;
  return { ready, skipped };
}

export async function listShopProductsForInvite(
  organizationId: string,
  input: { shopId: string; pageSize?: number; pageToken?: string | null },
) {
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

  const credentials = await getShopOpenApiCredentials(
    organizationId,
    input.shopId,
  );
  const result = await searchShopProducts({
    credentials,
    pageSize: input.pageSize,
    pageToken: input.pageToken,
    status: "ACTIVATE",
  });
  return result;
}

export async function listAffiliateInvites(organizationId: string) {
  const rows = await prisma.affiliateInvite.findMany({
    where: { organizationId },
    include: {
      shop: { select: { displayName: true, region: true } },
      recipients: {
        include: {
          creator: { select: { handle: true, displayName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return { invites: rows.map(toInvite) };
}

export async function getAffiliateInvite(
  organizationId: string,
  inviteId: string,
) {
  const row = await prisma.affiliateInvite.findFirst({
    where: { id: inviteId, organizationId },
    include: {
      shop: { select: { displayName: true, region: true } },
      recipients: {
        include: {
          creator: { select: { handle: true, displayName: true } },
        },
      },
    },
  });
  if (!row) throw new AppError("NOT_FOUND", "Invite not found", 404);
  return toInvite(row);
}

export async function createAffiliateInvite(
  organizationId: string,
  actorUserId: string | undefined,
  input: {
    shopId: string;
    campaignId?: string | null;
    name: string;
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
    creatorIds?: string[];
    listId?: string;
    sync?: boolean;
  },
) {
  const endAt = new Date(input.endAt);
  if (Number.isNaN(endAt.getTime()) || endAt.getTime() <= Date.now()) {
    throw new AppError(
      "VALIDATION_ERROR",
      "endAt must be a future datetime",
      400,
    );
  }

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
      "Authorize TikTok on this shop before sending invites",
      400,
    );
  }

  if (input.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, organizationId },
    });
    if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  }

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
      { limit: 50 },
    );
    uniqueIds = [...new Set([...uniqueIds, ...resolved.creatorIds])].slice(
      0,
      50,
    );
    listMeta = {
      listId: resolved.listId,
      listName: resolved.listName,
      totalMembers: resolved.totalMembers,
      truncated: resolved.truncated || resolved.totalMembers > 50,
    };
  }
  if (uniqueIds.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "No creators to invite — provide creatorIds or a non-empty listId",
      400,
    );
  }

  const creators = await prisma.creator.findMany({
    where: { organizationId, id: { in: uniqueIds } },
  });
  if (creators.length === 0) {
    throw new AppError("NOT_FOUND", "No matching creators", 404);
  }

  const { ready, skipped } = await resolveCreatorOpenIds(
    organizationId,
    creators,
  );
  if (ready.length === 0) {
    throw new AppError(
      "FAILED_PRECONDITION",
      `No creators have TikTok open_id. Skipped: ${skipped
        .map((s) => `@${s.handle}`)
        .join(", ")}. Re-sync Discover then Save to CRM.`,
      400,
      { skipped },
    );
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { dailyInviteQuota: true },
  });
  const usedToday = await countInvitesToday(organizationId);
  if (usedToday + ready.length > org.dailyInviteQuota) {
    throw new AppError(
      "PLAN_LIMIT",
      `Daily invite quota exceeded (${usedToday}/${org.dailyInviteQuota}). Upgrade plan or wait until UTC midnight.`,
      429,
      { usedToday, quota: org.dailyInviteQuota, requesting: ready.length },
    );
  }

  const products: InviteProductStored[] = input.products.map((p) => ({
    id: p.id,
    targetCommissionRate: percentToTikTokRate(p.commissionPercent),
    ...(p.shopAdsCommissionPercent != null
      ? {
          shopAdsCommissionRate: percentToTikTokRate(
            p.shopAdsCommissionPercent,
          ),
        }
      : {}),
  }));

  const invite = await prisma.affiliateInvite.create({
    data: {
      organizationId,
      shopId: input.shopId,
      campaignId: input.campaignId ?? null,
      name: input.name.trim(),
      message: input.message?.trim() || null,
      endAt,
      sellerContactEmail: input.sellerContactEmail?.trim() || null,
      hasFreeSample: Boolean(input.hasFreeSample),
      sampleApprovalExempt: Boolean(input.sampleApprovalExempt),
      products,
      status: "QUEUED",
      recipients: {
        create: ready.map((r) => ({
          creatorId: r.creatorId,
          creatorOpenId: r.creatorOpenId,
          status: "PENDING",
        })),
      },
    },
    include: {
      shop: { select: { displayName: true, region: true } },
      recipients: {
        include: {
          creator: { select: { handle: true, displayName: true } },
        },
      },
    },
  });

  if (actorUserId) {
    await writeAuditLog({
      actorUserId,
      action: "affiliate_invite.create",
      entityType: "AffiliateInvite",
      entityId: invite.id,
      meta: {
        shopId: input.shopId,
        creators: ready.length,
        skipped: skipped.length,
        products: products.length,
      },
    });
  }

  if (input.sync) {
    const delivered = await deliverAffiliateInvite(invite.id);
    const fresh = await getAffiliateInvite(organizationId, invite.id);
    return {
      invite: fresh,
      skipped,
      list: listMeta,
      ...delivered,
      status: fresh.status as "QUEUED" | "SENT" | "PARTIAL" | "FAILED",
      jobId: null as string | null,
    };
  }

  try {
    const job = await affiliateInviteQueue.add(
      "send",
      {
        organizationId,
        inviteId: invite.id,
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
      invite: toInvite(invite),
      skipped,
      list: listMeta,
      sent: 0,
      failed: 0,
      conflicts: 0,
      jobId: job.id != null ? String(job.id) : "unknown",
      status: "QUEUED" as const,
      queue: AFFILIATE_INVITE_QUEUE,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Queue unavailable";
    await prisma.affiliateInvite.update({
      where: { id: invite.id },
      data: { status: "FAILED", lastError: message },
    });
    throw new AppError(
      "INTERNAL",
      `Unable to enqueue affiliate invite: ${message}`,
      503,
    );
  }
}

export async function deliverAffiliateInvite(inviteId: string): Promise<{
  sent: number;
  failed: number;
  conflicts: number;
  externalCollaborationId: string | null;
}> {
  const invite = await prisma.affiliateInvite.findUnique({
    where: { id: inviteId },
    include: { recipients: true },
  });
  if (!invite) {
    throw new AppError("NOT_FOUND", "Invite not found", 404);
  }

  const pending = invite.recipients.filter((r) => r.status === "PENDING");
  if (pending.length === 0) {
    return {
      sent: 0,
      failed: invite.recipients.length,
      conflicts: 0,
      externalCollaborationId: invite.externalCollaborationId,
    };
  }

  const products = invite.products as InviteProductStored[];

  try {
    const credentials = await getShopOpenApiCredentials(
      invite.organizationId,
      invite.shopId,
    );

    const result = await createTargetCollaboration({
      credentials,
      name: invite.name,
      message: invite.message,
      endTimeUnix: Math.floor(invite.endAt.getTime() / 1000),
      creatorOpenIds: pending.map((r) => r.creatorOpenId),
      products: products.map((p) => ({
        id: p.id,
        targetCommissionRate: p.targetCommissionRate,
        shopAdsCommissionRate: p.shopAdsCommissionRate,
      })),
      hasFreeSample: invite.hasFreeSample,
      sampleApprovalExempt: invite.sampleApprovalExempt,
      sellerContactEmail: invite.sellerContactEmail,
    });

    const conflictOpenIds = new Set(
      result.conflicts
        .map((c) => c.creatorOpenId)
        .filter((id): id is string => Boolean(id)),
    );

    let sent = 0;
    let conflicts = 0;

    for (const r of pending) {
      if (conflictOpenIds.has(r.creatorOpenId)) {
        conflicts += 1;
        await prisma.affiliateInviteRecipient.update({
          where: { id: r.id },
          data: {
            status: "CONFLICT",
            lastError: "TikTok reported a target collaboration conflict",
          },
        });
      } else {
        sent += 1;
        await prisma.affiliateInviteRecipient.update({
          where: { id: r.id },
          data: { status: "INVITED", lastError: null },
        });
        await prisma.creator.updateMany({
          where: {
            id: r.creatorId,
            stage: { in: ["LEAD", "CONTACTED"] },
          },
          data: { stage: "INVITED" },
        });
      }
    }

    const status =
      conflicts === 0 && sent > 0 ? "SENT" : sent > 0 ? "PARTIAL" : "FAILED";

    await prisma.affiliateInvite.update({
      where: { id: invite.id },
      data: {
        status,
        externalCollaborationId: result.targetCollaborationId,
        conflicts: result.conflicts,
        sentAt: new Date(),
        lastError:
          status === "FAILED"
            ? "All creators conflicted or invite failed"
            : null,
      },
    });

    logger.info("affiliate invite delivered", {
      inviteId: invite.id,
      externalCollaborationId: result.targetCollaborationId,
      sent,
      conflicts,
    });

    return {
      sent,
      failed: 0,
      conflicts,
      externalCollaborationId: result.targetCollaborationId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.affiliateInvite.update({
      where: { id: invite.id },
      data: { status: "FAILED", lastError: message },
    });
    for (const r of pending) {
      await prisma.affiliateInviteRecipient.update({
        where: { id: r.id },
        data: { status: "FAILED", lastError: message },
      });
    }
    logger.error("affiliate invite delivery failed", {
      inviteId: invite.id,
      error: message,
    });
    if (err instanceof AppError) throw err;
    throw new AppError("INTERNAL", message, 502);
  }
}

export async function processAffiliateInviteJob(input: {
  organizationId: string;
  inviteId: string;
}) {
  const invite = await prisma.affiliateInvite.findFirst({
    where: { id: input.inviteId, organizationId: input.organizationId },
  });
  if (!invite) {
    return { sent: 0, failed: 1, conflicts: 0 };
  }
  return deliverAffiliateInvite(invite.id);
}
