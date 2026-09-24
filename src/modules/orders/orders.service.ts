import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { parseMarketplaceAmountToCents } from "../discovery/creator-metrics.js";

export async function listOrders(organizationId: string) {
  const rows = await prisma.shopOrder.findMany({
    where: { organizationId },
    include: {
      creator: { select: { id: true, handle: true, displayName: true } },
      commissions: true,
    },
    orderBy: { orderedAt: "desc" },
    take: 100,
  });
  return {
    orders: rows.map((r) => ({
      id: r.id,
      externalOrderId: r.externalOrderId,
      gmvCents: r.gmvCents,
      currency: r.currency,
      status: r.status,
      orderedAt: r.orderedAt.toISOString(),
      shopId: r.shopId,
      creatorId: r.creatorId,
      creatorHandle: r.creator?.handle ?? null,
      commissionCents: r.commissions.reduce((s, c) => s + c.amountCents, 0),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function createOrder(
  organizationId: string,
  input: {
    externalOrderId: string;
    gmvCents: number;
    currency?: string;
    status?: "PENDING" | "PAID" | "REFUNDED" | "CANCELED";
    orderedAt: string;
    shopId?: string | null;
    creatorId?: string | null;
    commissionCents?: number;
  },
) {
  if (input.shopId) {
    const shop = await prisma.shop.findFirst({
      where: { id: input.shopId, organizationId },
    });
    if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
  }
  if (input.creatorId) {
    const creator = await prisma.creator.findFirst({
      where: { id: input.creatorId, organizationId },
    });
    if (!creator) throw new AppError("NOT_FOUND", "Creator not found", 404);
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      const row = await tx.shopOrder.create({
        data: {
          organizationId,
          externalOrderId: input.externalOrderId.trim(),
          gmvCents: input.gmvCents,
          currency: input.currency ?? "USD",
          status: input.status ?? "PAID",
          orderedAt: new Date(input.orderedAt),
          shopId: input.shopId ?? null,
          creatorId: input.creatorId ?? null,
        },
      });
      if (input.commissionCents != null && input.commissionCents > 0) {
        await tx.commission.create({
          data: {
            organizationId,
            orderId: row.id,
            creatorId: input.creatorId ?? null,
            amountCents: input.commissionCents,
            status: "PENDING",
          },
        });
      }
      return row;
    });

    return {
      id: order.id,
      externalOrderId: order.externalOrderId,
      gmvCents: order.gmvCents,
      currency: order.currency,
      status: order.status,
      orderedAt: order.orderedAt.toISOString(),
      shopId: order.shopId,
      creatorId: order.creatorId,
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AppError("CONFLICT", "Order already exists", 409);
    }
    throw err;
  }
}

type CurrencyBucket = {
  currency: string;
  gmvCents: number;
  count: number;
};

/** Explicit row shape — keeps Promise.all typing stable for the marketplace select. */
type MarketplaceCreatorMetricsRow = {
  id: string;
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  gmvAmount: string | null;
  gmvCurrency: string | null;
  gmvRange: string | null;
  videoGmvAmount: string | null;
  liveGmvAmount: string | null;
  metricsSyncedAt: Date | null;
};

function bumpCurrency(
  map: Map<string, CurrencyBucket>,
  currency: string,
  gmvCents: number,
  count = 1,
) {
  const key = currency.trim().toUpperCase() || "UNKNOWN";
  const prev = map.get(key) ?? { currency: key, gmvCents: 0, count: 0 };
  prev.gmvCents += gmvCents;
  prev.count += count;
  map.set(key, prev);
}

export async function analyticsOverview(
  organizationId: string,
  range?: { from?: string; to?: string },
) {
  const orderedAt: { gte?: Date; lte?: Date } = {};
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (range?.from) {
    const d = new Date(range.from);
    if (!Number.isNaN(d.getTime())) {
      orderedAt.gte = d;
      createdAt.gte = d;
    }
  }
  if (range?.to) {
    const d = new Date(range.to);
    if (!Number.isNaN(d.getTime())) {
      if (range.to.length <= 10) d.setHours(23, 59, 59, 999);
      orderedAt.lte = d;
      createdAt.lte = d;
    }
  }
  const hasRange = Object.keys(orderedAt).length > 0;

  const funnelPromise = Promise.all([
    prisma.creator.count({ where: { organizationId } }),
    prisma.outreachMessage.count({
      where: {
        organizationId,
        status: "SENT",
        ...(hasRange ? { createdAt } : {}),
      },
    }),
    prisma.outreachMessage.count({
      where: {
        organizationId,
        status: "FAILED",
        ...(hasRange ? { createdAt } : {}),
      },
    }),
    prisma.shopOrder.aggregate({
      where: {
        organizationId,
        status: { in: ["PAID", "PENDING"] },
        ...(hasRange ? { orderedAt } : {}),
      },
      _sum: { gmvCents: true },
      _count: true,
    }),
    prisma.commission.aggregate({
      where: {
        organizationId,
        ...(hasRange ? { createdAt } : {}),
      },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.shopOrder.groupBy({
      by: ["currency"],
      where: {
        organizationId,
        status: { in: ["PAID", "PENDING"] },
        ...(hasRange ? { orderedAt } : {}),
      },
      _sum: { gmvCents: true },
      _count: true,
    }),
    prisma.shopOrder.findMany({
      where: {
        organizationId,
        ...(hasRange ? { orderedAt } : {}),
      },
      orderBy: { orderedAt: "desc" },
      take: 5,
      select: {
        id: true,
        externalOrderId: true,
        gmvCents: true,
        currency: true,
        status: true,
        orderedAt: true,
        creator: { select: { handle: true } },
      },
    }),
    prisma.creator.count({
      where: { organizationId, stage: { in: ["INVITED", "ACTIVE"] } },
    }),
    prisma.creator.count({
      where: { organizationId, stage: "ACTIVE" },
    }),
    // Daily GMV series for charts (last N days or selected range)
    prisma.shopOrder.findMany({
      where: {
        organizationId,
        status: { in: ["PAID", "PENDING"] },
        ...(hasRange
          ? { orderedAt }
          : {
              orderedAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              },
            }),
      },
      select: { orderedAt: true, gmvCents: true },
      orderBy: { orderedAt: "asc" },
      take: 5000,
    }),
  ]);

  const marketplacePromise = prisma.creator.findMany({
    where: {
      organizationId,
      OR: [
        { gmvAmount: { not: null } },
        { gmvRange: { not: null } },
        { metricsSyncedAt: { not: null } },
      ],
    },
    select: {
      id: true,
      handle: true,
      displayName: true,
      followerCount: true,
      gmvAmount: true,
      gmvCurrency: true,
      gmvRange: true,
      videoGmvAmount: true,
      liveGmvAmount: true,
      metricsSyncedAt: true,
    },
    orderBy: [{ metricsSyncedAt: "desc" }, { updatedAt: "desc" }],
    take: 500,
  } as unknown as Prisma.CreatorFindManyArgs) as unknown as Promise<MarketplaceCreatorMetricsRow[]>;

  const [
    [
      creatorCount,
      outreachSent,
      outreachFailed,
      orderAgg,
      commissionAgg,
      shopByCurrency,
      recentOrders,
      invited,
      active,
      orderSeriesRows,
    ],
    marketplaceCreators,
  ] = await Promise.all([funnelPromise, marketplacePromise]);

  const gmvByDayMap = new Map<string, number>();
  for (const row of orderSeriesRows) {
    if (!row.orderedAt) continue;
    const key = row.orderedAt.toISOString().slice(0, 10);
    gmvByDayMap.set(key, (gmvByDayMap.get(key) ?? 0) + row.gmvCents);
  }
  const gmvByDay = [...gmvByDayMap.entries()].map(([date, gmvCents]) => ({
    date,
    gmvCents,
  }));

  const shopGmvCents = orderAgg._sum.gmvCents ?? 0;
  const shopCurrencyMap = new Map<string, CurrencyBucket>();
  for (const row of shopByCurrency) {
    bumpCurrency(
      shopCurrencyMap,
      row.currency,
      row._sum.gmvCents ?? 0,
      row._count,
    );
  }

  const marketplaceCurrencyMap = new Map<string, CurrencyBucket>();
  let creatorsWithParsableGmv = 0;
  let creatorsWithRangeOnly = 0;
  let lastSyncedAtMs = 0;

  const scored = marketplaceCreators.map((c) => {
    const gmvCents = parseMarketplaceAmountToCents(c.gmvAmount);
    const currency = (c.gmvCurrency ?? "USD").trim().toUpperCase() || "USD";
    if (gmvCents != null) {
      creatorsWithParsableGmv += 1;
      bumpCurrency(marketplaceCurrencyMap, currency, gmvCents, 1);
    } else if (c.gmvRange?.trim()) {
      creatorsWithRangeOnly += 1;
    }
    if (c.metricsSyncedAt) {
      const ms = c.metricsSyncedAt.getTime();
      if (ms > lastSyncedAtMs) lastSyncedAtMs = ms;
    }
    return {
      id: c.id,
      handle: c.handle,
      displayName: c.displayName,
      followerCount: c.followerCount,
      gmvAmount: c.gmvAmount,
      gmvCurrency: c.gmvCurrency,
      gmvRange: c.gmvRange,
      videoGmvAmount: c.videoGmvAmount,
      liveGmvAmount: c.liveGmvAmount,
      metricsSyncedAt: c.metricsSyncedAt,
      gmvCents,
      currency,
    };
  });

  scored.sort((a, b) => (b.gmvCents ?? -1) - (a.gmvCents ?? -1));
  const topMarketplaceCreators = scored.slice(0, 10).map((c) => ({
    id: c.id,
    handle: c.handle,
    displayName: c.displayName,
    followerCount: c.followerCount,
    gmvAmount: c.gmvAmount,
    gmvCurrency: c.gmvCurrency,
    gmvRange: c.gmvRange,
    gmvCents: c.gmvCents,
    videoGmvAmount: c.videoGmvAmount,
    liveGmvAmount: c.liveGmvAmount,
    metricsSyncedAt: c.metricsSyncedAt?.toISOString() ?? null,
  }));

  const marketplaceByCurrency = [...marketplaceCurrencyMap.values()].sort(
    (a, b) => b.gmvCents - a.gmvCents,
  );
  const marketplaceParsedTotalCents = marketplaceByCurrency.reduce(
    (s, b) => s + b.gmvCents,
    0,
  );

  const [shopGmvByCreatorRaw, campaigns, inviteByCampaign, outreachByCampaign] =
    await Promise.all([
      prisma.shopOrder.groupBy({
        by: ["creatorId"],
        where: {
          organizationId,
          status: { in: ["PAID", "PENDING"] },
          creatorId: { not: null },
        },
        _sum: { gmvCents: true },
        _count: true,
        orderBy: { _sum: { gmvCents: "desc" } },
        take: 25,
      }),
      prisma.campaign.findMany({
        where: { organizationId },
        select: { id: true, name: true, status: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      prisma.affiliateInvite.groupBy({
        by: ["campaignId"],
        where: {
          organizationId,
          campaignId: { not: null },
          status: { in: ["SENT", "PARTIAL", "QUEUED"] },
        },
        _count: true,
      }),
      prisma.outreachMessage.groupBy({
        by: ["campaignId"],
        where: {
          organizationId,
          campaignId: { not: null },
          status: "SENT",
        },
        _count: true,
      }),
    ]);

  const creatorIds = shopGmvByCreatorRaw
    .map((r) => r.creatorId)
    .filter((id): id is string => Boolean(id));
  const creatorRows =
    creatorIds.length > 0
      ? await prisma.creator.findMany({
          where: { organizationId, id: { in: creatorIds } },
          select: { id: true, handle: true, displayName: true },
        })
      : [];
  const creatorMap = new Map(creatorRows.map((c) => [c.id, c]));

  const shopGmvByCreator = shopGmvByCreatorRaw.map((r) => {
    const c = r.creatorId ? creatorMap.get(r.creatorId) : null;
    return {
      creatorId: r.creatorId!,
      handle: c?.handle ?? null,
      displayName: c?.displayName ?? null,
      gmvCents: r._sum.gmvCents ?? 0,
      orders: r._count,
    };
  });

  const inviteMap = new Map(
    inviteByCampaign
      .filter((r) => r.campaignId)
      .map((r) => [r.campaignId!, r._count]),
  );
  const outreachMap = new Map(
    outreachByCampaign
      .filter((r) => r.campaignId)
      .map((r) => [r.campaignId!, r._count]),
  );

  const campaignsPerformance = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    invites: inviteMap.get(c.id) ?? 0,
    outreachSent: outreachMap.get(c.id) ?? 0,
  }));

  return {
    range: {
      from: range?.from ?? null,
      to: range?.to ?? null,
    },
    charts: {
      gmvByDay,
    },
    funnel: {
      creators: creatorCount,
      contactedOrInvited: invited,
      active,
      outreachSent,
      outreachFailed,
      orders: orderAgg._count,
      /** @deprecated Prefer gmv.shop.gmvCents — shop-attributed order GMV only. */
      gmvCents: shopGmvCents,
      commissionCents: commissionAgg._sum.amountCents ?? 0,
    },
    gmv: {
      shop: {
        kind: "shop_orders" as const,
        label: "Shop attributed GMV",
        description:
          "GMV from orders attributed to your TikTok Shop (ShopOrder). This is your commerce revenue signal.",
        gmvCents: shopGmvCents,
        orders: orderAgg._count,
        commissionCents: commissionAgg._sum.amountCents ?? 0,
        byCurrency: [...shopCurrencyMap.values()]
          .sort((a, b) => b.gmvCents - a.gmvCents)
          .map((b) => ({
            currency: b.currency,
            gmvCents: b.gmvCents,
            orders: b.count,
          })),
      },
      marketplace: {
        kind: "creator_marketplace" as const,
        label: "Creator marketplace GMV",
        description:
          "Affiliate GMV snapshots from TikTok Creator Marketplace for CRM creators. Not your shop sales — use for creator ranking / outreach prioritization.",
        creatorsWithMetrics: marketplaceCreators.length,
        creatorsWithParsableGmv,
        creatorsWithRangeOnly,
        /** Sum of parsable amounts only. Multi-currency orgs should use byCurrency. */
        parsedGmvCents: marketplaceParsedTotalCents,
        multiCurrency: marketplaceByCurrency.length > 1,
        byCurrency: marketplaceByCurrency.map((b) => ({
          currency: b.currency,
          gmvCents: b.gmvCents,
          creators: b.count,
        })),
        lastSyncedAt:
          lastSyncedAtMs > 0 ? new Date(lastSyncedAtMs).toISOString() : null,
      },
    },
    shopGmvByCreator,
    campaignsPerformance,
    topMarketplaceCreators,
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      externalOrderId: o.externalOrderId,
      gmvCents: o.gmvCents,
      currency: o.currency,
      status: o.status,
      orderedAt: o.orderedAt.toISOString(),
      creatorHandle: o.creator?.handle ?? null,
    })),
  };
}

function mapTikTokOrderStatus(
  status: string | null,
): "PENDING" | "PAID" | "REFUNDED" | "CANCELED" {
  const s = (status ?? "").toUpperCase();
  if (s.includes("CANCEL")) return "CANCELED";
  if (s.includes("REFUND")) return "REFUNDED";
  if (
    s.includes("COMPLETE") ||
    s.includes("DELIVER") ||
    s.includes("PAID") ||
    s.includes("SHIP")
  ) {
    return "PAID";
  }
  return "PENDING";
}

/**
 * Pull affiliate-attributed orders from TikTok into ShopOrder (+ optional commission).
 * Matches creators by open_id / handle when present.
 */
export async function syncOrgAffiliateOrders(input: {
  organizationId: string;
  shopId: string;
  /** Lookback window in days (default 30, max 90). */
  lookbackDays?: number;
  maxPages?: number;
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
      "Authorize TikTok on this shop before syncing orders",
      400,
    );
  }

  const { getShopOpenApiCredentials } =
    await import("../shops/tiktok-oauth.service.js");
  const { searchAffiliateOrders } =
    await import("../../lib/tiktok-shop/client.js");

  const credentials = await getShopOpenApiCredentials(
    input.organizationId,
    input.shopId,
  );
  const lookbackDays = Math.min(90, Math.max(1, input.lookbackDays ?? 30));
  const maxPages = Math.min(10, Math.max(1, input.maxPages ?? 5));
  const createTimeGe = Math.floor(
    (Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000,
  );

  let pageToken: string | null = null;
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let pages = 0;

  for (let page = 0; page < maxPages; page++) {
    const result = await searchAffiliateOrders({
      credentials,
      pageSize: 50,
      pageToken,
      createTimeGe,
    });
    pages += 1;

    for (const order of result.orders) {
      const gmvCents =
        parseMarketplaceAmountToCents(order.gmvAmount) ??
        (order.gmvAmount && /^\d+$/.test(order.gmvAmount)
          ? Number(order.gmvAmount)
          : null);
      if (gmvCents == null) {
        skipped += 1;
        continue;
      }

      let creatorId: string | null = null;
      if (order.creatorOpenId) {
        const byOpenId = await prisma.creator.findFirst({
          where: {
            organizationId: input.organizationId,
            creatorOpenId: order.creatorOpenId,
          },
          select: { id: true },
        });
        creatorId = byOpenId?.id ?? null;
      }
      if (!creatorId && order.creatorUsername) {
        const handle = order.creatorUsername.replace(/^@/, "");
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

      const orderedAt =
        order.createTime != null
          ? new Date(order.createTime * 1000)
          : new Date();
      const status = mapTikTokOrderStatus(order.status);
      const currency = (order.currency ?? "USD").toUpperCase();
      const commissionCents = parseMarketplaceAmountToCents(
        order.commissionAmount,
      );

      const existing = await prisma.shopOrder.findUnique({
        where: {
          organizationId_externalOrderId: {
            organizationId: input.organizationId,
            externalOrderId: order.orderId,
          },
        },
        include: { commissions: true },
      });

      if (existing) {
        await prisma.shopOrder.update({
          where: { id: existing.id },
          data: {
            gmvCents,
            currency,
            status,
            orderedAt,
            shopId: input.shopId,
            creatorId: creatorId ?? existing.creatorId,
          },
        });
        updated += 1;
      } else {
        await prisma.$transaction(async (tx) => {
          const row = await tx.shopOrder.create({
            data: {
              organizationId: input.organizationId,
              shopId: input.shopId,
              creatorId,
              externalOrderId: order.orderId,
              gmvCents,
              currency,
              status,
              orderedAt,
            },
          });
          if (commissionCents != null && commissionCents > 0) {
            await tx.commission.create({
              data: {
                organizationId: input.organizationId,
                orderId: row.id,
                creatorId,
                amountCents: commissionCents,
                status: "PENDING",
              },
            });
          }
        });
        imported += 1;
      }
    }

    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }

  return {
    shopId: input.shopId,
    lookbackDays,
    pages,
    imported,
    updated,
    skipped,
  };
}
