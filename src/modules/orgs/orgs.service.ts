import { randomBytes } from "node:crypto";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { sha256 } from "../../lib/crypto.js";
import { hashPassword } from "../../lib/password.js";
import { env } from "../../config/env.js";

const INVITE_STUB_NAME = "Invited";

function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256(raw) };
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

  const seats = await countSeats(input.organizationId);
  if (seats >= org.seatLimit) {
    throw new AppError("PLAN_LIMIT", "Seat limit reached", 403);
  }

  let user = await prisma.user.findUnique({ where: { email } });
  let createdStub = false;
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
        name: INVITE_STUB_NAME,
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
  if (existing?.status === "INVITED") {
    if (createdStub) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
    throw new AppError("CONFLICT", "User already invited", 409);
  }

  const { raw, hash } = generateInviteToken();
  const inviteExpiresAt = new Date(Date.now() + env.INVITE_TTL_SEC * 1000);

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

  if (input.actorUserId) {
    if (input.actorUserId !== membership.userId) {
      throw new AppError(
        "FORBIDDEN",
        "Authenticated user does not match invite email",
        403
      );
    }
  } else if (membership.user.name === INVITE_STUB_NAME) {
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
