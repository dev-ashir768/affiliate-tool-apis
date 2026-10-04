import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { isManualSubscriptionId } from "../../lib/entitlements.js";
import { recordBillingLifecycleEvent } from "../../lib/billing-lifecycle.js";
import { writeAuditLog } from "../../lib/audit.js";
import type { BillingLifecycleType } from "../../lib/prisma-enums.js";
import { getOrganization } from "./platform.service.js";

export function manualSubscriptionId(organizationId: string) {
  return `manual_${organizationId}`;
}

export async function grantOrganizationAccess(
  organizationId: string,
  input: { planCode: string; currentPeriodEnd?: string | null; note?: string },
  actorUserId: string,
) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { plan: true, subscription: true },
  });
  if (!org) throw new AppError("NOT_FOUND", "Organization not found", 404);

  if (
    org.subscription &&
    !isManualSubscriptionId(org.subscription.stripeSubscriptionId) &&
    org.subscription.status !== "CANCELED"
  ) {
    throw new AppError(
      "CONFLICT",
      "Organization has a Stripe subscription; manage access in Stripe",
      409,
    );
  }

  const plan = await prisma.plan.findFirst({
    where: { code: input.planCode, active: true },
  });
  if (!plan || plan.code === "free") {
    throw new AppError("VALIDATION_ERROR", "Paid active plan required", 400);
  }

  let periodEnd: Date | null = null;
  if (input.currentPeriodEnd) {
    periodEnd = new Date(input.currentPeriodEnd);
    if (Number.isNaN(periodEnd.getTime()) || periodEnd.getTime() <= Date.now()) {
      throw new AppError(
        "VALIDATION_ERROR",
        "currentPeriodEnd must be a future datetime",
        400,
      );
    }
  }

  const subId = manualSubscriptionId(organizationId);
  const prevPlan = org.plan.code;
  const prevCents = org.plan.monthlyPriceCents;
  const hadManual = Boolean(org.subscription);

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        planId: plan.id,
        seatLimit: plan.seatLimit,
        shopLimit: plan.shopLimit,
        botLimit: plan.botLimit,
        dailyInviteQuota: plan.dailyInviteQuota,
      },
    });
    await tx.subscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        stripeSubscriptionId: subId,
        status: "ACTIVE",
        currentPeriodEnd: periodEnd,
      },
      update: {
        stripeSubscriptionId: subId,
        status: "ACTIVE",
        currentPeriodEnd: periodEnd,
      },
    });
  });

  const planChanged = plan.code !== prevPlan;
  const lifecycleType: BillingLifecycleType = !hadManual
    ? "SUBSCRIBED"
    : plan.monthlyPriceCents >= prevCents
      ? "UPGRADED"
      : "DOWNGRADED";

  if (!hadManual || planChanged) {
    await recordBillingLifecycleEvent({
      organizationId,
      type: lifecycleType,
      fromPlanCode: prevPlan,
      toPlanCode: plan.code,
      actorUserId,
      periodEnd: periodEnd?.toISOString() ?? null,
      silent: true,
      meta: { source: "manual_grant", note: input.note ?? null },
    });
  }

  await writeAuditLog({
    actorUserId,
    organizationId,
    action: "organization.grant_access",
    entityType: "Organization",
    entityId: organizationId,
    meta: {
      planCode: plan.code,
      currentPeriodEnd: periodEnd?.toISOString() ?? null,
      note: input.note ?? null,
    },
  });

  return getOrganization(organizationId);
}

export async function revokeOrganizationAccess(
  organizationId: string,
  input: { note?: string },
  actorUserId: string,
) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { plan: true, subscription: true },
  });
  if (!org) throw new AppError("NOT_FOUND", "Organization not found", 404);
  if (
    !org.subscription ||
    !isManualSubscriptionId(org.subscription.stripeSubscriptionId)
  ) {
    throw new AppError("CONFLICT", "No manual grant to revoke", 409);
  }

  const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
  const fromPlan = org.plan.code;

  await prisma.$transaction(async (tx) => {
    await tx.subscription.delete({ where: { organizationId } });
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        planId: free.id,
        seatLimit: free.seatLimit,
        shopLimit: free.shopLimit,
        botLimit: free.botLimit,
        dailyInviteQuota: free.dailyInviteQuota,
      },
    });
  });

  await recordBillingLifecycleEvent({
    organizationId,
    type: "CANCELED",
    fromPlanCode: fromPlan,
    toPlanCode: "free",
    actorUserId,
    silent: true,
    meta: { source: "manual_revoke", note: input.note ?? null },
  });

  await writeAuditLog({
    actorUserId,
    organizationId,
    action: "organization.revoke_access",
    entityType: "Organization",
    entityId: organizationId,
    meta: { note: input.note ?? null, fromPlanCode: fromPlan },
  });

  return getOrganization(organizationId);
}
