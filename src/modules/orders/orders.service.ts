import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

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
  }
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

export async function analyticsOverview(organizationId: string) {
  const [
    creatorCount,
    outreachSent,
    outreachFailed,
    orderAgg,
    commissionAgg,
    recentOrders,
  ] = await Promise.all([
    prisma.creator.count({ where: { organizationId } }),
    prisma.outreachMessage.count({
      where: { organizationId, status: "SENT" },
    }),
    prisma.outreachMessage.count({
      where: { organizationId, status: "FAILED" },
    }),
    prisma.shopOrder.aggregate({
      where: { organizationId, status: { in: ["PAID", "PENDING"] } },
      _sum: { gmvCents: true },
      _count: true,
    }),
    prisma.commission.aggregate({
      where: { organizationId },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.shopOrder.findMany({
      where: { organizationId },
      orderBy: { orderedAt: "desc" },
      take: 5,
      select: {
        id: true,
        externalOrderId: true,
        gmvCents: true,
        status: true,
        orderedAt: true,
      },
    }),
  ]);

  const invited = await prisma.creator.count({
    where: { organizationId, stage: { in: ["INVITED", "ACTIVE"] } },
  });
  const active = await prisma.creator.count({
    where: { organizationId, stage: "ACTIVE" },
  });

  return {
    funnel: {
      creators: creatorCount,
      contactedOrInvited: invited,
      active,
      outreachSent,
      outreachFailed,
      orders: orderAgg._count,
      gmvCents: orderAgg._sum.gmvCents ?? 0,
      commissionCents: commissionAgg._sum.amountCents ?? 0,
    },
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      externalOrderId: o.externalOrderId,
      gmvCents: o.gmvCents,
      status: o.status,
      orderedAt: o.orderedAt.toISOString(),
    })),
  };
}
