import type {
  PlatformMembershipStatus,
  PlatformRole,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";

export type ListParams = {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

function toStaff(row: {
  id: string;
  role: PlatformRole;
  status: PlatformMembershipStatus;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; email: string; name: string; status: string };
}) {
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: {
      id: row.user.id,
      email: row.user.email,
      name: row.user.name,
      status: row.user.status,
    },
  };
}

export async function listStaff(params: ListParams) {
  const where: Prisma.PlatformMembershipWhereInput = params.search
    ? {
        OR: [
          { user: { email: { contains: params.search, mode: "insensitive" } } },
          { user: { name: { contains: params.search, mode: "insensitive" } } },
        ],
      }
    : {};

  const sortOrder = params.sortOrder ?? "asc";
  let orderBy: Prisma.PlatformMembershipOrderByWithRelationInput = {
    createdAt: "desc",
  };
  if (params.sortBy === "email") {
    orderBy = { user: { email: sortOrder } };
  } else if (params.sortBy === "name") {
    orderBy = { user: { name: sortOrder } };
  } else if (params.sortBy === "role") {
    orderBy = { role: sortOrder };
  } else if (params.sortBy === "status") {
    orderBy = { status: sortOrder };
  } else if (params.sortBy === "createdAt") {
    orderBy = { createdAt: sortOrder };
  }

  const [total, rows] = await Promise.all([
    prisma.platformMembership.count({ where }),
    prisma.platformMembership.findMany({
      where,
      include: { user: true },
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    data: rows.map(toStaff),
    meta: { total, page: params.page, pageSize: params.pageSize },
  };
}

export async function createStaff(input: {
  email: string;
  name: string;
  role: PlatformRole;
  password: string;
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const existingMembership = await prisma.platformMembership.findUnique({
      where: { userId: existing.id },
    });
    if (existingMembership) {
      throw new AppError(
        "CONFLICT",
        "User already has a platform membership",
        409
      );
    }
    const membership = await prisma.platformMembership.create({
      data: {
        userId: existing.id,
        role: input.role,
        status: "ACTIVE",
      },
      include: { user: true },
    });
    return toStaff(membership);
  }

  const passwordHash = await hashPassword(input.password);
  const membership = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash,
        status: "ACTIVE",
      },
    });
    return tx.platformMembership.create({
      data: {
        userId: user.id,
        role: input.role,
        status: "ACTIVE",
      },
      include: { user: true },
    });
  });
  return toStaff(membership);
}

export async function patchStaff(
  membershipId: string,
  input: { role?: PlatformRole; status?: PlatformMembershipStatus },
  actorUserId: string
) {
  const membership = await prisma.platformMembership.findUnique({
    where: { id: membershipId },
    include: { user: true },
  });
  if (!membership) {
    throw new AppError("NOT_FOUND", "Staff membership not found", 404);
  }

  if (
    membership.userId === actorUserId &&
    input.status === "DISABLED"
  ) {
    throw new AppError("VALIDATION_ERROR", "Cannot disable your own account", 400);
  }

  if (
    membership.userId === actorUserId &&
    input.role &&
    input.role !== "SUPERADMIN"
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Cannot demote your own SUPERADMIN role",
      400
    );
  }

  const updated = await prisma.platformMembership.update({
    where: { id: membershipId },
    data: {
      ...(input.role ? { role: input.role } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    include: { user: true },
  });
  return toStaff(updated);
}

function toOrgSummary(org: {
  id: string;
  name: string;
  slug: string;
  seatLimit: number;
  shopLimit: number;
  dailyInviteQuota: number;
  createdAt: Date;
  plan: { id: string; code: string; name: string };
  subscription: { status: string; currentPeriodEnd: Date | null } | null;
  _count?: { shops: number; memberships: number };
}) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    seatLimit: org.seatLimit,
    shopLimit: org.shopLimit,
    dailyInviteQuota: org.dailyInviteQuota,
    createdAt: org.createdAt,
    plan: org.plan,
    subscriptionStatus: org.subscription?.status ?? null,
    currentPeriodEnd: org.subscription?.currentPeriodEnd ?? null,
    shopCount: org._count?.shops ?? undefined,
    memberCount: org._count?.memberships ?? undefined,
  };
}

export async function listOrganizations(params: ListParams) {
  const where: Prisma.OrganizationWhereInput = params.search
    ? {
        OR: [
          { name: { contains: params.search, mode: "insensitive" } },
          { slug: { contains: params.search, mode: "insensitive" } },
        ],
      }
    : {};

  const sortOrder = params.sortOrder ?? "desc";
  let orderBy: Prisma.OrganizationOrderByWithRelationInput = {
    createdAt: "desc",
  };
  if (params.sortBy === "name") orderBy = { name: sortOrder };
  else if (params.sortBy === "slug") orderBy = { slug: sortOrder };
  else if (params.sortBy === "createdAt") orderBy = { createdAt: sortOrder };

  const [total, rows] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      include: {
        plan: true,
        subscription: true,
        _count: { select: { shops: true, memberships: true } },
      },
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    data: rows.map(toOrgSummary),
    meta: { total, page: params.page, pageSize: params.pageSize },
  };
}

export async function getOrganization(id: string) {
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      plan: true,
      subscription: true,
      memberships: {
        include: {
          user: { select: { id: true, email: true, name: true, status: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      shops: {
        include: { botIdentity: { select: { email: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { shops: true, memberships: true } },
    },
  });
  if (!org) throw new AppError("NOT_FOUND", "Organization not found", 404);

  return {
    ...toOrgSummary(org),
    stripeCustomerId: org.stripeCustomerId,
    members: org.memberships.map((m) => ({
      id: m.id,
      role: m.role,
      status: m.status,
      user: m.user,
    })),
    shops: org.shops.map((s) => ({
      id: s.id,
      region: s.region,
      status: s.status,
      displayName: s.displayName,
      externalShopId: s.externalShopId,
      botEmail: s.botIdentity?.email ?? null,
      verifiedAt: s.verifiedAt,
      createdAt: s.createdAt,
    })),
  };
}

export async function listPlatformShops(params: ListParams) {
  const where: Prisma.ShopWhereInput = params.search
    ? {
        OR: [
          { displayName: { contains: params.search, mode: "insensitive" } },
          { externalShopId: { contains: params.search, mode: "insensitive" } },
          {
            organization: {
              name: { contains: params.search, mode: "insensitive" },
            },
          },
        ],
      }
    : {};

  const sortOrder = params.sortOrder ?? "desc";
  let orderBy: Prisma.ShopOrderByWithRelationInput = { createdAt: "desc" };
  if (params.sortBy === "status") orderBy = { status: sortOrder };
  else if (params.sortBy === "region") orderBy = { region: sortOrder };
  else if (params.sortBy === "createdAt") orderBy = { createdAt: sortOrder };

  const [total, rows] = await Promise.all([
    prisma.shop.count({ where }),
    prisma.shop.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        botIdentity: { select: { email: true } },
      },
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    data: rows.map((s) => ({
      id: s.id,
      region: s.region,
      status: s.status,
      statusReason: s.statusReason,
      displayName: s.displayName,
      externalShopId: s.externalShopId,
      botEmail: s.botIdentity?.email ?? null,
      verifiedAt: s.verifiedAt,
      createdAt: s.createdAt,
      organization: s.organization,
    })),
    meta: { total, page: params.page, pageSize: params.pageSize },
  };
}

export async function billingOverview() {
  const [orgTotal, byPlan, bySubStatus, paidOrgs] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.groupBy({
      by: ["planId"],
      _count: { _all: true },
    }),
    prisma.subscription.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.organization.findMany({
      where: {
        subscription: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
      },
      include: { plan: true, subscription: true },
    }),
  ]);

  const plans = await prisma.plan.findMany();
  const planById = new Map(plans.map((p) => [p.id, p]));

  const orgsByPlan = byPlan.map((row) => {
    const plan = planById.get(row.planId);
    return {
      planCode: plan?.code ?? "unknown",
      planName: plan?.name ?? "Unknown",
      count: row._count._all,
    };
  });

  const subscriptionsByStatus = bySubStatus.map((row) => ({
    status: row.status,
    count: row._count._all,
  }));

  const mrrCents = paidOrgs
    .filter((o) => o.subscription && o.plan.code !== "free")
    .reduce((sum, o) => sum + o.plan.monthlyPriceCents, 0);

  return {
    organizationCount: orgTotal,
    orgsByPlan,
    subscriptionsByStatus,
    mrrCents,
    paidOrganizationCount: paidOrgs.filter((o) => o.plan.code !== "free")
      .length,
  };
}

export async function listProxiesScaffold() {
  return {
    items: [] as Array<{ id: string; label: string; status: string }>,
    meta: { total: 0, note: "Proxy management scaffolding — coming later" },
  };
}

export async function crawlerStatusScaffold() {
  return {
    status: "IDLE" as const,
    lastRunAt: null as string | null,
    note: "Crawler console scaffolding — coming later",
  };
}
