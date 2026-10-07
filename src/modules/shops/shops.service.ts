import type { ShopRegion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { searchShopProducts } from "../../lib/tiktok-shop/client.js";
import { allocateBotForShop } from "../bots/bots.service.js";
import { getShopOpenApiCredentials } from "./tiktok-oauth.service.js";
import { listRecentBotMail } from "../../lib/bot-inbox.js";
import { logger } from "../../lib/logger.js";

async function countActiveShops(organizationId: string): Promise<number> {
  return prisma.shop.count({
    where: {
      organizationId,
      status: { not: "DISCONNECTED" },
    },
  });
}

function toShopResponse(shop: {
  id: string;
  organizationId: string;
  region: ShopRegion;
  botIdentityId: string | null;
  status: string;
  statusReason: string | null;
  displayName: string | null;
  externalShopId: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  botIdentity: {
    email: string;
    ownerOrganizationId?: string | null;
    sessionCapturedAt?: Date | null;
  } | null;
  oauthConnectedAt?: Date | null;
  tiktokGrantedScopes?: string[];
  tiktokAccessExpiresAt?: Date | null;
}) {
  return {
    id: shop.id,
    organizationId: shop.organizationId,
    region: shop.region,
    botIdentityId: shop.botIdentityId,
    botEmail: shop.botIdentity?.email ?? null,
    botSelfServe: Boolean(shop.botIdentity?.ownerOrganizationId),
    botActivatedAt: shop.botIdentity?.sessionCapturedAt?.toISOString() ?? null,
    status: shop.status,
    statusReason: shop.statusReason,
    displayName: shop.displayName,
    externalShopId: shop.externalShopId,
    verifiedAt: shop.verifiedAt,
    createdAt: shop.createdAt,
    updatedAt: shop.updatedAt,
    oauthConnected: Boolean(shop.oauthConnectedAt),
    oauthScopes: shop.tiktokGrantedScopes ?? [],
    oauthAccessExpiresAt: shop.tiktokAccessExpiresAt?.toISOString() ?? null,
  };
}

export async function connectShop(input: {
  organizationId: string;
  region: ShopRegion;
}) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
  });

  const activeCount = await countActiveShops(input.organizationId);
  if (activeCount >= org.shopLimit) {
    throw new AppError("PLAN_LIMIT", "Shop limit reached", 403);
  }

  const bot = await allocateBotForShop(input.organizationId);

  try {
    const shop = await prisma.shop.create({
      data: {
        organizationId: input.organizationId,
        region: input.region,
        botIdentityId: bot.id,
        status: "PENDING_INVITE",
      },
      include: { botIdentity: true },
    });
    return toShopResponse(shop);
  } catch (err) {
    await prisma.botIdentity.update({
      where: { id: bot.id },
      data: {
        status: "AVAILABLE",
        reservedForOrgId: null,
        reservedAt: null,
      },
    });
    throw err;
  }
}

export async function listShops(organizationId: string) {
  const shops = await prisma.shop.findMany({
    where: { organizationId },
    include: { botIdentity: true },
    orderBy: { createdAt: "asc" },
  });
  return shops.map(toShopResponse);
}

export async function getShop(organizationId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, organizationId },
    include: { botIdentity: true },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
  return toShopResponse(shop);
}

export async function disconnectShop(organizationId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, organizationId },
    include: { botIdentity: true },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);

  if (shop.status === "DISCONNECTED") {
    return toShopResponse(shop);
  }

  const botId = shop.botIdentityId;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.shop.update({
      where: { id: shop.id },
      data: {
        status: "DISCONNECTED",
        botIdentityId: null,
        tiktokOpenId: null,
        tiktokAccessTokenEnc: null,
        tiktokRefreshTokenEnc: null,
        tiktokShopCipherEnc: null,
        tiktokAccessExpiresAt: null,
        tiktokRefreshExpiresAt: null,
        tiktokGrantedScopes: [],
        oauthConnectedAt: null,
        statusReason: "Disconnected",
      },
      include: { botIdentity: true },
    });

    if (botId) {
      await tx.botIdentity.update({
        where: { id: botId },
        data: {
          status: "AVAILABLE",
          reservedForOrgId: null,
          reservedAt: null,
        },
      });
    }

    return next;
  });

  return toShopResponse(updated);
}

/** Live TikTok Shop catalog (read-only). Used by Products page and invite pickers. */
export async function listShopProducts(
  organizationId: string,
  input: {
    shopId: string;
    pageSize?: number;
    pageToken?: string | null;
    status?: string | null;
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
  return searchShopProducts({
    credentials,
    pageSize: input.pageSize,
    pageToken: input.pageToken,
    status: input.status ?? "ACTIVATE",
  });
}

/** Verification mail for an organization's own self-serve bot (codes for TikTok sign-up). */
export async function getShopBotInbox(organizationId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, organizationId },
    include: { botIdentity: true },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
  const bot = shop.botIdentity;
  if (!bot || bot.ownerOrganizationId !== organizationId) {
    throw new AppError("NOT_FOUND", "This shop has no bot inbox", 404);
  }
  try {
    const messages = await listRecentBotMail(bot.email);
    return { botEmail: bot.email, messages };
  } catch (err) {
    logger.error("bot inbox read failed", {
      shopId,
      err: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Couldn't check the bot inbox right now. Try again in a minute.",
      503,
    );
  }
}
