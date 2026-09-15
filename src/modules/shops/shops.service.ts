import type { ShopRegion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { reserveBot } from "../bots/bots.service.js";

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
  botIdentityId: string;
  status: string;
  statusReason: string | null;
  displayName: string | null;
  externalShopId: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  botIdentity: { email: string };
}) {
  return {
    id: shop.id,
    organizationId: shop.organizationId,
    region: shop.region,
    botIdentityId: shop.botIdentityId,
    botEmail: shop.botIdentity.email,
    status: shop.status,
    statusReason: shop.statusReason,
    displayName: shop.displayName,
    externalShopId: shop.externalShopId,
    verifiedAt: shop.verifiedAt,
    createdAt: shop.createdAt,
    updatedAt: shop.updatedAt,
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

  const bot = await reserveBot(input.organizationId);

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

  const [updated] = await prisma.$transaction([
    prisma.shop.update({
      where: { id: shop.id },
      data: { status: "DISCONNECTED" },
      include: { botIdentity: true },
    }),
    prisma.botIdentity.update({
      where: { id: shop.botIdentityId },
      data: {
        status: "AVAILABLE",
        reservedForOrgId: null,
        reservedAt: null,
      },
    }),
  ]);

  return toShopResponse(updated);
}
