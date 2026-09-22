import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import type { ShopRegion } from "@prisma/client";

const AUTHORIZED_SHOPS_PATH = "/authorization/202309/shops";

export type TikTokTokenPayload = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpireIn: number;
  refreshTokenExpireIn: number;
  openId: string;
  sellerName: string | null;
  sellerBaseRegion: string | null;
  userType: number | null;
  grantedScopes: string[];
};

export type AuthorizedShop = {
  id: string;
  name: string | null;
  cipher: string;
  region: string | null;
};

type OAuthStatePayload = {
  orgId: string;
  shopId: string;
  userId: string;
  exp: number;
};

function appCredentials() {
  if (!env.TIKTOK_SHOP_APP_KEY || !env.TIKTOK_SHOP_APP_SECRET) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "TikTok app not configured: set TIKTOK_SHOP_APP_KEY and TIKTOK_SHOP_APP_SECRET",
      400,
    );
  }
  return {
    appKey: env.TIKTOK_SHOP_APP_KEY,
    appSecret: env.TIKTOK_SHOP_APP_SECRET,
  };
}

function stateSecret() {
  return env.JWT_ACCESS_SECRET;
}

export function signOAuthState(payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload {
  const [body, sig] = state.split(".");
  if (!body || !sig) {
    throw new AppError("VALIDATION_ERROR", "Invalid OAuth state", 400);
  }
  const expected = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError("VALIDATION_ERROR", "Invalid OAuth state signature", 400);
  }
  const parsed = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  ) as OAuthStatePayload;
  if (!parsed.orgId || !parsed.shopId || !parsed.userId || !parsed.exp) {
    throw new AppError("VALIDATION_ERROR", "Malformed OAuth state", 400);
  }
  if (parsed.exp < Date.now()) {
    throw new AppError("VALIDATION_ERROR", "OAuth state expired; start again", 400);
  }
  return parsed;
}

export function buildAuthorizeUrl(input: {
  region: ShopRegion;
  state: string;
}): string {
  appCredentials();
  const base =
    input.region === "US"
      ? env.TIKTOK_SHOP_AUTHORIZE_URL_US
      : env.TIKTOK_SHOP_AUTHORIZE_URL_UK;
  const serviceId = env.TIKTOK_SHOP_SERVICE_ID || env.TIKTOK_SHOP_APP_KEY!;
  const url = new URL(base);
  url.searchParams.set("service_id", serviceId);
  url.searchParams.set("state", input.state);
  if (env.TIKTOK_SHOP_REDIRECT_URI) {
    url.searchParams.set("redirect_uri", env.TIKTOK_SHOP_REDIRECT_URI);
  }
  return url.toString();
}

async function tokenGet(query: Record<string, string>): Promise<TikTokTokenPayload> {
  const { appKey, appSecret } = appCredentials();
  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    ...query,
  });
  const res = await fetch(`${env.TIKTOK_SHOP_TOKEN_URL}?${qs}`);
  const json = (await res.json().catch(() => null)) as {
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      refresh_token?: string;
      access_token_expire_in?: number;
      refresh_token_expire_in?: number;
      open_id?: string;
      seller_name?: string;
      seller_base_region?: string;
      user_type?: number;
      granted_scopes?: string[];
    };
  } | null;

  if (!res.ok || !json || json.code !== 0 || !json.data?.access_token) {
    logger.error("tiktok oauth token exchange failed", {
      status: res.status,
      code: json?.code,
      message: json?.message,
    });
    throw new AppError(
      "BAD_GATEWAY",
      json?.message ?? "TikTok token exchange failed",
      502,
      { provider: "tiktok_shop", tiktokCode: json?.code ?? null },
    );
  }

  const d = json.data;
  return {
    accessToken: d.access_token!,
    refreshToken: d.refresh_token ?? "",
    accessTokenExpireIn: d.access_token_expire_in ?? 0,
    refreshTokenExpireIn: d.refresh_token_expire_in ?? 0,
    openId: d.open_id ?? "",
    sellerName: d.seller_name ?? null,
    sellerBaseRegion: d.seller_base_region ?? null,
    userType: d.user_type ?? null,
    grantedScopes: d.granted_scopes ?? [],
  };
}

export async function exchangeAuthCode(authCode: string) {
  return tokenGet({
    auth_code: authCode,
    grant_type: "authorized_code",
  });
}

export async function refreshAccessToken(refreshToken: string) {
  const { appKey, appSecret } = appCredentials();
  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${env.TIKTOK_SHOP_REFRESH_URL}?${qs}`);
  const json = (await res.json().catch(() => null)) as {
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      refresh_token?: string;
      access_token_expire_in?: number;
      refresh_token_expire_in?: number;
      open_id?: string;
      seller_name?: string;
      seller_base_region?: string;
      user_type?: number;
      granted_scopes?: string[];
    };
  } | null;

  if (!res.ok || !json || json.code !== 0 || !json.data?.access_token) {
    throw new AppError(
      "UNAUTHORIZED",
      json?.message ?? "TikTok token refresh failed; re-authorize the shop",
      401,
      { provider: "tiktok_shop", tiktokCode: json?.code ?? null },
    );
  }

  const d = json.data;
  return {
    accessToken: d.access_token!,
    refreshToken: d.refresh_token ?? refreshToken,
    accessTokenExpireIn: d.access_token_expire_in ?? 0,
    refreshTokenExpireIn: d.refresh_token_expire_in ?? 0,
    openId: d.open_id ?? "",
    sellerName: d.seller_name ?? null,
    sellerBaseRegion: d.seller_base_region ?? null,
    userType: d.user_type ?? null,
    grantedScopes: d.granted_scopes ?? [],
  } satisfies TikTokTokenPayload;
}

/**
 * GET authorized shops for the seller access token.
 * @see Partner Center Authorization → Get Authorized Shops
 */
export async function fetchAuthorizedShops(
  accessToken: string,
): Promise<AuthorizedShop[]> {
  const { appKey, appSecret } = appCredentials();
  const { signTikTokRequest } = await import("./client.js");

  const path = AUTHORIZED_SHOPS_PATH;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const query: Record<string, string> = {
    app_key: appKey,
    timestamp,
  };
  query.sign = signTikTokRequest({
    appSecret,
    path,
    query,
    body: "",
  });

  const url = `${env.TIKTOK_SHOP_OPENAPI_BASE_URL}${path}?${new URLSearchParams(query)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-tts-access-token": accessToken,
    },
  });
  const json = (await res.json().catch(() => null)) as {
    code?: number;
    message?: string;
    data?: {
      shops?: Array<{
        id?: string;
        name?: string;
        cipher?: string;
        region?: string;
        code?: string;
      }>;
    };
  } | null;

  if (!res.ok || !json || json.code !== 0) {
    throw new AppError(
      "BAD_GATEWAY",
      json?.message ?? "Failed to load authorized TikTok shops",
      502,
      { provider: "tiktok_shop", tiktokCode: json?.code ?? null },
    );
  }

  return (json.data?.shops ?? [])
    .filter((s) => s.cipher && (s.id || s.code))
    .map((s) => ({
      id: String(s.id ?? s.code),
      name: s.name ?? null,
      cipher: s.cipher!,
      region: s.region ?? null,
    }));
}

export function oauthAppConfigured(): boolean {
  return Boolean(env.TIKTOK_SHOP_APP_KEY && env.TIKTOK_SHOP_APP_SECRET);
}
