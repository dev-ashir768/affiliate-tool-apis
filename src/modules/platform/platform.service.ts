import type {
  PlatformMembershipStatus,
  PlatformRole,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { writeAuditLog } from "../../lib/audit.js";
import { encryptVault } from "../../lib/crypto.js";

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
    await writeAuditLog({
      action: "platform.staff_created",
      entityType: "PlatformMembership",
      entityId: membership.id,
      meta: { email, role: input.role, existingUser: true },
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
  await writeAuditLog({
    action: "platform.staff_created",
    entityType: "PlatformMembership",
    entityId: membership.id,
    meta: { email, role: input.role },
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
  await writeAuditLog({
    actorUserId: actorUserId,
    action: "platform.staff_patched",
    entityType: "PlatformMembership",
    entityId: membershipId,
    meta: { ...input },
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

  const paidOrganizationCount = paidOrgs.filter(
    (o) => o.plan.code !== "free"
  ).length;
  const freeOrganizationCount = await prisma.organization.count({
    where: { plan: { code: "free" } },
  });
  const activeSubscriptionCount =
    bySubStatus.find((r) => r.status === "ACTIVE")?._count._all ?? 0;
  const pastDueCount =
    bySubStatus.find((r) => r.status === "PAST_DUE")?._count._all ?? 0;
  const trialingCount =
    bySubStatus.find((r) => r.status === "TRIALING")?._count._all ?? 0;

  const revenueByPlan = plans
    .filter((p) => p.code !== "free")
    .map((plan) => {
      const count = byPlan.find((r) => r.planId === plan.id)?._count._all ?? 0;
      return {
        planCode: plan.code,
        planName: plan.name,
        orgCount: count,
        monthlyPriceCents: plan.monthlyPriceCents,
        mrrCents: count * plan.monthlyPriceCents,
      };
    });

  return {
    organizationCount: orgTotal,
    freeOrganizationCount,
    paidOrganizationCount,
    activeSubscriptionCount,
    pastDueCount,
    trialingCount,
    avgMrrPerPaidOrgCents:
      paidOrganizationCount > 0
        ? Math.round(mrrCents / paidOrganizationCount)
        : 0,
    orgsByPlan,
    revenueByPlan,
    subscriptionsByStatus,
    mrrCents,
  };
}

export async function listAuditLogs(params: ListParams) {
  const where: Prisma.AuditLogWhereInput = params.search
    ? {
        OR: [
          { action: { contains: params.search, mode: "insensitive" } },
          { entityType: { contains: params.search, mode: "insensitive" } },
          { entityId: { contains: params.search, mode: "insensitive" } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: {
        actor: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    data: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      meta: r.meta,
      createdAt: r.createdAt,
      actor: r.actor,
    })),
    meta: { total, page: params.page, pageSize: params.pageSize },
  };
}

export async function listProxies(params: {
  page: number;
  pageSize: number;
  search?: string;
}) {
  const where = params.search
    ? {
        OR: [
          { label: { contains: params.search, mode: "insensitive" as const } },
          { host: { contains: params.search, mode: "insensitive" as const } },
          { region: { contains: params.search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    prisma.proxy.count({ where }),
    prisma.proxy.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    data: rows.map((p) => ({
      id: p.id,
      label: p.label,
      host: p.host,
      port: p.port,
      protocol: p.protocol,
      username: p.username,
      hasPassword: Boolean(p.passwordEnc),
      region: p.region,
      status: p.status,
      lastCheckedAt: p.lastCheckedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
    meta: { total, page: params.page, pageSize: params.pageSize },
  };
}

export async function createProxy(input: {
  label: string;
  host: string;
  port: number;
  protocol: "HTTP" | "HTTPS" | "SOCKS5";
  username?: string | null;
  password?: string | null;
  region?: string | null;
  status?: "AVAILABLE" | "IN_USE" | "DISABLED" | "BANNED";
}) {
  const row = await prisma.proxy.create({
    data: {
      label: input.label,
      host: input.host,
      port: input.port,
      protocol: input.protocol,
      username: input.username ?? null,
      passwordEnc: input.password ? encryptVault(input.password) : null,
      region: input.region ?? null,
      status: input.status ?? "AVAILABLE",
    },
  });

  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    protocol: row.protocol,
    username: row.username,
    hasPassword: Boolean(row.passwordEnc),
    region: row.region,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function patchProxy(
  id: string,
  input: {
    label?: string;
    host?: string;
    port?: number;
    protocol?: "HTTP" | "HTTPS" | "SOCKS5";
    username?: string | null;
    password?: string | null;
    region?: string | null;
    status?: "AVAILABLE" | "IN_USE" | "DISABLED" | "BANNED";
  }
) {
  const existing = await prisma.proxy.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("NOT_FOUND", "Proxy not found", 404);
  }

  const row = await prisma.proxy.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.host !== undefined ? { host: input.host } : {}),
      ...(input.port !== undefined ? { port: input.port } : {}),
      ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.password !== undefined
        ? {
            passwordEnc: input.password ? encryptVault(input.password) : null,
          }
        : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    protocol: row.protocol,
    username: row.username,
    hasPassword: Boolean(row.passwordEnc),
    region: row.region,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function crawlerStatus() {
  // Phase 7: surface queue health; dry-run enqueue lands in Task 7.3
  return {
    status: "IDLE" as const,
    lastRunAt: null as string | null,
    queue: "shop-verify",
    note: "Crawler listens on the shop-verify worker queue. Use shop verify from merchant shops; dedicated crawl runs come next.",
  };
}

/** @deprecated use listProxies */
export async function listProxiesScaffold() {
  const result = await listProxies({ page: 1, pageSize: 100 });
  return {
    items: result.data.map((p) => ({
      id: p.id,
      label: p.label,
      status: p.status,
    })),
    meta: {
      total: result.meta.total,
      note: "Proxy pool is live — manage via platform proxies API",
    },
  };
}

/** @deprecated use crawlerStatus */
export async function crawlerStatusScaffold() {
  return crawlerStatus();
}
