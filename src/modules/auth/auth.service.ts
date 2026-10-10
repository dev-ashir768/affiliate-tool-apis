import type {
  MembershipRole,
  PlatformRole,
  PlatformMembershipStatus,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  generateRefreshToken,
  signAccessToken,
  type AccessClaims,
} from "../../lib/tokens.js";
import { subscriptionGrantsAccess } from "../../lib/entitlements.js";
import { sha256 } from "../../lib/crypto.js";
import { env } from "../../config/env.js";
import { portalBaseUrl } from "../../lib/portal-base-url.js";
import { logger } from "../../lib/logger.js";
import { writeAuditLog } from "../../lib/audit.js";
import { recordBillingLifecycleEvent } from "../../lib/billing-lifecycle.js";
import { notifyWelcomeEmail } from "../../lib/billing-emails.js";
import { sendPasswordResetEmail } from "../../lib/email.js";
import {
  mirrorRefresh,
  revokeRefreshMirror,
  refreshTtl,
  getRotationGrace,
  getRefreshSuccessor,
  setRefreshSuccessor,
  setRotationGrace,
} from "./refresh-store.js";
import {
  cleanupExpiredInviteStub,
  isExpiredInviteStub,
} from "../orgs/orgs.service.js";

function portalOrigin(): string {
  return portalBaseUrl();
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

function redirectFor(
  platformRole: AccessClaims["platformRole"],
  hasProductAccess: boolean,
): string {
  if (platformRole) return "/backoffice/users";
  return hasProductAccess ? "/home" : "/onboarding";
}

type PlatformMembershipSummary = {
  role: PlatformRole;
  status: PlatformMembershipStatus;
} | null;

async function resolveAccessClaims(
  userId: string,
  preferredOrgId?: string | null,
): Promise<{
  claims: AccessClaims;
  platformMembership: PlatformMembershipSummary;
}> {
  const platform = await prisma.platformMembership.findFirst({
    where: { userId, status: "ACTIVE" },
  });

  // Strict area isolation: platform staff sessions never carry org context.
  // Merchants never get platformRole. One account = one work area.
  if (platform) {
    return {
      claims: {
        sub: userId,
        orgId: null,
        orgRole: null,
        platformRole: platform.role as PlatformRole,
        hasProductAccess: false,
      },
      platformMembership: { role: platform.role, status: platform.status },
    };
  }

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

  if (!membership) {
    throw new AppError("FORBIDDEN", "No active organization", 403);
  }

  const org = await prisma.organization.findUnique({
    where: { id: membership.organizationId },
    include: { subscription: true },
  });

  return {
    claims: {
      sub: userId,
      orgId: membership.organizationId,
      orgRole: membership.role as MembershipRole,
      platformRole: null,
      hasProductAccess: subscriptionGrantsAccess(org?.subscription),
    },
    platformMembership: null,
  };
}

export async function issueSession(claims: AccessClaims) {
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
        botLimit: free.botLimit,
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

  await recordBillingLifecycleEvent({
    organizationId: result.organization.id,
    type: "REGISTERED",
    toPlanCode: "free",
    actorUserId: result.user.id,
    meta: { email: result.user.email },
  });

  void notifyWelcomeEmail({
    to: result.user.email,
    recipientName: result.user.name,
    organizationName: result.organization.name,
  });

  const session = await issueSession({
    sub: result.user.id,
    orgId: result.organization.id,
    orgRole: "OWNER",
    platformRole: null,
    hasProductAccess: false,
  });

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
    },
    organization: {
      id: result.organization.id,
      name: result.organization.name,
      slug: result.organization.slug,
    },
    platformMembership: null,
    redirectTo: redirectFor(null, false),
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

  void writeAuditLog({
    actorUserId: user.id,
    organizationId: claims.orgId,
    action: "auth.login",
    entityType: "User",
    entityId: user.id,
    meta: {
      platformRole: claims.platformRole,
      hasProductAccess: claims.hasProductAccess,
    },
  });

  return {
    user: { id: user.id, email: user.email, name: user.name },
    organizationId: claims.orgId,
    platformMembership,
    redirectTo: redirectFor(claims.platformRole, claims.hasProductAccess),
    ...session,
  };
}

/** Revoke every live refresh token for a user (disable, password reset, …). */
export async function revokeAllRefreshForUser(userId: string) {
  const live = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null },
    select: { tokenHash: true },
  });
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await Promise.all(live.map((t) => revokeRefreshMirror(t.tokenHash)));
}

const invalidRefresh = () =>
  new AppError("UNAUTHORIZED", "Invalid refresh token", 401);

async function waitForRotationGrace(hash: string) {
  // The concurrent winner claims the row before it stores the new pair.
  for (let i = 0; i < 10; i++) {
    const pair = await getRotationGrace(hash);
    if (pair) return pair;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * Old token reused after its rotation response was lost: re-issue the
 * successor while that successor is still live (never used, not revoked).
 * Logout / password reset / disable revoke the successor, so this stops too.
 */
async function recoverFromSuccessor(
  oldHash: string,
  hint?: { sub: string; orgId: string | null } | null,
) {
  const successorRaw = await getRefreshSuccessor(oldHash);
  if (!successorRaw) return null;
  const successorHash = sha256(successorRaw);
  const successor = await prisma.refreshToken.findUnique({
    where: { tokenHash: successorHash },
    include: { user: { select: { status: true } } },
  });
  if (
    !successor ||
    successor.revokedAt ||
    successor.expiresAt < new Date() ||
    successor.user.status === "DISABLED"
  ) {
    return null;
  }
  const preferredOrgId =
    hint && hint.sub === successor.userId ? hint.orgId : undefined;
  const { claims } = await resolveAccessClaims(successor.userId, preferredOrgId);
  return {
    accessToken: await signAccessToken(claims),
    refreshToken: successorRaw,
  };
}

/**
 * Rotate a refresh token. `hint` comes from the caller's (possibly expired)
 * access token and only steers which org the new session lands on.
 */
export async function rotateRefresh(
  raw: string,
  hint?: { sub: string; orgId: string | null } | null,
) {
  const hash = sha256(raw);

  const graced = await getRotationGrace(hash);
  if (graced) return graced;

  // The DB row (revokedAt / expiresAt) is the source of truth; the Redis
  // mirror can be lost on a Redis restart and must not log everyone out.
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: { user: { select: { status: true } } },
  });
  // Short hash prefix only — enough to correlate, never the token itself.
  const tokenRef = hash.slice(0, 8);
  if (!stored) {
    logger.warn("refresh rejected", { reason: "not_found", tokenRef });
    throw invalidRefresh();
  }
  if (stored.expiresAt < new Date()) {
    logger.warn("refresh rejected", {
      reason: "expired",
      tokenRef,
      userId: stored.userId,
      expiredAt: stored.expiresAt.toISOString(),
    });
    throw invalidRefresh();
  }
  if (stored.revokedAt) {
    const pair =
      (await waitForRotationGrace(hash)) ??
      (await recoverFromSuccessor(hash, hint));
    if (pair) {
      logger.info("refresh recovered after lost rotation", {
        tokenRef,
        userId: stored.userId,
      });
      return pair;
    }
    logger.warn("refresh rejected", {
      // Revoked with no live successor: logout, password reset, staff
      // change, or an old token whose successor was already used.
      reason: "revoked",
      tokenRef,
      userId: stored.userId,
      revokedSecondsAgo: Math.round(
        (Date.now() - stored.revokedAt.getTime()) / 1000,
      ),
    });
    throw invalidRefresh();
  }
  if (stored.user.status === "DISABLED") {
    logger.warn("refresh rejected", {
      reason: "user_disabled",
      tokenRef,
      userId: stored.userId,
    });
    await revokeAllRefreshForUser(stored.userId);
    throw new AppError("FORBIDDEN", "Account is disabled", 403);
  }

  const preferredOrgId =
    hint && hint.sub === stored.userId ? hint.orgId : undefined;
  const { claims } = await resolveAccessClaims(stored.userId, preferredOrgId);

  // Atomic claim — only one concurrent caller may mint the successor.
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count === 0) {
    const pair = await waitForRotationGrace(hash);
    if (pair) return pair;
    logger.warn("refresh rejected", {
      reason: "concurrent_claim_lost",
      tokenRef,
      userId: stored.userId,
    });
    throw invalidRefresh();
  }

  const session = await issueSession(claims);
  await setRotationGrace(hash, session);
  await setRefreshSuccessor(hash, session.refreshToken);
  await revokeRefreshMirror(hash);
  return session;
}

export async function revokeRefresh(raw: string) {
  const hash = sha256(raw);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
  });
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
  const platformMembership: PlatformMembershipSummary = platform
    ? { role: platform.role, status: platform.status }
    : null;

  // Staff sessions are isolated from merchant org work.
  if (platformMembership) {
    return {
      user: { id: user.id, email: user.email, name: user.name },
      currentOrganizationId: null,
      platformMembership,
      memberships: [],
      redirectTo: redirectFor(platformMembership.role, false),
    };
  }

  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { organization: { include: { plan: true, subscription: true } } },
  });

  return {
    user: { id: user.id, email: user.email, name: user.name },
    currentOrganizationId: orgId,
    platformMembership: null,
    memberships: memberships.map((m) => ({
      role: m.role,
      organization: {
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        planCode: m.organization.plan.code,
        seatLimit: m.organization.seatLimit,
        shopLimit: m.organization.shopLimit,
        botLimit: m.organization.botLimit,
        subscriptionStatus: m.organization.subscription?.status ?? null,
        hasProductAccess: subscriptionGrantsAccess(m.organization.subscription),
        currentPeriodEnd:
          m.organization.subscription?.currentPeriodEnd?.toISOString() ?? null,
      },
    })),
    redirectTo: redirectFor(
      null,
      orgId
        ? memberships.some(
            (m) =>
              m.organization.id === orgId &&
              subscriptionGrantsAccess(m.organization.subscription),
          )
        : memberships.some((m) =>
            subscriptionGrantsAccess(m.organization.subscription),
          ),
    ),
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

export async function resetPassword(input: {
  token: string;
  password: string;
}) {
  const tokenHash = sha256(input.token);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Invalid or expired reset token",
      400,
    );
  }

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    // Single-use: a concurrent reset with the same token loses here.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Invalid or expired reset token",
        400,
      );
    }
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: row.userId, usedAt: null, id: { not: row.id } },
      data: { usedAt: new Date() },
    });
  });
  // Also drops the Redis mirror so revoked sessions cannot rotate.
  await revokeAllRefreshForUser(row.userId);

  await writeAuditLog({
    actorUserId: row.userId,
    action: "auth.password_reset_completed",
    entityType: "User",
    entityId: row.userId,
  });

  return { ok: true as const };
}
