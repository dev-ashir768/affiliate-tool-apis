import type { MembershipRole } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { subscriptionGrantsAccess } from "../../lib/entitlements.js";
import { issueSession } from "../auth/auth.service.js";

export async function assertBreakGlassTarget(targetUserId: string) {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, name: true, status: true },
  });
  if (!target || target.status !== "ACTIVE") {
    throw new AppError("NOT_FOUND", "User not found", 404);
  }

  const staffMembership = await prisma.platformMembership.findFirst({
    where: { userId: targetUserId, status: "ACTIVE" },
  });
  if (staffMembership) {
    throw new AppError(
      "FORBIDDEN",
      "Cannot impersonate platform staff accounts",
      403,
    );
  }

  return { id: target.id, email: target.email, name: target.name };
}

/** First ACTIVE org membership for break-glass (v1: no org picker). */
export async function firstActiveMembershipOrgId(userId: string): Promise<string> {
  const membership = await prisma.membership.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!membership) {
    throw new AppError(
      "FORBIDDEN",
      "User is not an active member of any organization",
      403,
    );
  }
  return membership.organizationId;
}

/**
 * Staff support: mint a normal merchant session for a target user.
 * JWT `sub` is the target; actor is recorded in audit.
 */
export async function mintMerchantSessionForTarget(input: {
  actorUserId: string;
  targetUserId: string;
  organizationId: string;
  auditAction: "auth.impersonate" | "auth.break_glass";
}) {
  if (input.actorUserId === input.targetUserId) {
    throw new AppError("VALIDATION_ERROR", "Cannot impersonate yourself", 400);
  }

  const target = await assertBreakGlassTarget(input.targetUserId);

  const membership = await prisma.membership.findFirst({
    where: {
      userId: input.targetUserId,
      organizationId: input.organizationId,
      status: "ACTIVE",
    },
  });
  if (!membership) {
    throw new AppError(
      "FORBIDDEN",
      "User is not an active member of this organization",
      403,
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    include: { subscription: true },
  });
  if (!org) throw new AppError("NOT_FOUND", "Organization not found", 404);

  const hasProductAccess = subscriptionGrantsAccess(org.subscription);
  const tokens = await issueSession({
    sub: target.id,
    orgId: org.id,
    orgRole: membership.role as MembershipRole,
    platformRole: null,
    hasProductAccess,
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    organizationId: org.id,
    action: input.auditAction,
    entityType: "User",
    entityId: target.id,
    meta: {
      targetUserId: target.id,
      targetEmail: target.email,
      organizationId: org.id,
    },
  });

  return {
    user: { id: target.id, email: target.email, name: target.name },
    organizationId: org.id,
    redirectTo: hasProductAccess ? "/home" : "/onboarding",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}
