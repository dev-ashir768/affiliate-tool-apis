import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import {
  getShopOpenCollabCreatorsQueue,
  shopOpenCollabCreatorsQueue,
} from "../../lib/queue.js";
import {
  getOpenCollabCreatorContentDetails,
  searchOpenCollaborations,
} from "../../lib/tiktok-shop/client.js";
import { mapOpenCollabCreator } from "./open-collab-creator-map.js";
import { getShopOpenApiCredentials } from "./tiktok-oauth.service.js";

export const SHOP_COLLABORATORS_LIST_NAME = "Shop collaborators";
export const MAX_OPEN_COLLAB_PRODUCTS = 500;
export const MAX_UNIQUE_CREATORS = 10_000;

export type OpenCollabCreatorsSyncLimits = {
  maxProducts: number;
  maxCreators: number;
};

const DEFAULT_SYNC_LIMITS: OpenCollabCreatorsSyncLimits = {
  maxProducts: MAX_OPEN_COLLAB_PRODUCTS,
  maxCreators: MAX_UNIQUE_CREATORS,
};

export type OpenCollabCreatorsSyncStatus = {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  jobId?: string | null;
  productsScanned: number;
  creatorsUpserted: number;
  creatorsLinkedToList: number;
  failedProducts: number;
  lastError?: string | null;
  updatedAt: string;
};

type MappedCreator = NonNullable<ReturnType<typeof mapOpenCollabCreator>>;

type ShopSyncDelegate = {
  update(input: {
    where: { id: string; organizationId: string };
    data: { openCollabCreatorsSync: Prisma.InputJsonValue };
  }): Promise<unknown>;
  findFirst(input: {
    where: { id: string; organizationId: string };
    select: { openCollabCreatorsSync: true };
  }): Promise<{ openCollabCreatorsSync: Prisma.JsonValue | null } | null>;
};

// The worktree shares a generated client with its parent; keep the new JSON
// field isolated so concurrent `prisma generate` runs cannot break typechecks.
const shopSync = prisma.shop as unknown as ShopSyncDelegate;

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002"
  );
}

function statusJson(
  status: OpenCollabCreatorsSyncStatus,
): Prisma.InputJsonValue {
  return status as unknown as Prisma.InputJsonValue;
}

export async function persistSyncStatus(
  organizationId: string,
  shopId: string,
  status: OpenCollabCreatorsSyncStatus,
): Promise<void> {
  await shopSync.update({
    where: { id: shopId, organizationId },
    data: { openCollabCreatorsSync: statusJson(status) },
  });
}

export async function getOpenCollabCreatorsSyncStatus(
  organizationId: string,
  shopId: string,
): Promise<OpenCollabCreatorsSyncStatus | null> {
  const shop = await shopSync.findFirst({
    where: { id: shopId, organizationId },
    select: { openCollabCreatorsSync: true },
  });
  return (
    (shop?.openCollabCreatorsSync as OpenCollabCreatorsSyncStatus | null) ??
    null
  );
}

export type OpenCollabCreatorsSyncEnqueueResult = {
  jobId: string;
  status: "QUEUED" | "RUNNING";
  shopId: string;
};

export async function enqueueOpenCollabCreatorsSync(
  organizationId: string,
  shopId: string,
  triggeredBy?: string,
): Promise<OpenCollabCreatorsSyncEnqueueResult> {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, organizationId },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
  if (shop.status === "DISCONNECTED" || !shop.oauthConnectedAt) {
    throw new AppError(
      "SHOP_NOT_READY",
      "Shop has not completed TikTok OAuth",
      400,
    );
  }

  const jobId = `shop-open-collab-creators:${shopId}`;
  const existing = await getShopOpenCollabCreatorsQueue().getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed") {
      return {
        jobId,
        status: state === "active" ? "RUNNING" : "QUEUED",
        shopId,
      };
    }
    await existing.remove();
  }

  await shopOpenCollabCreatorsQueue.add(
    "sync",
    {
      organizationId,
      shopId,
      triggeredBy,
      requestedAt: new Date().toISOString(),
    },
    {
      jobId,
      removeOnComplete: 50,
      removeOnFail: 50,
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
    },
  );

  await persistSyncStatus(organizationId, shopId, {
    status: "QUEUED",
    jobId,
    productsScanned: 0,
    creatorsUpserted: 0,
    creatorsLinkedToList: 0,
    failedProducts: 0,
    updatedAt: new Date().toISOString(),
  });

  return { jobId, status: "QUEUED", shopId };
}

export async function runOpenCollabCreatorsSync(
  job: {
    organizationId: string;
    shopId: string;
  },
  limits: OpenCollabCreatorsSyncLimits = DEFAULT_SYNC_LIMITS,
): Promise<OpenCollabCreatorsSyncStatus> {
  const shop = await prisma.shop.findFirst({
    where: { id: job.shopId, organizationId: job.organizationId },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
  if (!shop.oauthConnectedAt) {
    throw new AppError(
      "SHOP_NOT_READY",
      "Shop has not completed TikTok OAuth",
      400,
    );
  }

  const runningStatus: OpenCollabCreatorsSyncStatus = {
    status: "RUNNING",
    productsScanned: 0,
    creatorsUpserted: 0,
    creatorsLinkedToList: 0,
    failedProducts: 0,
    updatedAt: new Date().toISOString(),
  };
  await persistSyncStatus(job.organizationId, job.shopId, runningStatus);

  const credentials = await getShopOpenApiCredentials(
    job.organizationId,
    job.shopId,
  );
  const productIds: string[] = [];
  const seenProductIds = new Set<string>();
  let productPageToken: string | null = null;
  let productCapHit = false;

  do {
    const page = await searchOpenCollaborations({
      credentials,
      pageSize: 100,
      pageToken: productPageToken,
    });
    for (const item of page.items) {
      if (seenProductIds.has(item.productId)) continue;
      if (productIds.length >= limits.maxProducts) {
        productCapHit = true;
        break;
      }
      seenProductIds.add(item.productId);
      productIds.push(item.productId);
    }
    productPageToken = page.nextPageToken;
    if (
      productIds.length >= limits.maxProducts &&
      productPageToken !== null
    ) {
      productCapHit = true;
    }
  } while (
    productPageToken !== null &&
    productIds.length < limits.maxProducts
  );

  const creators = new Map<string, MappedCreator>();
  let failedProducts = 0;
  let productsScanned = 0;
  let creatorCapHit = false;

  for (const productId of productIds) {
    productsScanned += 1;
    let creatorPageToken: string | null = null;
    try {
      do {
        const page = await getOpenCollabCreatorContentDetails({
          credentials,
          productId,
          pageSize: 100,
          pageToken: creatorPageToken,
        });
        for (const raw of page.creators) {
          const creator = mapOpenCollabCreator(raw);
          if (!creator) continue;
          const key =
            creator.creatorOpenId ?? creator.handle.toLowerCase();
          if (creators.has(key)) {
            creators.set(key, creator);
            continue;
          }
          if (creators.size >= limits.maxCreators) {
            creatorCapHit = true;
            continue;
          }
          creators.set(key, creator);
        }
        creatorPageToken = page.nextPageToken;
        if (
          creators.size >= limits.maxCreators &&
          creatorPageToken !== null
        ) {
          creatorCapHit = true;
          break;
        }
      } while (creatorPageToken !== null);
    } catch {
      failedProducts += 1;
    }
  }

  const listWhere = {
    organizationId_name: {
      organizationId: job.organizationId,
      name: SHOP_COLLABORATORS_LIST_NAME,
    },
  };
  let list = await prisma.creatorList.findUnique({
    where: listWhere,
  });
  if (!list) {
    try {
      list = await prisma.creatorList.create({
        data: {
          organizationId: job.organizationId,
          name: SHOP_COLLABORATORS_LIST_NAME,
        },
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      list = await prisma.creatorList.findUnique({
        where: listWhere,
      });
      if (!list) throw error;
    }
  }

  let creatorsUpserted = 0;
  let creatorsLinkedToList = 0;
  for (const creator of creators.values()) {
    const creatorWhere = {
      organizationId_platform_handle: {
        organizationId: job.organizationId,
        platform: "TIKTOK" as const,
        handle: creator.handle,
      },
    };
    let existing = await prisma.creator.findUnique({ where: creatorWhere });

    let creatorId: string;
    if (!existing) {
      try {
        const created = await prisma.creator.create({
          data: {
            organizationId: job.organizationId,
            platform: "TIKTOK",
            handle: creator.handle,
            displayName: creator.displayName,
            creatorOpenId: creator.creatorOpenId,
            followerCount: creator.followerCount,
            avatarUrl: creator.avatarUrl,
            stage: "ACTIVE",
          },
        });
        creatorId = created.id;
      } catch (error) {
        if (!isPrismaUniqueConstraintError(error)) throw error;
        existing = await prisma.creator.findUnique({
          where: creatorWhere,
        });
        if (!existing) throw error;
        creatorId = existing.id;
      }
    } else {
      creatorId = existing.id;
    }

    if (existing) {
      const data: Prisma.CreatorUpdateInput = {};
      if (creator.displayName !== null) data.displayName = creator.displayName;
      if (creator.creatorOpenId !== null)
        data.creatorOpenId = creator.creatorOpenId;
      if (creator.followerCount !== null)
        data.followerCount = creator.followerCount;
      if (creator.avatarUrl !== null) data.avatarUrl = creator.avatarUrl;
      const updated = await prisma.creator.update({
        where: { id: existing.id },
        data,
      });
      creatorId = updated.id;
    }
    creatorsUpserted += 1;

    try {
      await prisma.creatorListMember.create({
        data: { listId: list.id, creatorId },
      });
      creatorsLinkedToList += 1;
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
    }
  }

  const finalStatus: OpenCollabCreatorsSyncStatus = {
    status:
      failedProducts === 0 && !productCapHit && !creatorCapHit
        ? "SUCCEEDED"
        : "PARTIAL",
    productsScanned,
    creatorsUpserted,
    creatorsLinkedToList,
    failedProducts,
    updatedAt: new Date().toISOString(),
  };
  await persistSyncStatus(job.organizationId, job.shopId, finalStatus);
  return finalStatus;
}
