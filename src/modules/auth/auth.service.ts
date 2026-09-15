import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  generateRefreshToken,
  signAccessToken,
  type AccessClaims,
} from "../../lib/tokens.js";
import { sha256 } from "../../lib/crypto.js";
import {
  mirrorRefresh,
  revokeRefreshMirror,
  isRefreshMirrored,
  refreshTtl,
} from "./refresh-store.js";

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

async function issueSession(claims: AccessClaims) {
  const accessToken = await signAccessToken(claims);
  const { raw, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + refreshTtl() * 1000);
  await prisma.refreshToken.create({
    data: { userId: claims.sub, tokenHash: hash, expiresAt },
  });
  await mirrorRefresh(hash, refreshTtl());
  return { accessToken, refreshToken: raw };
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
  organizationName: string;
}) {
  const email = input.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError("CONFLICT", "Email already registered", 409);

  const free = await prisma.plan.findUnique({ where: { code: "free" } });
  if (!free) throw new AppError("INTERNAL", "Free plan missing", 500);

  const passwordHash = await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, name: input.name },
    });
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug: slugify(input.organizationName),
        planId: free.id,
        seatLimit: free.seatLimit,
        shopLimit: free.shopLimit,
        dailyInviteQuota: free.dailyInviteQuota,
      },
    });
    await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    return { user, organization };
  });

  const session = await issueSession({
    sub: result.user.id,
    orgId: result.organization.id,
    role: "OWNER",
  });

  return {
    user: { id: result.user.id, email: result.user.email, name: result.user.name },
    organization: {
      id: result.organization.id,
      name: result.organization.name,
      slug: result.organization.slug,
    },
    ...session,
  };
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError("UNAUTHORIZED", "Invalid credentials", 401);
  }
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new AppError("FORBIDDEN", "No active organization", 403);

  const session = await issueSession({
    sub: user.id,
    orgId: membership.organizationId,
    role: membership.role,
  });
  return {
    user: { id: user.id, email: user.email, name: user.name },
    organizationId: membership.organizationId,
    ...session,
  };
}

export async function rotateRefresh(raw: string) {
  const hash = sha256(raw);
  if (!(await isRefreshMirrored(hash))) {
    throw new AppError("UNAUTHORIZED", "Invalid refresh token", 401);
  }
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError("UNAUTHORIZED", "Invalid refresh token", 401);
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: stored.userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new AppError("FORBIDDEN", "No active organization", 403);

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
  await revokeRefreshMirror(hash);

  return issueSession({
    sub: stored.userId,
    orgId: membership.organizationId,
    role: membership.role,
  });
}

export async function revokeRefresh(raw: string) {
  const hash = sha256(raw);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (stored && !stored.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
  }
  await revokeRefreshMirror(hash);
}

export async function getMe(userId: string, orgId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { organization: { include: { plan: true, subscription: true } } },
  });
  return {
    user: { id: user.id, email: user.email, name: user.name },
    currentOrganizationId: orgId,
    memberships: memberships.map((m) => ({
      role: m.role,
      organization: {
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        planCode: m.organization.plan.code,
        seatLimit: m.organization.seatLimit,
        shopLimit: m.organization.shopLimit,
        subscriptionStatus: m.organization.subscription?.status ?? null,
      },
    })),
  };
}
