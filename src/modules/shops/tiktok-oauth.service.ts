import type { ShopRegion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { encryptVault, decryptVault } from "../../lib/crypto.js";
import { writeAuditLog } from "../../lib/audit.js";
import { env } from "../../config/env.js";
import {
  buildAuthorizeUrl,
  exchangeAuthCode,
  fetchAuthorizedShops,
  oauthAppConfigured,
  refreshAccessToken,
  signOAuthState,
  verifyOAuthState,
} from "../../lib/tiktok-shop/oauth.js";

const STATE_TTL_MS = 15 * 60 * 1000;

async function countActiveShops(organizationId: string): Promise<number> {
  return prisma.shop.count({
    where: {
      organizationId,
      status: { not: "DISCONNECTED" },
    },
  });
}

function toShopOauthFields(shop: {
  oauthConnectedAt: Date | null;
  tiktokGrantedScopes: string[];
  tiktokAccessExpiresAt: Date | null;
  displayName: string | null;
  externalShopId: string | null;
}) {
  return {
    oauthConnected: Boolean(shop.oauthConnectedAt),
    oauthScopes: shop.tiktokGrantedScopes,
    oauthAccessExpiresAt: shop.tiktokAccessExpiresAt?.toISOString() ?? null,
  };
}

/** Start seller OAuth — creates a shop row if shopId omitted. */
export async function startTikTokShopOAuth(input: {
  organizationId: string;
  userId: string;
  region: ShopRegion;
  shopId?: string | null;
}) {
  if (!oauthAppConfigured()) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Set TIKTOK_SHOP_APP_KEY and TIKTOK_SHOP_APP_SECRET in API env",
      400,
    );
  }
  if (!env.TIKTOK_SHOP_REDIRECT_URI) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Set TIKTOK_SHOP_REDIRECT_URI to your portal callback (e.g. http://localhost:3000/shops/tiktok/callback)",
      400,
    );
  }

  let shopId = input.shopId ?? null;

  if (shopId) {
    const existing = await prisma.shop.findFirst({
      where: { id: shopId, organizationId: input.organizationId },
    });
    if (!existing) throw new AppError("NOT_FOUND", "Shop not found", 404);
    if (existing.status === "DISCONNECTED") {
      throw new AppError(
        "FAILED_PRECONDITION",
        "Reconnect a disconnected shop by creating a new shop connection",
        400,
      );
    }
  } else {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
    });
    const activeCount = await countActiveShops(input.organizationId);
    if (activeCount >= org.shopLimit) {
      throw new AppError("PLAN_LIMIT", "Shop limit reached", 403);
    }
    const shop = await prisma.shop.create({
      data: {
        organizationId: input.organizationId,
        region: input.region,
        status: "PENDING_INVITE",
        statusReason: "Awaiting TikTok Shop OAuth authorization",
      },
    });
    shopId = shop.id;
  }

  const state = signOAuthState({
    orgId: input.organizationId,
    shopId,
    userId: input.userId,
    exp: Date.now() + STATE_TTL_MS,
  });

  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const authorizeUrl = buildAuthorizeUrl({
    region: shop.region,
    state,
  });

  return { shopId, authorizeUrl, state };
}

export async function completeTikTokShopOAuth(input: {
  code: string;
  state: string;
}) {
  const parsed = verifyOAuthState(input.state);
  const shop = await prisma.shop.findFirst({
    where: { id: parsed.shopId, organizationId: parsed.orgId },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found for OAuth state", 404);

  const token = await exchangeAuthCode(input.code);
  if (token.userType != null && token.userType !== 0) {
    throw new AppError(
      "FORBIDDEN",
      `TikTok token user_type=${token.userType} is not a seller token (expected 0)`,
      403,
    );
  }

  const authorized = await fetchAuthorizedShops(token.accessToken);
  if (!authorized.length) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "No authorized shops returned. Confirm the seller completed authorization.",
      400,
    );
  }

  // Prefer shop matching region; else first.
  const regionHint = shop.region === "UK" ? "GB" : shop.region;
  const picked =
    authorized.find(
      (s) =>
        s.region?.toUpperCase() === shop.region ||
        s.region?.toUpperCase() === regionHint,
    ) ?? authorized[0];

  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: {
      externalShopId: picked.id,
      displayName: picked.name ?? token.sellerName ?? shop.displayName,
      tiktokOpenId: token.openId || null,
      tiktokAccessTokenEnc: encryptVault(token.accessToken),
      tiktokRefreshTokenEnc: token.refreshToken
        ? encryptVault(token.refreshToken)
        : null,
      tiktokShopCipherEnc: encryptVault(picked.cipher),
      tiktokAccessExpiresAt: token.accessTokenExpireIn
        ? new Date(token.accessTokenExpireIn * 1000)
        : null,
      tiktokRefreshExpiresAt: token.refreshTokenExpireIn
        ? new Date(token.refreshTokenExpireIn * 1000)
        : null,
      tiktokGrantedScopes: token.grantedScopes,
      oauthConnectedAt: new Date(),
      status: "ACTIVE",
      statusReason: null,
      verifiedAt: new Date(),
    },
    include: { botIdentity: true },
  });

  await writeAuditLog({
    actorUserId: parsed.userId,
    action: "shop.tiktok.oauth.connected",
    entityType: "Shop",
    entityId: shop.id,
    meta: {
      externalShopId: picked.id,
      scopes: token.grantedScopes,
      sellerName: token.sellerName,
    },
  });

  return {
    id: updated.id,
    organizationId: updated.organizationId,
    region: updated.region,
    botIdentityId: updated.botIdentityId,
    botEmail: updated.botIdentity?.email ?? null,
    status: updated.status,
    statusReason: updated.statusReason,
    displayName: updated.displayName,
    externalShopId: updated.externalShopId,
    verifiedAt: updated.verifiedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    ...toShopOauthFields(updated),
  };
}

export type ShopOpenApiCredentials = {
  accessToken: string;
  shopCipher: string;
  appKey: string;
  appSecret: string;
};

/** Resolve live OpenAPI credentials for a shop (refresh if near expiry). */
export async function getShopOpenApiCredentials(
  organizationId: string,
  shopId: string,
): Promise<ShopOpenApiCredentials> {
  if (!env.TIKTOK_SHOP_APP_KEY || !env.TIKTOK_SHOP_APP_SECRET) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "TikTok app key/secret not configured",
      400,
    );
  }

  const shop = await prisma.shop.findFirst({
    where: { id: shopId, organizationId },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
  if (!shop.tiktokAccessTokenEnc || !shop.tiktokShopCipherEnc) {
    throw new AppError(
      "SHOP_NOT_READY",
      "Shop has no TikTok OAuth tokens. Complete Authorize TikTok first.",
      400,
    );
  }

  let accessToken = decryptVault(shop.tiktokAccessTokenEnc);
  const shopCipher = decryptVault(shop.tiktokShopCipherEnc);
  const refreshEnc = shop.tiktokRefreshTokenEnc;

  const expiresSoon =
    shop.tiktokAccessExpiresAt != null &&
    shop.tiktokAccessExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;

  if (expiresSoon && refreshEnc) {
    const refreshed = await refreshAccessToken(decryptVault(refreshEnc));
    accessToken = refreshed.accessToken;
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        tiktokAccessTokenEnc: encryptVault(refreshed.accessToken),
        tiktokRefreshTokenEnc: refreshed.refreshToken
          ? encryptVault(refreshed.refreshToken)
          : shop.tiktokRefreshTokenEnc,
        tiktokAccessExpiresAt: refreshed.accessTokenExpireIn
          ? new Date(refreshed.accessTokenExpireIn * 1000)
          : null,
        tiktokRefreshExpiresAt: refreshed.refreshTokenExpireIn
          ? new Date(refreshed.refreshTokenExpireIn * 1000)
          : null,
        tiktokGrantedScopes: refreshed.grantedScopes.length
          ? refreshed.grantedScopes
          : undefined,
      },
    });
  }

  return {
    accessToken,
    shopCipher,
    appKey: env.TIKTOK_SHOP_APP_KEY,
    appSecret: env.TIKTOK_SHOP_APP_SECRET,
  };
}

export function getTikTokOAuthStatus() {
  return {
    appKeySet: Boolean(env.TIKTOK_SHOP_APP_KEY),
    appSecretSet: Boolean(env.TIKTOK_SHOP_APP_SECRET),
    redirectUriSet: Boolean(env.TIKTOK_SHOP_REDIRECT_URI),
    serviceId: env.TIKTOK_SHOP_SERVICE_ID || env.TIKTOK_SHOP_APP_KEY || null,
    configured: oauthAppConfigured() && Boolean(env.TIKTOK_SHOP_REDIRECT_URI),
    redirectUri: env.TIKTOK_SHOP_REDIRECT_URI ?? null,
  };
}
