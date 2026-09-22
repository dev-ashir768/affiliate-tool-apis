/**
 * Shared marketplace metrics mapping + DB upsert helpers.
 * Discovery sync and CRM refresh both use this so followers/GMV stay consistent.
 *
 * Only maps fields the official Seller Marketplace APIs may return.
 * Extra unknown keys are preserved in metricsRaw for forward compatibility.
 */

import type { Prisma } from "@prisma/client";

export type MarketplaceMetrics = {
  handle: string;
  displayName: string | null;
  creatorOpenId: string | null;
  region: "US" | "UK" | null;
  followerCount: number | null;
  avatarUrl: string | null;
  gmvAmount: string | null;
  gmvCurrency: string | null;
  gmvRange: string | null;
  /** Parsed from gmvAmount when exact; null for range-only bands. */
  gmvCents: number | null;
  videoGmvAmount: string | null;
  liveGmvAmount: string | null;
  productCardGmvAmount: string | null;
  avgCommissionRange: string | null;
  unitsSold: number | null;
  gpmAmount: string | null;
  gpmCurrency: string | null;
  gpmRange: string | null;
  contactEmail: string | null;
  categories: string[];
  bio: string | null;
  metricsRaw: Prisma.InputJsonValue | null;
  metricsSyncedAt: Date;
};

type MoneyLike = { amount?: string; currency?: string } | null | undefined;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
  }
  return null;
}

function moneyFrom(value: unknown): {
  amount: string | null;
  currency: string | null;
} {
  const rec = asRecord(value);
  if (!rec) return { amount: null, currency: null };
  return {
    amount: asString(rec.amount),
    currency: asString(rec.currency),
  };
}

function rangeFrom(value: unknown): {
  range: string | null;
  currency: string | null;
} {
  const rec = asRecord(value);
  if (!rec) return { range: null, currency: null };
  const formatted = asString(rec.formatted_range) ?? asString(rec.range);
  if (formatted) {
    return { range: formatted, currency: asString(rec.currency) };
  }
  const min = asString(rec.min);
  const max = asString(rec.max);
  if (min && max) {
    return {
      range: `${min}-${max}`,
      currency: asString(rec.currency),
    };
  }
  return { range: null, currency: asString(rec.currency) };
}

function extractContentChannelGmv(raw: Record<string, unknown>): {
  video: string | null;
  live: string | null;
  productCard: string | null;
} {
  const video = moneyFrom(raw.video_gmv).amount;
  const live = moneyFrom(raw.live_gmv).amount;
  let productCard =
    moneyFrom(raw.product_card_gmv).amount ??
    moneyFrom(raw.showcase_gmv).amount ??
    moneyFrom(raw.product_card).amount;

  const lists = [raw.gmv_by_content, raw.content_gmv, raw.gmv_distribution];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const row = asRecord(item);
      if (!row) continue;
      const type = (
        asString(row.type) ??
        asString(row.content_type) ??
        asString(row.name) ??
        ""
      ).toLowerCase();
      const amount =
        moneyFrom(row).amount ??
        asString(row.amount) ??
        asString(row.value) ??
        asString(row.percentage);
      if (!amount) continue;
      if (type.includes("video") && !video) {
        /* keep existing video from video_gmv if set */
      }
      if (type.includes("live") && !live) {
        /* keep existing */
      }
      if (
        (type.includes("product") ||
          type.includes("card") ||
          type.includes("showcase") ||
          type.includes("showcase")) &&
        !productCard
      ) {
        productCard = amount;
      }
    }
  }

  return {
    video: video ?? null,
    live: live ?? null,
    productCard: productCard ?? null,
  };
}

function extractCommissionRange(raw: Record<string, unknown>): string | null {
  const fromAvg = rangeFrom(raw.avg_commission ?? raw.average_commission);
  if (fromAvg.range) return fromAvg.range;
  const fromRate = rangeFrom(
    raw.commission_rate ?? raw.avg_commission_rate ?? raw.average_commission_rate,
  );
  if (fromRate.range) return fromRate.range;
  return asString(raw.avg_commission_rate) ?? asString(raw.commission_rate);
}

function extractContactEmail(raw: Record<string, unknown>): string | null {
  const direct =
    asString(raw.email) ??
    asString(raw.contact_email) ??
    asString(raw.creator_email);
  if (direct?.includes("@")) return direct;
  const contact = asRecord(raw.contact_info ?? raw.contact);
  const nested =
    asString(contact?.email) ?? asString(contact?.contact_email);
  return nested?.includes("@") ? nested : null;
}

function extractBio(raw: Record<string, unknown>): string | null {
  return (
    asString(raw.bio) ??
    asString(raw.bio_description) ??
    asString(raw.introduction) ??
    asString(raw.profile_bio)
  );
}

export function moneyAmount(value: MoneyLike): {
  amount: string | null;
  currency: string | null;
} {
  return moneyFrom(value);
}

export function formatGmvBio(input: {
  gmvRange: string | null;
  gmvAmount: string | null;
  gmvCurrency: string | null;
}): string | null {
  if (input.gmvRange) return `GMV ${input.gmvRange}`;
  if (input.gmvAmount) {
    return `GMV ${input.gmvAmount}${input.gmvCurrency ? ` ${input.gmvCurrency}` : ""}`.trim();
  }
  return null;
}

/**
 * Parse TikTok marketplace money strings into integer cents.
 * TikTok returns major units as decimal strings (e.g. "1234.56").
 * Returns null when the value is missing, a range label, or unparsable.
 */
export function parseMarketplaceAmountToCents(
  amount: string | null | undefined,
): number | null {
  if (amount == null) return null;
  const raw = String(amount).trim();
  if (!raw) return null;
  if (/[kKmM+]/.test(raw) || raw.includes("-") || raw.includes("–")) {
    return null;
  }
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Normalize a TikTok marketplace creator object (search or performance).
 * Defensive: missing fields stay null; never invent Seller-Center-only metrics.
 */
export function normalizeMarketplaceCreator(
  rawUnknown: unknown,
  opts: {
    fallbackRegion?: "US" | "UK" | null;
    metricsSyncedAt?: Date;
  } = {},
): MarketplaceMetrics | null {
  const raw = asRecord(rawUnknown);
  if (!raw) return null;

  const handle = (
    asString(raw.username) ??
    asString(raw.handle) ??
    asString(raw.unique_id) ??
    ""
  ).replace(/^@/, "");
  if (!handle) return null;

  const gmv = moneyFrom(raw.gmv);
  const gmvRangeInfo = rangeFrom(raw.gmv_range);
  const gpmMoney = moneyFrom(raw.gpm);
  const gpmRangeInfo = rangeFrom(raw.gpm ?? raw.gpm_range);
  const channels = extractContentChannelGmv(raw);
  const regionRaw =
    asString(raw.selection_region) ??
    asString(raw.region) ??
    asString(raw.market);
  let region: "US" | "UK" | null = opts.fallbackRegion ?? null;
  if (regionRaw) {
    const u = regionRaw.toUpperCase();
    if (u === "US" || u === "USA") region = "US";
    else if (u === "UK" || u === "GB" || u === "GBR") region = "UK";
  }

  const avatar = asRecord(raw.avatar);
  const categoriesRaw = raw.category_ids ?? raw.categories;
  const categories = Array.isArray(categoriesRaw)
    ? categoriesRaw.map((c) => String(c)).filter(Boolean)
    : [];

  const bioText = extractBio(raw);
  const gmvSummary = formatGmvBio({
    gmvRange: gmvRangeInfo.range,
    gmvAmount: gmv.amount,
    gmvCurrency: gmv.currency ?? gmvRangeInfo.currency,
  });

  return {
    handle,
    displayName:
      asString(raw.nickname) ?? asString(raw.display_name) ?? null,
    creatorOpenId:
      asString(raw.creator_open_id) ?? asString(raw.open_id) ?? null,
    region,
    followerCount: asInt(raw.follower_count ?? raw.followers),
    avatarUrl:
      asString(avatar?.url) ??
      asString(raw.avatar_url) ??
      asString(raw.profile_image),
    gmvAmount: gmv.amount,
    gmvCurrency: gmv.currency ?? gmvRangeInfo.currency,
    gmvRange: gmvRangeInfo.range,
    gmvCents: parseMarketplaceAmountToCents(gmv.amount),
    videoGmvAmount: channels.video,
    liveGmvAmount: channels.live,
    productCardGmvAmount: channels.productCard,
    avgCommissionRange: extractCommissionRange(raw),
    unitsSold: asInt(
      raw.units_sold ?? raw.items_sold ?? raw.sold_count ?? raw.sales_volume,
    ),
    gpmAmount: gpmMoney.amount,
    gpmCurrency: gpmMoney.currency ?? gpmRangeInfo.currency,
    gpmRange: gpmRangeInfo.range,
    contactEmail: extractContactEmail(raw),
    categories,
    bio: bioText ?? gmvSummary,
    metricsRaw: raw as Prisma.InputJsonValue,
    metricsSyncedAt: opts.metricsSyncedAt ?? new Date(),
  };
}

/** Prisma update payload: only overwrite fields when TikTok sent a value. */
export function metricsUpdateData(m: MarketplaceMetrics) {
  return {
    displayName: m.displayName ?? undefined,
    creatorOpenId: m.creatorOpenId ?? undefined,
    region: m.region ?? undefined,
    followerCount: m.followerCount ?? undefined,
    avatarUrl: m.avatarUrl ?? undefined,
    gmvAmount: m.gmvAmount ?? undefined,
    gmvCurrency: m.gmvCurrency ?? undefined,
    gmvRange: m.gmvRange ?? undefined,
    videoGmvAmount: m.videoGmvAmount ?? undefined,
    liveGmvAmount: m.liveGmvAmount ?? undefined,
    productCardGmvAmount: m.productCardGmvAmount ?? undefined,
    avgCommissionRange: m.avgCommissionRange ?? undefined,
    unitsSold: m.unitsSold ?? undefined,
    gpmAmount: m.gpmAmount ?? undefined,
    gpmCurrency: m.gpmCurrency ?? undefined,
    gpmRange: m.gpmRange ?? undefined,
    metricsRaw: m.metricsRaw ?? undefined,
    metricsSyncedAt: m.metricsSyncedAt,
  };
}

export function metricsCreateData(m: MarketplaceMetrics) {
  return {
    displayName: m.displayName,
    creatorOpenId: m.creatorOpenId,
    region: m.region,
    followerCount: m.followerCount,
    avatarUrl: m.avatarUrl,
    gmvAmount: m.gmvAmount,
    gmvCurrency: m.gmvCurrency,
    gmvRange: m.gmvRange,
    videoGmvAmount: m.videoGmvAmount,
    liveGmvAmount: m.liveGmvAmount,
    productCardGmvAmount: m.productCardGmvAmount,
    avgCommissionRange: m.avgCommissionRange,
    unitsSold: m.unitsSold,
    gpmAmount: m.gpmAmount,
    gpmCurrency: m.gpmCurrency,
    gpmRange: m.gpmRange,
    metricsRaw: m.metricsRaw ?? undefined,
    metricsSyncedAt: m.metricsSyncedAt,
  };
}

/** Discovery-only create fields (includes contactEmail + gmvCents). */
export function discoveryMetricsCreateData(m: MarketplaceMetrics) {
  return {
    ...metricsCreateData(m),
    gmvCents: m.gmvCents,
    contactEmail: m.contactEmail,
  };
}

export function discoveryMetricsUpdateData(m: MarketplaceMetrics) {
  return {
    ...metricsUpdateData(m),
    ...(m.gmvCents != null ? { gmvCents: m.gmvCents } : {}),
    contactEmail: m.contactEmail ?? undefined,
  };
}
