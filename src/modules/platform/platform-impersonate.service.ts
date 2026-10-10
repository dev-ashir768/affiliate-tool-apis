import type { MembershipRole } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { subscriptionGrantsAccess } from "../../lib/entitlements.js";
import { issueSession } from "../auth/auth.service.js";

/**
 * Staff support: mint a normal merchant session for a target user.
 * Actor is recorded in audit; JWT `sub` is the target (API calls act as that user).
 */
export async function impersonateOrganizationMember(input: {
  actorUserId: string;
  targetUserId: string;
  organizationId: string;
}) {
  if (input.actorUserId === input.targetUserId) {
    throw new AppError("VALIDATION_ERROR", "Cannot impersonate yourself", 400);
  }

  const target = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true, email: true, name: true, status: true },
  });
  if (!target || target.status !== "ACTIVE") {
    throw new AppError("NOT_FOUND", "User not found", 404);
  }

  const staffMembership = await prisma.platformMembership.findFirst({
    where: { userId: input.targetUserId, status: "ACTIVE" },
  });
  if (staffMembership) {
    throw new AppError(
      "FORBIDDEN",
      "Cannot impersonate platform staff accounts",
      403,
    );
  }

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
    action: "auth.impersonate",
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
