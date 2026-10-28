/**
 * Official Seller Marketplace search filter enums.
 * @see https://partner.tiktokshop.com/docv2/page/search-creators-in-creator-marketplace-202608
 */

export const TIKTOK_GMV_RANGES = [
  "GMV_RANGE_0_100",
  "GMV_RANGE_100_1000",
  "GMV_RANGE_1000_10000",
  "GMV_RANGE_10000_AND_ABOVE",
] as const;

export type TikTokGmvRange = (typeof TIKTOK_GMV_RANGES)[number];

export const TIKTOK_UNITS_SOLD_RANGES = [
  "UNITS_SOLD_RANGE_0_10",
  "UNITS_SOLD_RANGE_10_100",
  "UNITS_SOLD_RANGE_100_1000",
  "UNITS_SOLD_RANGE_1000_AND_ABOVE",
] as const;

export type TikTokUnitsSoldRange = (typeof TIKTOK_UNITS_SOLD_RANGES)[number];

export const TIKTOK_GMV_RANGE_LABELS: Record<TikTokGmvRange, string> = {
  GMV_RANGE_0_100: "GMV $0–$100",
  GMV_RANGE_100_1000: "GMV $100–$1K",
  GMV_RANGE_1000_10000: "GMV $1K–$10K",
  GMV_RANGE_10000_AND_ABOVE: "GMV $10K+",
};

export const TIKTOK_UNITS_SOLD_RANGE_LABELS: Record<TikTokUnitsSoldRange, string> =
  {
    UNITS_SOLD_RANGE_0_10: "Units sold 0–10",
    UNITS_SOLD_RANGE_10_100: "Units sold 10–100",
    UNITS_SOLD_RANGE_100_1000: "Units sold 100–1K",
    UNITS_SOLD_RANGE_1000_AND_ABOVE: "Units sold 1K+",
  };

/** gmvCents bounds for local index filtering (USD cents). */
export function gmvCentsBoundsForRange(
  range: TikTokGmvRange,
): { gte?: number; lte?: number } {
  switch (range) {
    case "GMV_RANGE_0_100":
      return { gte: 0, lte: 10_000 };
    case "GMV_RANGE_100_1000":
      return { gte: 10_000, lte: 100_000 };
    case "GMV_RANGE_1000_10000":
      return { gte: 100_000, lte: 1_000_000 };
    case "GMV_RANGE_10000_AND_ABOVE":
      return { gte: 1_000_000 };
  }
}

/** Text needles for formatted gmvRange labels TikTok returns. */
export function gmvRangeTextNeedles(range: TikTokGmvRange): string[] {
  switch (range) {
    case "GMV_RANGE_0_100":
      return ["0-100", "0–100", "$0-", "$0 –"];
    case "GMV_RANGE_100_1000":
      return ["100-1000", "100–1000", "100-1K", "100–1K", "$100"];
    case "GMV_RANGE_1000_10000":
      return ["1000-10000", "1K-10K", "1K–10K", "$1K", "1,000-10"];
    case "GMV_RANGE_10000_AND_ABOVE":
      return ["10000", "10K+", "$10K", "10K -", "25K", "50K", "150K", "1M"];
  }
}

export function unitsSoldBoundsForRange(
  range: TikTokUnitsSoldRange,
): { gte?: number; lte?: number } {
  switch (range) {
    case "UNITS_SOLD_RANGE_0_10":
      return { gte: 0, lte: 10 };
    case "UNITS_SOLD_RANGE_10_100":
      return { gte: 10, lte: 100 };
    case "UNITS_SOLD_RANGE_100_1000":
      return { gte: 100, lte: 1000 };
    case "UNITS_SOLD_RANGE_1000_AND_ABOVE":
      return { gte: 1000 };
  }
}

export function unitsSoldRangeTextNeedles(range: TikTokUnitsSoldRange): string[] {
  switch (range) {
    case "UNITS_SOLD_RANGE_0_10":
      return ["0-10", "0–10"];
    case "UNITS_SOLD_RANGE_10_100":
      return ["10-100", "10–100"];
    case "UNITS_SOLD_RANGE_100_1000":
      return ["100-1000", "100–1000", "100-1K", "100–1K"];
    case "UNITS_SOLD_RANGE_1000_AND_ABOVE":
      return ["1000+", "1K+", "1,000+"];
  }
}

export function isTikTokGmvRange(value: string): value is TikTokGmvRange {
  return (TIKTOK_GMV_RANGES as readonly string[]).includes(value);
}

export function isTikTokUnitsSoldRange(
  value: string,
): value is TikTokUnitsSoldRange {
  return (TIKTOK_UNITS_SOLD_RANGES as readonly string[]).includes(value);
}
