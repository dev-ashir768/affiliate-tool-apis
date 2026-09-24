import type { Prisma } from "@prisma/client";
import type { SampleRequestStatus } from "../../lib/prisma-enums.js";
import { prisma, sampleRequests } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import {
  reviewSampleApplication,
  searchSampleApplications,
  searchSampleFulfillments,
} from "../../lib/tiktok-shop/client.js";
import { getShopOpenApiCredentials } from "../shops/tiktok-oauth.service.js";

function mapTikTokSampleStatus(status: string | null): SampleRequestStatus {
  const s = (status ?? "").toUpperCase();
  if (s.includes("REJECT") || s.includes("DENY")) return "REJECTED";
  if (s.includes("FULFILL") && s.includes("COMPLETE")) return "FULFILLED";
  if (s.includes("FULFILL") || s.includes("SHIP")) return "FULFILLING";
  if (s.includes("APPROVE") || s.includes("PASS")) return "APPROVED";
  if (s.includes("CANCEL")) return "CANCELED";
  if (s.includes("FAIL")) return "FAILED";
  return "PENDING";
}

function toSample(row: {
  id: string;
  shopId: string;
  creatorId: string | null;
  affiliateInviteId: string | null;
  externalApplicationId: string | null;
  externalProductId: string | null;
  productTitle: string | null;
  creatorUsername: string | null;
  creatorOpenId: string | null;
  status: SampleRequestStatus;
  reviewNote: string | null;
  lastError: string | null;
  requestedAt: Date | null;
  reviewedAt: Date | null;
  fulfilledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  creator?: { handle: string; displayName: string | null } | null;
  shop?: { displayName: string | null; region: string } | null;
}) {
  return {
    id: row.id,
    shopId: row.shopId,
    shopName: row.shop?.displayName ?? null,
    shopRegion: row.shop?.region ?? null,
    creatorId: row.creatorId,
    creatorHandle: row.creator?.handle ?? row.creatorUsername ?? null,
    creatorDisplayName: row.creator?.displayName ?? null,
    affiliateInviteId: row.affiliateInviteId,
    externalApplicationId: row.externalApplicationId,
    externalProductId: row.externalProductId,
    productTitle: row.productTitle,
    creatorUsername: row.creatorUsername,
    creatorOpenId: row.creatorOpenId,
    status: row.status,
    reviewNote: row.reviewNote,
    lastError: row.lastError,
    requestedAt: row.requestedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSampleRequests(
  organizationId: string,
  filters: { status?: SampleRequestStatus; shopId?: string } = {},
) {
  const rows = await sampleRequests.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.shopId ? { shopId: filters.shopId } : {}),
    },
    include: {
      creator: { select: { handle: true, displayName: true } },
      shop: { select: { displayName: true, region: true } },
    },
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return { samples: rows.map(toSample) };
}

export async function createManualSampleRequest(
  organizationId: string,
  input: {
    shopId: string;
    creatorId?: string | null;
    productTitle?: string | null;
    externalProductId?: string | null;
    creatorUsername?: string | null;
    note?: string | null;
  },
) {
  const shop = await prisma.shop.findFirst({
    where: {
      id: input.shopId,
      organizationId,
      status: { not: "DISCONNECTED" },
    },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);

  let creatorUsername = input.creatorUsername ?? null;
  let creatorOpenId: string | null = null;
  if (input.creatorId) {
    const creator = await prisma.creator.findFirst({
      where: { id: input.creatorId, organizationId },
    });
    if (!creator) throw new AppError("NOT_FOUND", "Creator not found", 404);
    creatorUsername = creator.handle;
    creatorOpenId = creator.creatorOpenId;
  }

  const row = await sampleRequests.create({
    data: {
      organizationId,
      shopId: input.shopId,
      creatorId: input.creatorId ?? null,
      productTitle: input.productTitle ?? null,
      externalProductId: input.externalProductId ?? null,
      creatorUsername,
      creatorOpenId,
      reviewNote: input.note ?? null,
      status: "PENDING",
      requestedAt: new Date(),
    },
    include: {
      creator: { select: { handle: true, displayName: true } },
      shop: { select: { displayName: true, region: true } },
    },
  });
  return toSample(row);
}

export async function syncSampleRequestsFromTikTok(input: {
  organizationId: string;
  shopId: string;
  maxPages?: number;
  actorUserId?: string;
}) {
  const shop = await prisma.shop.findFirst({
    where: {
      id: input.shopId,
      organizationId: input.organizationId,
      status: { not: "DISCONNECTED" },
    },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
  if (!shop.oauthConnectedAt) {
    throw new AppError(
      "SHOP_NOT_READY",
      "Authorize TikTok on this shop before syncing samples",
      400,
    );
  }

  const credentials = await getShopOpenApiCredentials(
    input.organizationId,
    input.shopId,
  );
  const maxPages = Math.min(10, Math.max(1, input.maxPages ?? 5));

  let pageToken: string | null = null;
  let imported = 0;
  let updated = 0;
  let pages = 0;

  for (let page = 0; page < maxPages; page++) {
    const result = await searchSampleApplications({
      credentials,
      pageSize: 20,
      pageToken,
    });
    pages += 1;

    for (const app of result.applications) {
      let creatorId: string | null = null;
      if (app.creatorOpenId) {
        const byOpenId = await prisma.creator.findFirst({
          where: {
            organizationId: input.organizationId,
            creatorOpenId: app.creatorOpenId,
          },
          select: { id: true },
        });
        creatorId = byOpenId?.id ?? null;
      }
      if (!creatorId && app.creatorUsername) {
        const handle = app.creatorUsername.replace(/^@/, "");
        const byHandle = await prisma.creator.findFirst({
          where: {
            organizationId: input.organizationId,
            platform: "TIKTOK",
            handle,
          },
          select: { id: true },
        });
        creatorId = byHandle?.id ?? null;
      }

      const status = mapTikTokSampleStatus(app.status);
      const requestedAt =
        app.createTime != null ? new Date(app.createTime * 1000) : new Date();

      const existing = await sampleRequests.findFirst({
        where: {
          organizationId: input.organizationId,
          externalApplicationId: app.applicationId,
        },
      });

      if (existing) {
        await sampleRequests.update({
          where: { id: existing.id },
          data: {
            status,
            creatorId: creatorId ?? existing.creatorId,
            productTitle: app.productTitle ?? existing.productTitle,
            externalProductId: app.productId ?? existing.externalProductId,
            creatorUsername: app.creatorUsername ?? existing.creatorUsername,
            creatorOpenId: app.creatorOpenId ?? existing.creatorOpenId,
            metricsRaw: app.raw as Prisma.InputJsonValue,
            requestedAt: existing.requestedAt ?? requestedAt,
            shopId: input.shopId,
          },
        });
        updated += 1;
      } else {
        await sampleRequests.create({
          data: {
            organizationId: input.organizationId,
            shopId: input.shopId,
            creatorId,
            externalApplicationId: app.applicationId,
            externalProductId: app.productId,
            productTitle: app.productTitle,
            creatorUsername: app.creatorUsername,
            creatorOpenId: app.creatorOpenId,
            status,
            metricsRaw: app.raw as Prisma.InputJsonValue,
            requestedAt,
          },
        });
        imported += 1;
      }
    }

    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }

  if (input.actorUserId) {
    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "samples.sync",
      entityType: "SampleRequest",
      meta: {
        shopId: input.shopId,
        imported,
        updated,
        pages,
      },
    });
  }

  return { shopId: input.shopId, pages, imported, updated };
}

export async function reviewSampleRequest(
  organizationId: string,
  sampleId: string,
  input: {
    action: "APPROVE" | "REJECT";
    note?: string | null;
    actorUserId?: string;
  },
) {
  const row = await sampleRequests.findFirst({
    where: { id: sampleId, organizationId },
  });
  if (!row) throw new AppError("NOT_FOUND", "Sample request not found", 404);
  if (row.status !== "PENDING" && row.status !== "FAILED") {
    throw new AppError(
      "FAILED_PRECONDITION",
      `Cannot review sample in status ${row.status}`,
      400,
    );
  }

  if (row.externalApplicationId) {
    const credentials = await getShopOpenApiCredentials(
      organizationId,
      row.shopId,
    );
    try {
      await reviewSampleApplication({
        credentials,
        applicationId: row.externalApplicationId,
        reviewResult: input.action,
        reason: input.note,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sampleRequests.update({
        where: { id: row.id },
        data: { lastError: message, status: "FAILED" },
      });
      throw err;
    }
  }

  const nextStatus: SampleRequestStatus =
    input.action === "APPROVE" ? "APPROVED" : "REJECTED";

  const updated = await sampleRequests.update({
    where: { id: row.id },
    data: {
      status: nextStatus,
      reviewNote: input.note?.trim() || null,
      reviewedAt: new Date(),
      lastError: null,
    },
    include: {
      creator: { select: { handle: true, displayName: true } },
      shop: { select: { displayName: true, region: true } },
    },
  });

  if (input.actorUserId) {
    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "samples.review",
      entityType: "SampleRequest",
      entityId: row.id,
      meta: { action: input.action },
    });
  }

  return toSample(updated);
}

export async function refreshSampleFulfillment(
  organizationId: string,
  sampleId: string,
) {
  const row = await sampleRequests.findFirst({
    where: { id: sampleId, organizationId },
  });
  if (!row) throw new AppError("NOT_FOUND", "Sample request not found", 404);
  if (!row.externalApplicationId) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Manual sample has no TikTok application id",
      400,
    );
  }

  const credentials = await getShopOpenApiCredentials(
    organizationId,
    row.shopId,
  );
  const { fulfillments } = await searchSampleFulfillments({
    credentials,
    applicationId: row.externalApplicationId,
  });

  const hasAny = fulfillments.length > 0;
  const status: SampleRequestStatus = hasAny
    ? row.status === "APPROVED" || row.status === "FULFILLING"
      ? "FULFILLING"
      : row.status
    : row.status;

  const updated = await sampleRequests.update({
    where: { id: row.id },
    data: {
      fulfillmentRaw: fulfillments as Prisma.InputJsonValue,
      status: row.status === "APPROVED" && hasAny ? "FULFILLING" : status,
      fulfilledAt:
        row.status === "FULFILLED" ||
        fulfillments.some((f) => {
          const s = String(
            (f as { status?: string }).status ?? "",
          ).toUpperCase();
          return s.includes("COMPLETE") || s.includes("DELIVER");
        })
          ? new Date()
          : row.fulfilledAt,
    },
    include: {
      creator: { select: { handle: true, displayName: true } },
      shop: { select: { displayName: true, region: true } },
    },
  });

  const complete = fulfillments.some((f) => {
    const s = String((f as { status?: string }).status ?? "").toUpperCase();
    return s.includes("COMPLETE") || s.includes("DELIVER");
  });
  if (complete && updated.status !== "FULFILLED") {
    const done = await sampleRequests.update({
      where: { id: row.id },
      data: { status: "FULFILLED", fulfilledAt: new Date() },
      include: {
        creator: { select: { handle: true, displayName: true } },
        shop: { select: { displayName: true, region: true } },
      },
    });
    return toSample(done);
  }

  return toSample(updated);
}
