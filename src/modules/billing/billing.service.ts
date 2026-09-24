import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getStripe, portalBaseUrl } from "./stripe.js";
import {
  getOrganizationBillingState,
  getOrganizationUsage,
  planChangeBlockers,
  subscriptionGrantsAccess,
} from "../../lib/entitlements.js";
import { writeAuditLog } from "../../lib/audit.js";
import { recordBillingLifecycleEvent } from "../../lib/billing-lifecycle.js";

export async function listPlans(opts: { includePrivate?: boolean } = {}) {
  const plans = await prisma.plan.findMany({
    where: opts.includePrivate
      ? undefined
      : { isPublic: true, active: true },
    orderBy: [{ sortOrder: "asc" }, { monthlyPriceCents: "asc" }],
  });
  return plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    monthlyPriceCents: p.monthlyPriceCents,
    seatLimit: p.seatLimit,
    shopLimit: p.shopLimit,
    botLimit: p.botLimit,
    dailyInviteQuota: p.dailyInviteQuota,
    trialDays: p.trialDays,
    isPublic: p.isPublic,
    active: p.active,
    sortOrder: p.sortOrder,
    hasStripePrice: Boolean(p.stripePriceId),
  }));
}

export async function listPlansForPlatform() {
  const plans = await prisma.plan.findMany({
    orderBy: [{ sortOrder: "asc" }, { monthlyPriceCents: "asc" }],
  });
  return plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    monthlyPriceCents: p.monthlyPriceCents,
    seatLimit: p.seatLimit,
    shopLimit: p.shopLimit,
    botLimit: p.botLimit,
    dailyInviteQuota: p.dailyInviteQuota,
    trialDays: p.trialDays,
    isPublic: p.isPublic,
    active: p.active,
    sortOrder: p.sortOrder,
    stripePriceId: p.stripePriceId,
    hasStripePrice: Boolean(p.stripePriceId),
  }));
}

export async function getBillingOverview(organizationId: string) {
  const state = await getOrganizationBillingState(organizationId);
  const [plans, usage] = await Promise.all([
    listPlans(),
    getOrganizationUsage(organizationId),
  ]);

  const currentCents = state.plan.monthlyPriceCents;
  const hasPaidAccess = subscriptionGrantsAccess(state.subscription);

  const planOptions = plans
    .filter((p) => p.code !== "free")
    .map((p) => {
      const blockers = planChangeBlockers(usage, p);
      let changeKind: "current" | "upgrade" | "downgrade" | "subscribe" =
        "subscribe";
      if (p.code === state.plan.code && hasPaidAccess) {
        changeKind = "current";
      } else if (hasPaidAccess) {
        changeKind =
          p.monthlyPriceCents >= currentCents ? "upgrade" : "downgrade";
      }
      return {
        ...p,
        changeKind,
        canSwitch:
          changeKind !== "current" &&
          p.hasStripePrice &&
          (changeKind !== "downgrade" || blockers.length === 0),
        blockers,
      };
    });

  const overage = {
    seats: Math.max(0, usage.seats - state.organization.seatLimit),
    shops: Math.max(0, usage.shops - state.organization.shopLimit),
    bots: Math.max(0, usage.bots - state.organization.botLimit),
  };

  return {
    hasProductAccess: state.hasProductAccess,
    subscription: state.subscription
      ? {
          status: state.subscription.status,
          currentPeriodEnd:
            state.subscription.currentPeriodEnd?.toISOString() ?? null,
          stripeSubscriptionId: state.subscription.stripeSubscriptionId,
        }
      : null,
    organization: {
      id: state.organization.id,
      planCode: state.plan.code,
      planName: state.plan.name,
      seatLimit: state.organization.seatLimit,
      shopLimit: state.organization.shopLimit,
      botLimit: state.organization.botLimit,
      dailyInviteQuota: state.organization.dailyInviteQuota,
      stripeCustomerId: state.organization.stripeCustomerId,
    },
    usage,
    overage,
    hasOverage: overage.seats > 0 || overage.shops > 0 || overage.bots > 0,
    plans: planOptions,
    rules: {
      upgrade:
        "Upgrade anytime. Stripe prorates the difference and higher limits apply immediately.",
      downgrade:
        "Downgrade only when seats, shops, and bots fit the target plan. Remove extras first, then switch. Limits apply immediately after the change; new adds are blocked at the new caps.",
      cancel:
        "Cancel via Stripe Customer Portal. Access continues until period end, then the org returns to free limits.",
      effects: [
        "Team seats (OWNER/ADMIN/MEMBER + pending invites)",
        "Connected TikTok shops",
        "Reserved verify bots",
        "Daily invite quota",
      ],
    },
  };
}

export async function createCheckoutSession(input: {
  organizationId: string;
  planCode: string;
  actorEmail: string;
  actorUserId?: string;
}) {
  const plan = await prisma.plan.findUnique({
    where: { code: input.planCode },
  });
  if (!plan || !plan.active) {
    throw new AppError("NOT_FOUND", "Plan not found", 404);
  }
  if (!plan.stripePriceId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Plan is not available for checkout (missing Stripe price). Contact support.",
      400,
    );
  }
  if (plan.code === "free") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Free plan does not require checkout",
      400,
    );
  }

  const state = await getOrganizationBillingState(input.organizationId);
  const org = state.organization;

  if (
    state.subscription &&
    subscriptionGrantsAccess(state.subscription) &&
    state.subscription.stripeSubscriptionId
  ) {
    return changeSubscriptionPlan({
      organizationId: org.id,
      stripeSubscriptionId: state.subscription.stripeSubscriptionId,
      plan,
      actorUserId: input.actorUserId,
    });
  }

  const stripe = getStripe();
  const base = portalBaseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: org.stripeCustomerId ?? undefined,
    customer_email: org.stripeCustomerId ? undefined : input.actorEmail,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: state.hasProductAccess
      ? `${base}/billing?canceled=1`
      : `${base}/onboarding?canceled=1`,
    metadata: {
      organizationId: org.id,
      planCode: plan.code,
    },
    client_reference_id: org.id,
    subscription_data: {
      metadata: { organizationId: org.id, planCode: plan.code },
      ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
    },
    allow_promotion_codes: true,
  });

  if (input.actorUserId) {
    await writeAuditLog({
      actorUserId: input.actorUserId,
      organizationId: org.id,
      action: "billing.checkout.start",
      entityType: "Organization",
      entityId: org.id,
      meta: { planCode: plan.code },
    });
  }

  return {
    url: session.url,
    id: session.id,
    mode: "checkout" as const,
  };
}

async function changeSubscriptionPlan(input: {
  organizationId: string;
  stripeSubscriptionId: string;
  plan: {
    code: string;
    stripePriceId: string | null;
    id: string;
    seatLimit: number;
    shopLimit: number;
    botLimit: number;
    dailyInviteQuota: number;
    monthlyPriceCents?: number;
  };
  actorUserId?: string;
}) {
  if (!input.plan.stripePriceId) {
    throw new AppError("VALIDATION_ERROR", "Plan missing Stripe price", 400);
  }

  const before = await prisma.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
    include: { plan: true },
  });

  const toCents =
    input.plan.monthlyPriceCents ??
    (
      await prisma.plan.findUnique({ where: { id: input.plan.id } })
    )?.monthlyPriceCents ??
    0;
  const isDowngrade = toCents < before.plan.monthlyPriceCents;

  if (isDowngrade) {
    const usage = await getOrganizationUsage(input.organizationId);
    const blockers = planChangeBlockers(usage, input.plan);
    if (blockers.length > 0) {
      const detail = blockers
        .map((b) => `${b.resource}: using ${b.used}, plan allows ${b.limit}`)
        .join("; ");
      throw new AppError(
        "PLAN_LIMIT",
        `Cannot downgrade until usage fits the target plan (${detail}). Remove seats, shops, or bots first.`,
        403,
      );
    }
  }

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(input.stripeSubscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) {
    throw new AppError("FAILED_PRECONDITION", "Subscription has no items", 400);
  }

  const updated = await stripe.subscriptions.update(
    input.stripeSubscriptionId,
    {
      items: [{ id: itemId, price: input.plan.stripePriceId }],
      proration_behavior: "create_prorations",
      metadata: {
        organizationId: input.organizationId,
        planCode: input.plan.code,
      },
    },
  );

  await prisma.organization.update({
    where: { id: input.organizationId },
    data: {
      planId: input.plan.id,
      seatLimit: input.plan.seatLimit,
      shopLimit: input.plan.shopLimit,
      botLimit: input.plan.botLimit,
      dailyInviteQuota: input.plan.dailyInviteQuota,
    },
  });

  const type = isDowngrade ? "DOWNGRADED" : "UPGRADED";

  await recordBillingLifecycleEvent({
    organizationId: input.organizationId,
    type,
    fromPlanCode: before.plan.code,
    toPlanCode: input.plan.code,
    actorUserId: input.actorUserId,
    meta: {
      source: "api.plan_change",
      fromCents: before.plan.monthlyPriceCents,
      toCents,
      stripeStatus: updated.status,
    },
  });

  if (input.actorUserId) {
    await writeAuditLog({
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      action: isDowngrade
        ? "billing.subscription.downgrade"
        : "billing.subscription.upgrade",
      entityType: "Organization",
      entityId: input.organizationId,
      meta: {
        fromPlanCode: before.plan.code,
        planCode: input.plan.code,
        stripeStatus: updated.status,
      },
    });
  }

  const base = portalBaseUrl();
  return {
    url: `${base}/billing/success?${isDowngrade ? "downgraded" : "upgraded"}=1`,
    id: updated.id,
    mode: (isDowngrade ? "downgrade" : "upgrade") as "upgrade" | "downgrade",
  };
}

export async function createPortalSession(input: { organizationId: string }) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
  });
  if (!org.stripeCustomerId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Organization has no Stripe customer — subscribe first",
      400,
    );
  }

  const stripe = getStripe();
  const base = portalBaseUrl();
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${base}/billing`,
  });

  return { url: session.url };
}

/** Platform ops: update plan pricing / limits (Stripe price id set after Dashboard create). */
export async function patchPlan(
  planId: string,
  input: {
    name?: string;
    description?: string | null;
    monthlyPriceCents?: number;
    seatLimit?: number;
    shopLimit?: number;
    botLimit?: number;
    dailyInviteQuota?: number;
    trialDays?: number;
    stripePriceId?: string | null;
    isPublic?: boolean;
    active?: boolean;
    sortOrder?: number;
  },
  actorUserId?: string,
) {
  const existing = await prisma.plan.findUnique({ where: { id: planId } });
  if (!existing) throw new AppError("NOT_FOUND", "Plan not found", 404);
  if (existing.code === "free" && input.active === false) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Cannot deactivate the free plan",
      400,
    );
  }

  const plan = await prisma.plan.update({
    where: { id: planId },
    data: {
      name: input.name,
      description:
        input.description === undefined ? undefined : input.description,
      monthlyPriceCents: input.monthlyPriceCents,
      seatLimit: input.seatLimit,
      shopLimit: input.shopLimit,
      botLimit: input.botLimit,
      dailyInviteQuota: input.dailyInviteQuota,
      trialDays: input.trialDays,
      stripePriceId:
        input.stripePriceId === undefined ? undefined : input.stripePriceId,
      isPublic: input.isPublic,
      active: input.active,
      sortOrder: input.sortOrder,
    },
  });

  if (actorUserId) {
    await writeAuditLog({
      actorUserId,
      action: "billing.plan.patch",
      entityType: "Plan",
      entityId: plan.id,
      meta: input as Record<string, unknown>,
    });
  }

  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthlyPriceCents: plan.monthlyPriceCents,
    seatLimit: plan.seatLimit,
    shopLimit: plan.shopLimit,
    botLimit: plan.botLimit,
    dailyInviteQuota: plan.dailyInviteQuota,
    trialDays: plan.trialDays,
    stripePriceId: plan.stripePriceId,
    isPublic: plan.isPublic,
    active: plan.active,
    sortOrder: plan.sortOrder,
  };
}
