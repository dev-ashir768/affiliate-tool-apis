import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { env } from "../../config/env.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import {
  isRetryableTikTokError,
  mapTikTokOpenApiError,
  throwMappedTikTokError,
  type TikTokOpenApiErrorBody,
} from "./errors.js";

/**
 * Seller Affiliate — Search Creator on Marketplace (202508).
 * @see https://partner.tiktokshop.com/docv2/page/seller-search-creator-on-marketplace-202508
 * Scope: seller.creator_marketplace.read
 */
export const CREATOR_SEARCH_PATH =
  "/affiliate_seller/202508/marketplace_creators/search";

export const CREATOR_PERFORMANCE_PATH = (creatorOpenId: string) =>
  `/affiliate_seller/202508/marketplace_creators/${encodeURIComponent(creatorOpenId)}`;

/**
 * Seller Affiliate — Create Target Collaboration (invite creators).
 * @see https://partner.tiktokshop.com/docv2/page/create-target-collaboration-202508
 */
export const TARGET_COLLAB_CREATE_PATH =
  "/affiliate_seller/202508/target_collaborations";

export const TARGET_COLLAB_SEARCH_PATH =
  "/affiliate_seller/202508/target_collaborations/search";

export const TARGET_COLLAB_DETAIL_PATH = (id: string) =>
  `/affiliate_seller/202508/target_collaborations/${encodeURIComponent(id)}`;

/** Product catalog search (for invite product picker). */
export const PRODUCT_SEARCH_PATH = "/product/202502/products/search";

/** Affiliate seller IM (creator DMs). */
export const CONVERSATIONS_LIST_PATH = "/affiliate_seller/202505/conversations";
export const CONVERSATION_CREATE_PATH =
  "/affiliate_seller/202508/conversations";
export const CONVERSATION_MESSAGES_PATH = (conversationId: string) =>
  `/affiliate_seller/202412/conversation/${encodeURIComponent(conversationId)}/messages`;
export const CONVERSATION_SEND_PATH = (conversationId: string) =>
  `/affiliate_seller/202412/conversations/${encodeURIComponent(conversationId)}/messages`;
/** Official OpenAPI path has a typo: conversatons (missing 'a'). */
export const CONVERSATION_MARK_READ_PATH =
  "/affiliate_seller/202412/conversatons/read";
export const CONVERSATION_UNREAD_NEWEST_PATH =
  "/affiliate_seller/202412/conversations/messages/list/newest";

/**
 * Seller affiliate-attributed orders (creator GMV attribution).
 * @see https://partner.tiktokshop.com/docv2 (affiliate_seller orders search)
 */
export const AFFILIATE_ORDERS_SEARCH_PATH =
  "/affiliate_seller/202412/orders/search";

/** Shop order list (fulfillment / all shop orders). */
export const SHOP_ORDERS_SEARCH_PATH = "/order/202309/orders/search";

/** Free sample applications (approve / reject / fulfill). */
export const SAMPLE_APPLICATIONS_SEARCH_PATH =
  "/affiliate_seller/202508/sample_applications/search";
export const SAMPLE_APPLICATION_REVIEW_PATH = (applicationId: string) =>
  `/affiliate_seller/202507/sample_applications/${encodeURIComponent(applicationId)}/review`;
export const SAMPLE_FULFILLMENTS_SEARCH_PATH = (applicationId: string) =>
  `/affiliate_seller/202409/sample_applications/${encodeURIComponent(applicationId)}/fulfillments/search`;

/** Conservative pacing for standard read/sync APIs (concepts → Rate limits). */
const MIN_INTERVAL_MS = 350;
const MAX_ATTEMPTS = 4;

export type TikTokShopCredentials = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  shopCipher: string;
};

export type TikTokShopConfigStatus = {
  /** App key+secret present (OAuth + signing). */
  appConfigured: boolean;
  /** Legacy env token+cipher present (dev fallback only). */
  envTokenConfigured: boolean;
  /** True when either a shop OAuth or env tokens can run sync. Prefer shop. */
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
  avatar?: { url?: string | null } | null;
  gmv?: { amount?: string; currency?: string } | null;
  gmv_range?: { formatted_range?: string; currency?: string } | null;
  video_gmv?: { amount?: string; currency?: string } | null;
  live_gmv?: { amount?: string; currency?: string } | null;
  product_card_gmv?: { amount?: string; currency?: string } | null;
  gpm?: {
    amount?: string;
    currency?: string;
    formatted_range?: string;
    range?: string;
  } | null;
  avg_commission?: { formatted_range?: string; range?: string } | null;
  average_commission_rate?: { formatted_range?: string; range?: string } | null;
  units_sold?: number | string | null;
  items_sold?: number | string | null;
  bio?: string | null;
  bio_description?: string | null;
  email?: string | null;
  contact_email?: string | null;
  contact_info?: { email?: string | null } | null;
  /** Forward-compat: TikTok may add fields; we persist via metricsRaw. */
  [key: string]: unknown;
};

export type CreatorSearchResult = {
  creators: MarketplaceCreator[];
  nextPageToken: string | null;
  searchKey: string | null;
};

function appMissing(): string[] {
  const missing: string[] = [];
  if (!env.TIKTOK_SHOP_APP_KEY) missing.push("TIKTOK_SHOP_APP_KEY");
  if (!env.TIKTOK_SHOP_APP_SECRET) missing.push("TIKTOK_SHOP_APP_SECRET");
  return missing;
}

/** Platform .env token fallback (single-shop / ops). Prefer per-Shop OAuth. */
export function getPlatformEnvCredentials(): TikTokShopCredentials | null {
  if (
    !env.TIKTOK_SHOP_APP_KEY ||
    !env.TIKTOK_SHOP_APP_SECRET ||
    !env.TIKTOK_SHOP_ACCESS_TOKEN ||
    !env.TIKTOK_SHOP_CIPHER
  ) {
    return null;
  }
  return {
    appKey: env.TIKTOK_SHOP_APP_KEY,
    appSecret: env.TIKTOK_SHOP_APP_SECRET,
    accessToken: env.TIKTOK_SHOP_ACCESS_TOKEN,
    shopCipher: env.TIKTOK_SHOP_CIPHER,
  };
}

export function getTikTokShopConfigStatus(): TikTokShopConfigStatus {
  const missingApp = appMissing();
  const envCreds = getPlatformEnvCredentials();
  const appConfigured = missingApp.length === 0;
  return {
    appConfigured,
    envTokenConfigured: Boolean(envCreds),
    configured: Boolean(envCreds) || appConfigured,
    appKeySet: Boolean(env.TIKTOK_SHOP_APP_KEY),
    appSecretSet: Boolean(env.TIKTOK_SHOP_APP_SECRET),
    accessTokenSet: Boolean(env.TIKTOK_SHOP_ACCESS_TOKEN),
    shopCipherSet: Boolean(env.TIKTOK_SHOP_CIPHER),
    baseUrl: env.TIKTOK_SHOP_OPENAPI_BASE_URL,
    region: env.TIKTOK_SHOP_REGION,
    searchPath: CREATOR_SEARCH_PATH,
    missing: missingApp,
    note: appConfigured
      ? envCreds
        ? "App ready. Env fallback tokens set; prefer syncing with a shop that completed TikTok OAuth."
        : "App ready. Connect a shop via TikTok OAuth, then sync discovery with that shopId."
      : "Set TIKTOK_SHOP_APP_KEY + TIKTOK_SHOP_APP_SECRET, then authorize a merchant shop.",
  };
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

function parseRetryAfterSec(header: string | null): number | null {
  if (!header) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const when = Date.parse(header);
  if (!Number.isNaN(when)) {
    return Math.max(0, Math.ceil((when - Date.now()) / 1000));
  }
  return null;
}

function backoffMs(attempt: number, retryAfterSec: number | null): number {
  if (retryAfterSec != null && retryAfterSec > 0) {
    return retryAfterSec * 1000 + Math.floor(Math.random() * 250);
  }
  const base = Math.min(8_000, 500 * 2 ** attempt);
  return base + Math.floor(Math.random() * 400);
}

let lastRequestAt = 0;

async function paceRequests() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await delay(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

async function tikTokFetch<T>(
  path: string,
  options: {
    method: "GET" | "POST";
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    credentials: TikTokShopCredentials;
  },
): Promise<T> {
  const { credentials } = options;
  let lastBody: TikTokOpenApiErrorBody | null = null;
  let lastStatus = 0;
  let lastRetryAfter: number | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await paceRequests();

    const timestamp = String(Math.floor(Date.now() / 1000));
    const query: Record<string, string> = {
      app_key: credentials.appKey,
      timestamp,
      shop_cipher: credentials.shopCipher,
      ...(options.query ?? {}),
    };

    const bodyText =
      options.method === "POST" ? JSON.stringify(options.body ?? {}) : "";

    query.sign = signTikTokRequest({
      appSecret: credentials.appSecret,
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
        "x-tts-access-token": credentials.accessToken,
      },
      body: options.method === "POST" ? bodyText : undefined,
    });

    const json = (await res.json().catch(() => null)) as {
      code?: number;
      message?: string;
      data?: T;
      request_id?: string;
    } | null;

    lastStatus = res.status;
    lastBody = json;
    lastRetryAfter = parseRetryAfterSec(res.headers.get("retry-after"));

    if (res.ok && json && json.code === 0) {
      return json.data as T;
    }

    const mapped = mapTikTokOpenApiError({
      httpStatus: res.status,
      body: json,
      path,
    });

    const retryable = isRetryableTikTokError(mapped, json?.code);
    const canRetry = retryable && attempt < MAX_ATTEMPTS - 1;

    logger.error("tiktok openapi call failed", {
      path,
      status: res.status,
      code: json?.code,
      message: json?.message,
      requestId: json?.request_id,
      attempt: attempt + 1,
      retryable,
      retryAfterSec: lastRetryAfter,
    });

    if (canRetry) {
      const wait = backoffMs(attempt, lastRetryAfter);
      logger.info("tiktok openapi retrying", {
        path,
        waitMs: wait,
        attempt: attempt + 1,
      });
      await delay(wait);
      continue;
    }

    throwMappedTikTokError({
      httpStatus: res.status,
      body: json,
      path,
      retryAfterSec: lastRetryAfter,
    });
  }

  throwMappedTikTokError({
    httpStatus: lastStatus || 502,
    body: lastBody,
    path,
    retryAfterSec: lastRetryAfter,
  });
}

export async function searchMarketplaceCreators(input: {
  credentials: TikTokShopCredentials;
  pageSize?: 12 | 20;
  pageToken?: string | null;
  keyword?: string | null;
  searchKey?: string | null;
  minFollowers?: number | null;
  /** TikTok category ids when known (niche filter). */
  categoryIds?: string[] | null;
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
  if (input.categoryIds?.length) {
    body.category = input.categoryIds.map((id) => ({ id: String(id) }));
  }

  const data = await tikTokFetch<{
    creators?: MarketplaceCreator[];
    next_page_token?: string;
    search_key?: string;
  }>(CREATOR_SEARCH_PATH, {
    method: "POST",
    query,
    body,
    credentials: input.credentials,
  });

  return {
    creators: data?.creators ?? [],
    nextPageToken: data?.next_page_token || null,
    searchKey: data?.search_key || null,
  };
}

export type MarketplaceCreatorPerformance = {
  /** Normalized fields + raw TikTok creator object for persistence. */
  raw: Record<string, unknown>;
  username: string | null;
  nickname: string | null;
  followerCount: number | null;
  avatarUrl: string | null;
  gmvAmount: string | null;
  gmvCurrency: string | null;
  gmvRange: string | null;
  videoGmvAmount: string | null;
  liveGmvAmount: string | null;
  productCardGmvAmount: string | null;
  avgCommissionRange: string | null;
  unitsSold: number | null;
  gpmAmount: string | null;
  gpmCurrency: string | null;
  gpmRange: string | null;
  contactEmail: string | null;
  bio: string | null;
};

/**
 * GetMarketplaceCreatorPerformance — fresh followers/GMV for one creator open_id.
 * @see https://partner.tiktokshop.com/docv2/page/get-marketplace-creator-performance-202508
 */
export async function getMarketplaceCreatorPerformance(input: {
  credentials: TikTokShopCredentials;
  creatorOpenId: string;
}): Promise<MarketplaceCreatorPerformance> {
  const data = await tikTokFetch<{
    creator?: Record<string, unknown>;
  }>(CREATOR_PERFORMANCE_PATH(input.creatorOpenId), {
    method: "GET",
    credentials: input.credentials,
  });

  const c = data?.creator ?? {};
  const avatar = (c.avatar as { url?: string } | undefined)?.url ?? null;
  const gmv = c.gmv as { amount?: string; currency?: string } | undefined;
  const gmvRange = c.gmv_range as
    { formatted_range?: string; currency?: string } | undefined;
  const videoGmv = c.video_gmv as { amount?: string } | undefined;
  const liveGmv = c.live_gmv as { amount?: string } | undefined;
  const productCardGmv = (c.product_card_gmv ?? c.showcase_gmv) as
    { amount?: string } | undefined;
  const gpm = c.gpm as
    | {
        amount?: string;
        currency?: string;
        formatted_range?: string;
        range?: string;
      }
    | undefined;
  const avgCommission = (c.avg_commission ??
    c.average_commission_rate ??
    c.commission_rate) as
    | { formatted_range?: string; range?: string; min?: string; max?: string }
    | string
    | undefined;

  let avgCommissionRange: string | null = null;
  if (typeof avgCommission === "string") {
    avgCommissionRange = avgCommission.trim() || null;
  } else if (avgCommission?.formatted_range) {
    avgCommissionRange = avgCommission.formatted_range;
  } else if (avgCommission?.range) {
    avgCommissionRange = avgCommission.range;
  } else if (avgCommission?.min && avgCommission?.max) {
    avgCommissionRange = `${avgCommission.min}-${avgCommission.max}`;
  }

  const unitsRaw = c.units_sold ?? c.items_sold ?? c.sold_count;
  let unitsSold: number | null = null;
  if (typeof unitsRaw === "number" && Number.isFinite(unitsRaw)) {
    unitsSold = Math.round(unitsRaw);
  } else if (typeof unitsRaw === "string") {
    const n = Number(unitsRaw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) unitsSold = Math.round(n);
  }

  const contact =
    (typeof c.email === "string" && c.email) ||
    (typeof c.contact_email === "string" && c.contact_email) ||
    (typeof (c.contact_info as { email?: string } | undefined)?.email ===
      "string" &&
      (c.contact_info as { email?: string }).email) ||
    null;

  const bio =
    (typeof c.bio === "string" && c.bio) ||
    (typeof c.bio_description === "string" && c.bio_description) ||
    null;

  return {
    raw: c,
    username: typeof c.username === "string" ? c.username : null,
    nickname: typeof c.nickname === "string" ? c.nickname : null,
    followerCount:
      typeof c.follower_count === "number" ? c.follower_count : null,
    avatarUrl: avatar,
    gmvAmount: gmv?.amount ?? null,
    gmvCurrency: gmv?.currency ?? gmvRange?.currency ?? null,
    gmvRange: gmvRange?.formatted_range ?? null,
    videoGmvAmount: videoGmv?.amount ?? null,
    liveGmvAmount: liveGmv?.amount ?? null,
    productCardGmvAmount: productCardGmv?.amount ?? null,
    avgCommissionRange,
    unitsSold,
    gpmAmount: gpm?.amount ?? null,
    gpmCurrency: gpm?.currency ?? null,
    gpmRange: gpm?.formatted_range ?? gpm?.range ?? null,
    contactEmail: contact,
    bio,
  };
}

export type TargetCollabProductInput = {
  id: string;
  /** TikTok units: hundredths of a percent. 1000 = 10%. Min 1000. */
  targetCommissionRate: number;
  shopAdsCommissionRate?: number;
};

export type CreateTargetCollaborationInput = {
  credentials: TikTokShopCredentials;
  name: string;
  message?: string | null;
  /** Unix epoch seconds. */
  endTimeUnix: number;
  creatorOpenIds: string[];
  products: TargetCollabProductInput[];
  hasFreeSample?: boolean;
  sampleApprovalExempt?: boolean;
  sellerContactEmail?: string | null;
};

export type CreateTargetCollaborationResult = {
  targetCollaborationId: string | null;
  conflicts: Array<{
    creatorOpenId: string | null;
    productId: string | null;
  }>;
};

/**
 * Create a private target collaboration (affiliate invite) for up to 50 creators.
 */
export async function createTargetCollaboration(
  input: CreateTargetCollaborationInput,
): Promise<CreateTargetCollaborationResult> {
  if (input.creatorOpenIds.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "At least one creator open_id is required",
      400,
    );
  }
  if (input.creatorOpenIds.length > 50) {
    throw new AppError(
      "VALIDATION_ERROR",
      "TikTok allows max 50 creators per target collaboration",
      400,
    );
  }
  if (input.products.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "At least one product is required",
      400,
    );
  }
  if (input.products.length > 100) {
    throw new AppError(
      "VALIDATION_ERROR",
      "TikTok allows max 100 products per target collaboration",
      400,
    );
  }

  const body: Record<string, unknown> = {
    name: input.name.trim(),
    end_time: String(input.endTimeUnix),
    creator_user_open_ids: input.creatorOpenIds,
    products: input.products.map((p) => ({
      id: p.id,
      target_commission_rate: p.targetCommissionRate,
      ...(p.shopAdsCommissionRate != null
        ? { shop_ads_commission_rate: p.shopAdsCommissionRate }
        : {}),
    })),
    free_sample_rule: {
      has_free_sample: Boolean(input.hasFreeSample),
      is_sample_approval_exempt: Boolean(input.sampleApprovalExempt),
    },
  };
  if (input.message?.trim()) body.message = input.message.trim();
  if (input.sellerContactEmail?.trim()) {
    body.seller_contact_info = { email: input.sellerContactEmail.trim() };
  }

  const data = await tikTokFetch<{
    target_collaboration?: { id?: string };
    target_collaboration_conflicts?: Array<{
      creator_user_open_id?: string;
      product_id?: string;
    }>;
  }>(TARGET_COLLAB_CREATE_PATH, {
    method: "POST",
    body,
    credentials: input.credentials,
  });

  return {
    targetCollaborationId: data?.target_collaboration?.id ?? null,
    conflicts: (data?.target_collaboration_conflicts ?? []).map((c) => ({
      creatorOpenId: c.creator_user_open_id ?? null,
      productId: c.product_id ?? null,
    })),
  };
}

export type ShopProductSummary = {
  id: string;
  title: string | null;
  status: string | null;
};

export async function searchShopProducts(input: {
  credentials: TikTokShopCredentials;
  pageSize?: number;
  pageToken?: string | null;
  status?: string | null;
}): Promise<{ products: ShopProductSummary[]; nextPageToken: string | null }> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
  const query: Record<string, string> = {
    page_size: String(pageSize),
  };
  if (input.pageToken) query.page_token = input.pageToken;

  const body: Record<string, unknown> = {};
  if (input.status) {
    body.status = input.status;
  } else {
    body.status = "ACTIVATE";
  }

  const data = await tikTokFetch<{
    products?: Array<{
      id?: string;
      title?: string;
      status?: string;
    }>;
    next_page_token?: string;
  }>(PRODUCT_SEARCH_PATH, {
    method: "POST",
    query,
    body,
    credentials: input.credentials,
  });

  return {
    products: (data?.products ?? [])
      .filter((p) => p.id)
      .map((p) => ({
        id: String(p.id),
        title: p.title ?? null,
        status: p.status ?? null,
      })),
    nextPageToken: data?.next_page_token || null,
  };
}

export async function getTargetCollaborationDetail(input: {
  credentials: TikTokShopCredentials;
  targetCollaborationId: string;
}): Promise<Record<string, unknown>> {
  const data = await tikTokFetch<{
    target_collaboration?: Record<string, unknown>;
  }>(TARGET_COLLAB_DETAIL_PATH(input.targetCollaborationId), {
    method: "GET",
    credentials: input.credentials,
  });
  return data?.target_collaboration ?? {};
}

export type TikTokConversationSummary = {
  id: string;
  creatorImId: string | null;
  username: string | null;
  avatarUrl: string | null;
  unreadCount: number;
};

export async function listTikTokConversations(input: {
  credentials: TikTokShopCredentials;
  pageSize?: number;
  pageToken?: string | null;
  onlyNeedConversationId?: boolean;
}): Promise<{
  conversations: TikTokConversationSummary[];
  nextPageToken: string | null;
  hasMore: boolean;
}> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 50);
  const query: Record<string, string> = {
    page_size: String(pageSize),
    only_need_conversation_id: input.onlyNeedConversationId ? "true" : "false",
  };
  if (input.pageToken) query.page_token = input.pageToken;

  const data = await tikTokFetch<{
    conversations?: Array<{
      id?: string;
      creator_im_id?: string;
      username?: string;
      avatar?: string;
      unread_count?: number;
    }>;
    next_page_token?: string;
    has_more?: boolean;
  }>(CONVERSATIONS_LIST_PATH, {
    method: "GET",
    query,
    credentials: input.credentials,
  });

  return {
    conversations: (data?.conversations ?? [])
      .filter((c) => c.id)
      .map((c) => ({
        id: String(c.id),
        creatorImId: c.creator_im_id ?? null,
        username: c.username ?? null,
        avatarUrl: c.avatar ?? null,
        unreadCount: typeof c.unread_count === "number" ? c.unread_count : 0,
      })),
    nextPageToken: data?.next_page_token || null,
    hasMore: Boolean(data?.has_more),
  };
}

export async function createTikTokConversation(input: {
  credentials: TikTokShopCredentials;
  creatorOpenId: string;
}): Promise<{
  conversationId: string;
  creatorImId: string | null;
  username: string | null;
  avatarUrl: string | null;
  unreadCount: number;
  isNew: boolean;
}> {
  const data = await tikTokFetch<{
    conversation_id?: string;
    creator_im_id?: string;
    username?: string;
    avatar?: string;
    unread_count?: number;
    is_new?: boolean;
  }>(CONVERSATION_CREATE_PATH, {
    method: "POST",
    body: {
      creator_open_id: input.creatorOpenId,
      only_need_conversation_id: false,
    },
    credentials: input.credentials,
  });

  if (!data?.conversation_id) {
    throw new AppError(
      "BAD_GATEWAY",
      "TikTok did not return a conversation_id",
      502,
    );
  }

  return {
    conversationId: data.conversation_id,
    creatorImId: data.creator_im_id ?? null,
    username: data.username ?? null,
    avatarUrl: data.avatar ?? null,
    unreadCount: typeof data.unread_count === "number" ? data.unread_count : 0,
    isNew: Boolean(data.is_new),
  };
}

export type TikTokImMessage = {
  id: string | null;
  conversationId: string | null;
  conversationIndex: string | null;
  senderId: string | null;
  type: string | null;
  contentRaw: string | null;
  contentText: string | null;
  createTime: number | null;
};

function parseImContentText(type: string | null, contentRaw: string | null) {
  if (!contentRaw) return null;
  try {
    const parsed = JSON.parse(contentRaw) as Record<string, unknown>;
    if (typeof parsed.content === "string") return parsed.content;
    if (type === "PRODUCT_CARD" && parsed.product_id != null) {
      return `Product card: ${String(parsed.product_id)}`;
    }
    if (
      (type === "TARGET_COLLABORATION_CARD" ||
        type === "TARGET_INVITATION_CARD") &&
      (parsed.target_collaboration_id != null ||
        parsed.invitation_group_id != null)
    ) {
      return `Invite card: ${String(
        parsed.target_collaboration_id ?? parsed.invitation_group_id,
      )}`;
    }
    return contentRaw;
  } catch {
    return contentRaw;
  }
}

export async function listTikTokConversationMessages(input: {
  credentials: TikTokShopCredentials;
  conversationId: string;
  pageSize?: number;
  pageToken?: string | null;
}): Promise<{
  messages: TikTokImMessage[];
  nextPageToken: string | null;
  hasMore: boolean;
}> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 50);
  const query: Record<string, string> = {
    page_size: String(pageSize),
  };
  if (input.pageToken) query.page_token = input.pageToken;

  const data = await tikTokFetch<{
    messages?: Array<{
      conversation_index?: string;
      message_body?: {
        content?: string;
        conversation_id?: string;
        create_time?: number;
        id?: string;
        sender_id?: string;
        type?: string;
      };
    }>;
    next_page_token?: string;
    has_more?: boolean;
  }>(CONVERSATION_MESSAGES_PATH(input.conversationId), {
    method: "GET",
    query,
    credentials: input.credentials,
  });

  const messages = (data?.messages ?? []).map((m) => {
    const body = m.message_body ?? {};
    const type = body.type ?? null;
    const contentRaw = body.content ?? null;
    return {
      id: body.id ?? null,
      conversationId: body.conversation_id ?? input.conversationId,
      conversationIndex: m.conversation_index ?? null,
      senderId: body.sender_id ?? null,
      type,
      contentRaw,
      contentText: parseImContentText(type, contentRaw),
      createTime:
        typeof body.create_time === "number" ? body.create_time : null,
    };
  });

  return {
    messages,
    nextPageToken: data?.next_page_token || null,
    hasMore: Boolean(data?.has_more),
  };
}

export async function sendTikTokImMessage(input: {
  credentials: TikTokShopCredentials;
  conversationId: string;
  text: string;
}): Promise<{ messageId: string | null }> {
  const content = JSON.stringify({ content: input.text });
  const data = await tikTokFetch<{ message_id?: string }>(
    CONVERSATION_SEND_PATH(input.conversationId),
    {
      method: "POST",
      body: {
        msg_type: "TEXT",
        content,
      },
      credentials: input.credentials,
    },
  );
  return { messageId: data?.message_id ?? null };
}

export async function markTikTokConversationsRead(input: {
  credentials: TikTokShopCredentials;
  conversationIds: string[];
}): Promise<void> {
  if (input.conversationIds.length === 0) return;
  await tikTokFetch(CONVERSATION_MARK_READ_PATH, {
    method: "POST",
    body: {
      conversation_ids: input.conversationIds.slice(0, 20),
    },
    credentials: input.credentials,
  });
}

export async function listTikTokNewestUnread(input: {
  credentials: TikTokShopCredentials;
}): Promise<
  Array<{
    conversationId: string | null;
    senderId: string | null;
    type: string | null;
    contentText: string | null;
    unreadMessageCount: number;
  }>
> {
  const data = await tikTokFetch<{
    newest_message_list?: Array<{
      conversation_id?: string;
      sender_id?: string;
      type?: string;
      content?: string;
      unread_message_count?: number;
    }>;
  }>(CONVERSATION_UNREAD_NEWEST_PATH, {
    method: "GET",
    credentials: input.credentials,
  });

  return (data?.newest_message_list ?? []).map((m) => ({
    conversationId: m.conversation_id ?? null,
    senderId: m.sender_id ?? null,
    type: m.type ?? null,
    contentText: parseImContentText(m.type ?? null, m.content ?? null),
    unreadMessageCount:
      typeof m.unread_message_count === "number" ? m.unread_message_count : 0,
  }));
}

export type AffiliateOrderRow = {
  orderId: string;
  createTime: number | null;
  currency: string | null;
  gmvAmount: string | null;
  commissionAmount: string | null;
  creatorOpenId: string | null;
  creatorUsername: string | null;
  status: string | null;
  raw: Record<string, unknown>;
};

/**
 * Search affiliate-attributed orders for a seller shop.
 * Response shape varies by API generation — normalize defensively.
 */
export async function searchAffiliateOrders(input: {
  credentials: TikTokShopCredentials;
  pageSize?: number;
  pageToken?: string | null;
  createTimeGe?: number | null;
  createTimeLt?: number | null;
}): Promise<{
  orders: AffiliateOrderRow[];
  nextPageToken: string | null;
}> {
  const query: Record<string, string> = {
    page_size: String(Math.min(100, Math.max(1, input.pageSize ?? 50))),
  };
  if (input.pageToken) query.page_token = input.pageToken;

  const body: Record<string, unknown> = {};
  if (input.createTimeGe != null) body.create_time_ge = input.createTimeGe;
  if (input.createTimeLt != null) body.create_time_lt = input.createTimeLt;

  const data = await tikTokFetch<{
    orders?: Array<Record<string, unknown>>;
    order_list?: Array<Record<string, unknown>>;
    next_page_token?: string;
  }>(AFFILIATE_ORDERS_SEARCH_PATH, {
    method: "POST",
    query,
    body,
    credentials: input.credentials,
  });

  const list = data?.orders ?? data?.order_list ?? [];
  const orders: AffiliateOrderRow[] = list
    .map((row) => {
      const money =
        (row.price_detail as Record<string, unknown> | undefined) ??
        (row.payment as Record<string, unknown> | undefined) ??
        row;
      const creator =
        (row.creator as Record<string, unknown> | undefined) ??
        (row.affiliate as Record<string, unknown> | undefined) ??
        {};
      const gmv =
        money.gmv ??
        money.total_amount ??
        money.order_amount ??
        row.gmv ??
        row.total_amount;
      const commission =
        money.estimated_commission ??
        money.commission ??
        row.estimated_commission ??
        row.commission;
      const gmvRec =
        gmv && typeof gmv === "object"
          ? (gmv as Record<string, unknown>)
          : null;
      const commissionRec =
        commission && typeof commission === "object"
          ? (commission as Record<string, unknown>)
          : null;

      return {
        orderId: String(row.id ?? row.order_id ?? row.main_order_id ?? ""),
        createTime:
          typeof row.create_time === "number"
            ? row.create_time
            : typeof row.created_at === "number"
              ? row.created_at
              : null,
        currency:
          (gmvRec?.currency as string | undefined) ??
          (money.currency as string | undefined) ??
          (row.currency as string | undefined) ??
          null,
        gmvAmount:
          gmvRec?.amount != null
            ? String(gmvRec.amount)
            : gmv != null && typeof gmv !== "object"
              ? String(gmv)
              : null,
        commissionAmount:
          commissionRec?.amount != null
            ? String(commissionRec.amount)
            : commission != null && typeof commission !== "object"
              ? String(commission)
              : null,
        creatorOpenId:
          (creator.open_id as string | undefined) ??
          (creator.creator_open_id as string | undefined) ??
          (row.creator_open_id as string | undefined) ??
          null,
        creatorUsername:
          (creator.username as string | undefined) ??
          (creator.handle as string | undefined) ??
          (row.creator_username as string | undefined) ??
          null,
        status:
          (row.order_status as string | undefined) ??
          (row.status as string | undefined) ??
          null,
        raw: row,
      };
    })
    .filter((o) => o.orderId);

  return {
    orders,
    nextPageToken: data?.next_page_token || null,
  };
}

export type SampleApplicationRow = {
  applicationId: string;
  status: string | null;
  productId: string | null;
  productTitle: string | null;
  creatorOpenId: string | null;
  creatorUsername: string | null;
  createTime: number | null;
  raw: Record<string, unknown>;
};

export async function searchSampleApplications(input: {
  credentials: TikTokShopCredentials;
  pageSize?: number;
  pageToken?: string | null;
}): Promise<{
  applications: SampleApplicationRow[];
  nextPageToken: string | null;
}> {
  const query: Record<string, string> = {
    page_size: String(Math.min(50, Math.max(1, input.pageSize ?? 20))),
  };
  if (input.pageToken) query.page_token = input.pageToken;

  const data = await tikTokFetch<{
    sample_applications?: Array<Record<string, unknown>>;
    applications?: Array<Record<string, unknown>>;
    next_page_token?: string;
  }>(SAMPLE_APPLICATIONS_SEARCH_PATH, {
    method: "POST",
    query,
    body: {},
    credentials: input.credentials,
  });

  const list = data?.sample_applications ?? data?.applications ?? [];
  const applications: SampleApplicationRow[] = list
    .map((row) => {
      const creator =
        (row.creator as Record<string, unknown> | undefined) ??
        (row.creator_info as Record<string, unknown> | undefined) ??
        {};
      const product =
        (row.product as Record<string, unknown> | undefined) ??
        (row.product_info as Record<string, unknown> | undefined) ??
        {};
      const id = String(
        row.id ?? row.application_id ?? row.sample_application_id ?? "",
      );
      return {
        applicationId: id,
        status:
          (row.status as string | undefined) ??
          (row.application_status as string | undefined) ??
          null,
        productId:
          product.id != null
            ? String(product.id)
            : row.product_id != null
              ? String(row.product_id)
              : null,
        productTitle:
          (product.title as string | undefined) ??
          (product.name as string | undefined) ??
          (row.product_title as string | undefined) ??
          null,
        creatorOpenId:
          (creator.open_id as string | undefined) ??
          (creator.creator_open_id as string | undefined) ??
          (row.creator_open_id as string | undefined) ??
          null,
        creatorUsername:
          (creator.username as string | undefined) ??
          (creator.handle as string | undefined) ??
          (row.creator_username as string | undefined) ??
          null,
        createTime:
          typeof row.create_time === "number"
            ? row.create_time
            : typeof row.created_at === "number"
              ? row.created_at
              : null,
        raw: row,
      };
    })
    .filter((a) => a.applicationId);

  return {
    applications,
    nextPageToken: data?.next_page_token || null,
  };
}

export async function reviewSampleApplication(input: {
  credentials: TikTokShopCredentials;
  applicationId: string;
  /** approve | reject */
  reviewResult: "APPROVE" | "REJECT";
  reason?: string | null;
}): Promise<{ ok: true }> {
  await tikTokFetch(SAMPLE_APPLICATION_REVIEW_PATH(input.applicationId), {
    method: "POST",
    credentials: input.credentials,
    body: {
      review_result: input.reviewResult,
      ...(input.reason?.trim() ? { reject_reason: input.reason.trim() } : {}),
    },
  });
  return { ok: true };
}

export async function searchSampleFulfillments(input: {
  credentials: TikTokShopCredentials;
  applicationId: string;
}): Promise<{ fulfillments: Array<Record<string, unknown>> }> {
  const data = await tikTokFetch<{
    fulfillments?: Array<Record<string, unknown>>;
    fulfillment_list?: Array<Record<string, unknown>>;
  }>(SAMPLE_FULFILLMENTS_SEARCH_PATH(input.applicationId), {
    method: "POST",
    credentials: input.credentials,
    body: {},
  });
  return {
    fulfillments: data?.fulfillments ?? data?.fulfillment_list ?? [],
  };
}
