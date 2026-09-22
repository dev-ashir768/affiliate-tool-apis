import { createHmac } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";

const CREATOR_SEARCH_PATH =
  "/affiliate_seller/202508/marketplace_creators/search";

export type TikTokShopConfigStatus = {
  configured: boolean;
  appKeySet: boolean;
  appSecretSet: boolean;
  accessTokenSet: boolean;
  shopCipherSet: boolean;
  baseUrl: string;
  region: string;
  searchPath: string;
  missing: string[];
  note: string;
};

export type MarketplaceCreator = {
  username: string;
  nickname?: string | null;
  follower_count?: number | null;
  category_ids?: string[];
  selection_region?: string | null;
  creator_open_id?: string | null;
  gmv?: { amount?: string; currency?: string } | null;
  gmv_range?: { formatted_range?: string } | null;
};

export type CreatorSearchResult = {
  creators: MarketplaceCreator[];
  nextPageToken: string | null;
  searchKey: string | null;
};

function requiredMissing(): string[] {
  const missing: string[] = [];
  if (!env.TIKTOK_SHOP_APP_KEY) missing.push("TIKTOK_SHOP_APP_KEY");
  if (!env.TIKTOK_SHOP_APP_SECRET) missing.push("TIKTOK_SHOP_APP_SECRET");
  if (!env.TIKTOK_SHOP_ACCESS_TOKEN) missing.push("TIKTOK_SHOP_ACCESS_TOKEN");
  if (!env.TIKTOK_SHOP_CIPHER) missing.push("TIKTOK_SHOP_CIPHER");
  return missing;
}

export function getTikTokShopConfigStatus(): TikTokShopConfigStatus {
  const missing = requiredMissing();
  return {
    configured: missing.length === 0,
    appKeySet: Boolean(env.TIKTOK_SHOP_APP_KEY),
    appSecretSet: Boolean(env.TIKTOK_SHOP_APP_SECRET),
    accessTokenSet: Boolean(env.TIKTOK_SHOP_ACCESS_TOKEN),
    shopCipherSet: Boolean(env.TIKTOK_SHOP_CIPHER),
    baseUrl: env.TIKTOK_SHOP_OPENAPI_BASE_URL,
    region: env.TIKTOK_SHOP_REGION,
    searchPath: CREATOR_SEARCH_PATH,
    missing,
    note:
      missing.length === 0
        ? "OpenAPI credentials ready. Sync uses Seller Affiliate marketplace search (requires seller.creator_marketplace.read + shop authorization)."
        : "Set missing env vars from Partner Center app credentials + seller OAuth (access token + shop_cipher from Get Authorized Shops).",
  };
}

function assertConfigured() {
  const missing = requiredMissing();
  if (missing.length) {
    throw new AppError(
      "FAILED_PRECONDITION",
      `TikTok Shop OpenAPI not configured: missing ${missing.join(", ")}`,
      400,
    );
  }
}

/**
 * TikTok Shop OpenAPI request signature.
 * @see https://partner.tiktokshop.com/docv2/page/sign-your-api-request
 */
export function signTikTokRequest(input: {
  appSecret: string;
  path: string;
  query: Record<string, string>;
  body: string;
}): string {
  const filtered = Object.entries(input.query)
    .filter(([k]) => k !== "sign" && k !== "access_token")
    .sort(([a], [b]) => a.localeCompare(b));

  let payload = input.appSecret + input.path;
  for (const [k, v] of filtered) {
    payload += k + v;
  }
  if (input.body) payload += input.body;
  payload += input.appSecret;

  return createHmac("sha256", input.appSecret).update(payload).digest("hex");
}

async function tikTokFetch<T>(
  path: string,
  options: {
    method: "GET" | "POST";
    query?: Record<string, string>;
    body?: Record<string, unknown>;
  },
): Promise<T> {
  assertConfigured();

  const timestamp = String(Math.floor(Date.now() / 1000));
  const query: Record<string, string> = {
    app_key: env.TIKTOK_SHOP_APP_KEY!,
    timestamp,
    shop_cipher: env.TIKTOK_SHOP_CIPHER!,
    ...(options.query ?? {}),
  };

  const bodyText =
    options.method === "POST" ? JSON.stringify(options.body ?? {}) : "";

  query.sign = signTikTokRequest({
    appSecret: env.TIKTOK_SHOP_APP_SECRET!,
    path,
    query,
    body: bodyText,
  });

  const qs = new URLSearchParams(query).toString();
  const url = `${env.TIKTOK_SHOP_OPENAPI_BASE_URL}${path}?${qs}`;

  const res = await fetch(url, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      "x-tts-access-token": env.TIKTOK_SHOP_ACCESS_TOKEN!,
    },
    body: options.method === "POST" ? bodyText : undefined,
  });

  const json = (await res.json().catch(() => null)) as {
    code?: number;
    message?: string;
    data?: T;
    request_id?: string;
  } | null;

  if (!res.ok || !json || json.code !== 0) {
    logger.error("tiktok openapi call failed", {
      path,
      status: res.status,
      code: json?.code,
      message: json?.message,
      requestId: json?.request_id,
    });
    throw new AppError(
      "BAD_GATEWAY",
      json?.message ?? `TikTok OpenAPI error (${res.status})`,
      502,
    );
  }

  return json.data as T;
}

export async function searchMarketplaceCreators(input: {
  pageSize?: 12 | 20;
  pageToken?: string | null;
  keyword?: string | null;
  searchKey?: string | null;
  minFollowers?: number | null;
}): Promise<CreatorSearchResult> {
  const pageSize = input.pageSize === 12 ? 12 : 20;
  const query: Record<string, string> = {
    page_size: String(pageSize),
  };
  if (input.pageToken) query.page_token = input.pageToken;

  const body: Record<string, unknown> = {};
  if (input.keyword?.trim()) body.keyword = input.keyword.trim();
  if (input.searchKey) body.search_key = input.searchKey;
  if (input.minFollowers != null && input.minFollowers > 0) {
    body.follower_demographics = {
      count_range: { count_ge: input.minFollowers },
    };
  }

  const data = await tikTokFetch<{
    creators?: MarketplaceCreator[];
    next_page_token?: string;
    search_key?: string;
  }>(CREATOR_SEARCH_PATH, {
    method: "POST",
    query,
    body,
  });

  return {
    creators: data?.creators ?? [],
    nextPageToken: data?.next_page_token || null,
    searchKey: data?.search_key || null,
  };
}
