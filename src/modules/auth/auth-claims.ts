import type {
  MembershipRole,
  PlatformRole,
  PlatformMembershipStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { subscriptionGrantsAccess } from "../../lib/entitlements.js";
import type { AccessClaims } from "../../lib/tokens.js";

export function redirectFor(
  platformRole: AccessClaims["platformRole"],
  hasProductAccess: boolean,
): string {
  if (platformRole) return "/backoffice/users";
  return hasProductAccess ? "/home" : "/onboarding";
}

export type PlatformMembershipSummary = {
  role: PlatformRole;
  status: PlatformMembershipStatus;
} | null;

export async function resolveAccessClaims(
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
