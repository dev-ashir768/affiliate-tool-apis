import { randomBytes } from "node:crypto";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { sha256 } from "../../lib/crypto.js";
import { hashPassword } from "../../lib/password.js";
import { env } from "../../config/env.js";
import { sendOrgInviteEmail } from "../../lib/email.js";

function portalOrigin(): string {
  const origin =
    env.CORS_ORIGINS.split(",")[0]?.trim() || "http://localhost:3000";
  return origin.replace(/\/$/, "");
}

async function notifyOrgInvite(input: {
  email: string;
  inviteToken: string;
  organizationName: string;
  role: string;
}) {
  const inviteUrl = `${portalOrigin()}/invite/${input.inviteToken}`;
  await sendOrgInviteEmail({
    to: input.email,
    inviteUrl,
    organizationName: input.organizationName,
    role: input.role,
  });
}

function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256(raw) };
}

function isInviteExpired(inviteExpiresAt: Date | null): boolean {
  return !!inviteExpiresAt && inviteExpiresAt < new Date();
}

/**
 * Invite stub: user has never activated (no ACTIVE memberships) and only
 * exists via INVITED memberships with an invite token. Do not use display name.
 */
export async function isInviteStubUser(userId: string): Promise<boolean> {
  const activeCount = await prisma.membership.count({
    where: { userId, status: "ACTIVE" },
  });
  if (activeCount > 0) return false;

  const invitedWithToken = await prisma.membership.count({
    where: {
      userId,
      status: "INVITED",
      inviteTokenHash: { not: null },
    },
  });
  return invitedWithToken > 0;
}

/** True when the user is an invite stub with no non-expired invites left. */
export async function isExpiredInviteStub(userId: string): Promise<boolean> {
  if (!(await isInviteStubUser(userId))) return false;

  const liveInvite = await prisma.membership.findFirst({
    where: {
      userId,
      status: "INVITED",
      inviteTokenHash: { not: null },
      OR: [{ inviteExpiresAt: null }, { inviteExpiresAt: { gt: new Date() } }],
    },
  });
  return !liveInvite;
}

/** Delete INVITED memberships and the stub user row. */
export async function cleanupExpiredInviteStub(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.membership.deleteMany({
      where: { userId, status: "INVITED" },
    });
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });
}

async function countSeats(organizationId: string): Promise<number> {
  return prisma.membership.count({
    where: {
      organizationId,
      status: { in: ["ACTIVE", "INVITED"] },
    },
  });
}

export async function getCurrent(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { plan: true, subscription: true },
  });
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    seatLimit: org.seatLimit,
    shopLimit: org.shopLimit,
    dailyInviteQuota: org.dailyInviteQuota,
    plan: {
      id: org.plan.id,
      code: org.plan.code,
      name: org.plan.name,
    },
    subscriptionStatus: org.subscription?.status ?? null,
  };
}

export async function patchCurrent(
  organizationId: string,
  input: { name: string }
) {
  const org = await prisma.organization.update({
    where: { id: organizationId },
    data: { name: input.name },
    include: { plan: true, subscription: true },
  });
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    seatLimit: org.seatLimit,
    shopLimit: org.shopLimit,
    dailyInviteQuota: org.dailyInviteQuota,
    plan: {
      id: org.plan.id,
      code: org.plan.code,
      name: org.plan.name,
    },
    subscriptionStatus: org.subscription?.status ?? null,
  };
}

export async function listMembers(organizationId: string) {
  const members = await prisma.membership.findMany({
    where: { organizationId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({
    id: m.id,
    role: m.role,
    status: m.status,
    user: {
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
    },
  }));
}

export async function createInvite(input: {
  organizationId: string;
  actorUserId: string;
  email: string;
  role: Exclude<MembershipRole, "OWNER">;
}) {
  const email = input.email.toLowerCase().trim();
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
  });

  let user = await prisma.user.findUnique({ where: { email } });
  let createdStub = false;

  // Expired invite stub from another path: reuse email by cleaning up first
  if (user && (await isExpiredInviteStub(user.id))) {
    await cleanupExpiredInviteStub(user.id);
    user = null;
  }

  if (!user) {
    const seats = await countSeats(input.organizationId);
    if (seats >= org.seatLimit) {
      throw new AppError("PLAN_LIMIT", "Seat limit reached", 403);
    }
    user = await prisma.user.create({
      data: {
        email,
        // Random unusable hash — stub identity is membership INVITED+token, not name
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
        name: "Invited",
      },
    });
    createdStub = true;
  }

  const existing = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: input.organizationId,
      },
    },
  });
  if (existing?.status === "ACTIVE") {
    if (createdStub) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
    throw new AppError("CONFLICT", "User is already a member", 409);
  }

  const { raw, hash } = generateInviteToken();
  const inviteExpiresAt = new Date(Date.now() + env.INVITE_TTL_SEC * 1000);

  // Re-invite: rotate token + extend expiry when prior invite expired
  if (existing?.status === "INVITED") {
    if (!isInviteExpired(existing.inviteExpiresAt)) {
      if (createdStub) {
        await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      }
      throw new AppError("CONFLICT", "User already invited", 409);
    }

    const membership = await prisma.membership.update({
      where: { id: existing.id },
      data: {
        role: input.role,
        status: "INVITED",
        inviteTokenHash: hash,
        inviteExpiresAt,
      },
    });

    await notifyOrgInvite({
      email,
      inviteToken: raw,
      organizationName: org.name,
      role: input.role,
    });

    return {
      inviteToken: raw,
      membership: {
        id: membership.id,
        role: membership.role,
        status: membership.status,
        email,
        inviteExpiresAt: membership.inviteExpiresAt,
      },
    };
  }

  // New membership — seat check (re-invite of expired does not consume an extra seat)
  if (!createdStub) {
    const seats = await countSeats(input.organizationId);
    if (seats >= org.seatLimit) {
      throw new AppError("PLAN_LIMIT", "Seat limit reached", 403);
    }
  }

  const membership = existing
    ? await prisma.membership.update({
        where: { id: existing.id },
        data: {
          role: input.role,
          status: "INVITED",
          inviteTokenHash: hash,
          inviteExpiresAt,
        },
      })
    : await prisma.membership.create({
        data: {
          userId: user.id,
          organizationId: input.organizationId,
          role: input.role,
          status: "INVITED",
          inviteTokenHash: hash,
          inviteExpiresAt,
        },
      });

  await notifyOrgInvite({
    email,
    inviteToken: raw,
    organizationName: org.name,
    role: input.role,
  });

  return {
    inviteToken: raw,
    membership: {
      id: membership.id,
      role: membership.role,
      status: membership.status,
      email,
      inviteExpiresAt: membership.inviteExpiresAt,
    },
  };
}

export async function acceptInvite(input: {
  token: string;
  password?: string;
  name?: string;
  actorUserId?: string;
}) {
  const hash = sha256(input.token);
  const membership = await prisma.membership.findFirst({
    where: { inviteTokenHash: hash, status: "INVITED" },
    include: { user: true },
  });
  if (!membership) {
    throw new AppError("NOT_FOUND", "Invite not found", 404);
  }
  if (membership.inviteExpiresAt && membership.inviteExpiresAt < new Date()) {
    throw new AppError("FORBIDDEN", "Invite expired", 403);
  }

  const stub = await isInviteStubUser(membership.userId);

  if (input.actorUserId) {
    if (input.actorUserId !== membership.userId) {
      throw new AppError(
        "FORBIDDEN",
        "Authenticated user does not match invite email",
        403
      );
    }
  } else if (stub) {
    if (!input.password || !input.name) {
      throw new AppError(
        "VALIDATION_ERROR",
        "password and name are required for new users",
        400
      );
    }
    await prisma.user.update({
      where: { id: membership.userId },
      data: {
        passwordHash: await hashPassword(input.password),
        name: input.name,
      },
    });
  } else {
    throw new AppError(
      "UNAUTHORIZED",
      "Authentication required to accept invite",
      401
    );
  }

  const updated = await prisma.membership.update({
    where: { id: membership.id },
    data: {
      status: "ACTIVE",
      inviteTokenHash: null,
      inviteExpiresAt: null,
    },
    include: { user: true, organization: true },
  });

  return {
    membership: {
      id: updated.id,
      role: updated.role,
      status: updated.status,
      organizationId: updated.organizationId,
    },
    user: {
      id: updated.user.id,
      email: updated.user.email,
      name: updated.user.name,
    },
  };
}
