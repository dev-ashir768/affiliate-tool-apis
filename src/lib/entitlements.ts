import type { Subscription, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";

const ACCESS_STATUSES: SubscriptionStatus[] = [
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
];

export function subscriptionGrantsAccess(
  subscription: Pick<Subscription, "status" | "currentPeriodEnd"> | null | undefined,
): boolean {
  if (!subscription) return false;
  if (!ACCESS_STATUSES.includes(subscription.status)) return false;
  // If Stripe ended the period and status wasn't refreshed yet, deny.
  if (
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd.getTime() < Date.now() &&
    subscription.status !== "ACTIVE" &&
    subscription.status !== "TRIALING"
  ) {
    return false;
  }
  return true;
}

export async function getOrganizationBillingState(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: {
      plan: true,
      subscription: true,
    },
  });

  const hasProductAccess = subscriptionGrantsAccess(org.subscription);
  return {
    organization: org,
    plan: org.plan,
    subscription: org.subscription,
    hasProductAccess,
  };
}

/** Throws 402 if org cannot use paid product features. */
export async function assertProductAccess(organizationId: string) {
  const state = await getOrganizationBillingState(organizationId);
  if (!state.hasProductAccess) {
    throw new AppError(
      "PAYMENT_REQUIRED",
      "An active subscription is required. Choose a plan to continue.",
      402,
    );
  }
  return state;
}

export async function countOrgReservedBots(organizationId: string) {
  return prisma.botIdentity.count({
    where: {
      reservedForOrgId: organizationId,
      status: { in: ["RESERVED", "ASSIGNED"] },
    },
  });
}

export async function assertBotCapacity(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { botLimit: true },
  });
  const used = await countOrgReservedBots(organizationId);
  if (used >= org.botLimit) {
    throw new AppError(
      "PLAN_LIMIT",
      `Bot limit reached (${org.botLimit}). Upgrade your plan for more bots.`,
      403,
    );
  }
}
