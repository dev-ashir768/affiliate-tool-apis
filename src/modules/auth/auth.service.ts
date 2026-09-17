import type { MembershipRole, PlatformRole, PlatformMembershipStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  generateRefreshToken,
  signAccessToken,
  type AccessClaims,
} from "../../lib/tokens.js";
import { sha256 } from "../../lib/crypto.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { writeAuditLog } from "../../lib/audit.js";
import { sendPasswordResetEmail } from "../../lib/email.js";
import {
  mirrorRefresh,
  revokeRefreshMirror,
  isRefreshMirrored,
  refreshTtl,
} from "./refresh-store.js";
import {
  cleanupExpiredInviteStub,
  isExpiredInviteStub,
} from "../orgs/orgs.service.js";

function portalOrigin(): string {
  const origin = env.CORS_ORIGINS.split(",")[0]?.trim() || "http://localhost:3000";
  return origin.replace(/\/$/, "");
}

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

function redirectFor(platformRole: AccessClaims["platformRole"]): string {
  return platformRole ? "/backoffice/users" : "/home";
}

type PlatformMembershipSummary = {
  role: PlatformRole;
  status: PlatformMembershipStatus;
} | null;

async function resolveAccessClaims(
  userId: string,
  preferredOrgId?: string | null
): Promise<{
  claims: AccessClaims;
  platformMembership: PlatformMembershipSummary;
}> {
  const platform = await prisma.platformMembership.findFirst({
    where: { userId, status: "ACTIVE" },
  });

  let membership =
    preferredOrgId != null
      ? await prisma.membership.findFirst({
          where: {
            userId,
            organizationId: preferredOrgId,
            status: "ACTIVE",
          },
        })
      : null;

  if (!membership) {
    membership = await prisma.membership.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
  }

  if (!platform && !membership) {
    throw new AppError("FORBIDDEN", "No active organization", 403);
  }

  const claims: AccessClaims = {
    sub: userId,
    orgId: membership?.organizationId ?? null,
    orgRole: (membership?.role as MembershipRole | undefined) ?? null,
    platformRole: (platform?.role as PlatformRole | undefined) ?? null,
  };

  return {
    claims,
    platformMembership: platform
      ? { role: platform.role, status: platform.status }
      : null,
  };
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
  if (existing) {
    // Expired invite stub must not permanently brick the email
    if (await isExpiredInviteStub(existing.id)) {
      await cleanupExpiredInviteStub(existing.id);
    } else {
      throw new AppError("CONFLICT", "Email already registered", 409);
    }
  }

  const free = await prisma.plan.findUnique({ where: { code: "free" } });
  if (!free) throw new AppError("INTERNAL", "Free plan missing", 500);

  const passwordHash = await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, name: input.name, status: "ACTIVE" },
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
    orgRole: "OWNER",
    platformRole: null,
  });

  return {
    user: { id: result.user.id, email: result.user.email, name: result.user.name },
    organization: {
      id: result.organization.id,
      name: result.organization.name,
      slug: result.organization.slug,
    },
    platformMembership: null,
    redirectTo: redirectFor(null),
    ...session,
  };
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError("UNAUTHORIZED", "Invalid credentials", 401);
  }
  if (user.status === "DISABLED") {
    throw new AppError("FORBIDDEN", "Account is disabled", 403);
  }

  const { claims, platformMembership } = await resolveAccessClaims(user.id);
  const session = await issueSession(claims);
  return {
    user: { id: user.id, email: user.email, name: user.name },
    organizationId: claims.orgId,
    platformMembership,
    redirectTo: redirectFor(claims.platformRole),
    ...session,
  };
}

export async function rotateRefresh(raw: string, preferredOrgId?: string | null) {
  const hash = sha256(raw);
  if (!(await isRefreshMirrored(hash))) {
    throw new AppError("UNAUTHORIZED", "Invalid refresh token", 401);
  }
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError("UNAUTHORIZED", "Invalid refresh token", 401);
  }

  const { claims } = await resolveAccessClaims(stored.userId, preferredOrgId);

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
  await revokeRefreshMirror(hash);

  return issueSession(claims);
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

export async function getMe(userId: string, orgId: string | null) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const platform = await prisma.platformMembership.findFirst({
    where: { userId, status: "ACTIVE" },
  });
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { organization: { include: { plan: true, subscription: true } } },
  });
  const platformMembership: PlatformMembershipSummary = platform
    ? { role: platform.role, status: platform.status }
    : null;
  return {
    user: { id: user.id, email: user.email, name: user.name },
    currentOrganizationId: orgId,
    platformMembership,
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
    redirectTo: redirectFor(platformMembership?.role ?? null),
  };
}

export async function requestPasswordReset(input: { email: string }) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  // Always succeed to avoid email enumeration
  if (!user || user.status !== "ACTIVE") {
    return { ok: true as const };
  }

  const raw = randomBytes(32).toString("base64url");
  const tokenHash = sha256(raw);
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_SEC * 1000);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const resetUrl = `${portalOrigin()}/reset-password?token=${raw}`;

  await sendPasswordResetEmail({
    to: user.email,
    resetUrl,
    expiresMinutes: Math.round(env.PASSWORD_RESET_TTL_SEC / 60),
    recipientName: user.name !== "Invited" ? user.name : undefined,
  });

  logger.info("password reset requested", {
    userId: user.id,
    email: user.email,
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "auth.password_reset_requested",
    entityType: "User",
    entityId: user.id,
  });

  return {
    ok: true as const,
    /** Dev/test only — never rely on this in production clients */
    ...(env.NODE_ENV !== "production" ? { resetUrl, token: raw } : {}),
  };
}

export async function resetPassword(input: { token: string; password: string }) {
  const tokenHash = sha256(input.token);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError("VALIDATION_ERROR", "Invalid or expired reset token", 400);
  }

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    });
    await tx.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: row.userId, usedAt: null, id: { not: row.id } },
      data: { usedAt: new Date() },
    });
    await tx.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  await writeAuditLog({
    actorUserId: row.userId,
    action: "auth.password_reset_completed",
    entityType: "User",
    entityId: row.userId,
  });

  return { ok: true as const };
}
