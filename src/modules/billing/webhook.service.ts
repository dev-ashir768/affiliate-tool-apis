import type { Plan, SubscriptionStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { getStripe } from "./stripe.js";
import { recordBillingLifecycleEvent } from "../../lib/billing-lifecycle.js";
import { notifyBillingLifecycle } from "../../lib/billing-emails.js";

type StripeLikeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

function mapSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
    case "unpaid":
      return "CANCELED";
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "INCOMPLETE";
    default:
      return "INCOMPLETE";
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function metadataValue(
  object: Record<string, unknown>,
  key: string,
): string | undefined {
  const metadata = object.metadata as Record<string, unknown> | undefined;
  return asString(metadata?.[key]);
}

function customerIdFrom(object: Record<string, unknown>): string | undefined {
  const customer = object.customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) {
    return asString((customer as { id: unknown }).id);
  }
  return undefined;
}

function priceIdFromSubscription(
  object: Record<string, unknown>,
): string | undefined {
  const items = object.items as
    { data?: Array<{ price?: string | { id?: string } }> } | undefined;
  const price = items?.data?.[0]?.price;
  if (typeof price === "string") return price;
  if (price && typeof price === "object") return asString(price.id);
  return undefined;
}

/** Stripe API 2025-03-31+ moved period end onto subscription items. */
function periodEndFromSubscription(
  object: Record<string, unknown>,
): Date | null {
  const items = object.items as
    { data?: Array<{ current_period_end?: unknown }> } | undefined;
  const fromItem = items?.data?.[0]?.current_period_end;
  if (typeof fromItem === "number") {
    return new Date(fromItem * 1000);
  }
  if (typeof object.current_period_end === "number") {
    return new Date(object.current_period_end * 1000);
  }
  return null;
}

function organizationIdFromObject(
  object: Record<string, unknown>,
): string | undefined {
  return (
    asString(object.client_reference_id) ??
    metadataValue(object, "organizationId")
  );
}

/** Normalize Stripe SDK objects / plain webhook JSON into a plain record. */
function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return value as Record<string, unknown>;
  }
}

async function resolveOrganization(input: {
  stripeCustomerId?: string;
  organizationId?: string;
}) {
  if (input.organizationId) {
    const byId = await prisma.organization.findUnique({
      where: { id: input.organizationId },
    });
    if (byId) return byId;
  }
  if (input.stripeCustomerId) {
    return prisma.organization.findFirst({
      where: { stripeCustomerId: input.stripeCustomerId },
    });
  }
  return null;
}

async function resolvePlan(input: {
  stripePriceId?: string;
  planCode?: string;
}): Promise<Plan | null> {
  if (input.stripePriceId) {
    const byPrice = await prisma.plan.findFirst({
      where: { stripePriceId: input.stripePriceId },
    });
    if (byPrice) return byPrice;
  }
  if (input.planCode) {
    return prisma.plan.findUnique({ where: { code: input.planCode } });
  }
  return null;
}

async function applyPlanAndSubscription(input: {
  organizationId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd?: Date | null;
  stripePriceId?: string;
  planCode?: string;
  stripeEventId?: string;
  source?: string;
}) {
  const before = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    include: { plan: true, subscription: true },
  });
  if (!before) {
    throw new AppError("NOT_FOUND", "Organization not found", 404);
  }

  const data: {
    stripeCustomerId?: string;
    planId?: string;
    seatLimit?: number;
    shopLimit?: number;
    botLimit?: number;
    dailyInviteQuota?: number;
  } = {};

  if (input.stripeCustomerId) {
    data.stripeCustomerId = input.stripeCustomerId;
  }

  let nextPlanCode = before.plan.code;
  let nextPlanMonthlyCents = before.plan.monthlyPriceCents;

  if (input.status === "CANCELED") {
    const free = await prisma.plan.findUnique({ where: { code: "free" } });
    if (free) {
      data.planId = free.id;
      data.seatLimit = free.seatLimit;
      data.shopLimit = free.shopLimit;
      data.botLimit = free.botLimit;
      data.dailyInviteQuota = free.dailyInviteQuota;
      nextPlanCode = free.code;
      nextPlanMonthlyCents = free.monthlyPriceCents;
    }
  } else {
    const plan = await resolvePlan({
      stripePriceId: input.stripePriceId,
      planCode: input.planCode,
    });
    if (plan && plan.code !== "free") {
      data.planId = plan.id;
      data.seatLimit = plan.seatLimit;
      data.shopLimit = plan.shopLimit;
      data.botLimit = plan.botLimit;
      data.dailyInviteQuota = plan.dailyInviteQuota;
      nextPlanCode = plan.code;
      nextPlanMonthlyCents = plan.monthlyPriceCents;
    } else if (input.stripePriceId || input.planCode) {
      logger.warn("stripe webhook: plan not resolved for paid status", {
        organizationId: input.organizationId,
        stripePriceId: input.stripePriceId,
        planCode: input.planCode,
        status: input.status,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.organization.update({
        where: { id: input.organizationId },
        data,
      });
    }

    await tx.subscription.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        status: input.status,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
      },
      update: {
        stripeSubscriptionId: input.stripeSubscriptionId,
        status: input.status,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
      },
    });
  });

  const prevStatus = before.subscription?.status ?? null;
  const prevPlan = before.plan.code;
  const prevPeriodEnd =
    before.subscription?.currentPeriodEnd?.getTime() ?? null;
  const nextPeriodEnd = input.currentPeriodEnd?.getTime() ?? null;
  const hadAccess =
    prevStatus === "ACTIVE" ||
    prevStatus === "TRIALING" ||
    prevStatus === "PAST_DUE";
  const hasAccess =
    input.status === "ACTIVE" ||
    input.status === "TRIALING" ||
    input.status === "PAST_DUE";

  const periodEnd = input.currentPeriodEnd?.toISOString() ?? null;

  if (input.status === "CANCELED" && prevStatus !== "CANCELED") {
    await recordBillingLifecycleEvent({
      organizationId: input.organizationId,
      type: "CANCELED",
      fromPlanCode: prevPlan,
      toPlanCode: nextPlanCode,
      stripeEventId: input.stripeEventId,
      periodEnd,
      meta: { source: input.source ?? "webhook", prevStatus },
    });
    return;
  }

  if (
    input.status === "PAST_DUE" &&
    prevStatus !== "PAST_DUE" &&
    prevStatus !== "CANCELED"
  ) {
    void notifyBillingLifecycle({
      organizationId: input.organizationId,
      type: "PAST_DUE",
      fromPlanCode: prevPlan,
      toPlanCode: nextPlanCode,
      periodEnd,
    });
  }

  if (hasAccess && !hadAccess) {
    await recordBillingLifecycleEvent({
      organizationId: input.organizationId,
      type: "SUBSCRIBED",
      fromPlanCode: prevPlan,
      toPlanCode: nextPlanCode,
      stripeEventId: input.stripeEventId,
      periodEnd,
      meta: {
        source: input.source ?? "webhook",
        status: input.status,
      },
    });
    return;
  }

  if (hasAccess && hadAccess && nextPlanCode !== prevPlan) {
    const type =
      nextPlanMonthlyCents >= before.plan.monthlyPriceCents
        ? "UPGRADED"
        : "DOWNGRADED";
    await recordBillingLifecycleEvent({
      organizationId: input.organizationId,
      type,
      fromPlanCode: prevPlan,
      toPlanCode: nextPlanCode,
      stripeEventId: input.stripeEventId,
      periodEnd,
      meta: {
        source: input.source ?? "webhook",
        fromCents: before.plan.monthlyPriceCents,
        toCents: nextPlanMonthlyCents,
      },
    });
    return;
  }

  if (
    hasAccess &&
    hadAccess &&
    nextPlanCode === prevPlan &&
    nextPeriodEnd != null &&
    prevPeriodEnd != null &&
    nextPeriodEnd > prevPeriodEnd
  ) {
    await recordBillingLifecycleEvent({
      organizationId: input.organizationId,
      type: "RENEWED",
      fromPlanCode: prevPlan,
      toPlanCode: nextPlanCode,
      stripeEventId: input.stripeEventId,
      periodEnd,
      meta: {
        source: input.source ?? "webhook",
        previousPeriodEnd: before.subscription?.currentPeriodEnd?.toISOString(),
        currentPeriodEnd: input.currentPeriodEnd?.toISOString(),
      },
    });
  }
}

/**
 * Checkout sessions usually only include subscription as an id string.
 * Expand via Stripe API when configured so plan/limits apply immediately.
 */
async function expandSubscriptionObject(
  subscriptionField: unknown,
): Promise<Record<string, unknown> | null> {
  const asObject = asPlainRecord(subscriptionField);
  if (asObject && asString(asObject.id) && asString(asObject.status)) {
    return asObject;
  }

  const subscriptionId = asString(subscriptionField) ?? asString(asObject?.id);
  if (!subscriptionId) return null;

  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    return asPlainRecord(sub);
  } catch (err) {
    logger.warn("stripe webhook: failed to retrieve subscription", {
      subscriptionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { id: subscriptionId, status: "incomplete" };
  }
}

async function applyFromSubscription(
  object: Record<string, unknown>,
  extras: { planCode?: string; stripeEventId?: string; source?: string } = {},
) {
  const stripeSubscriptionId = asString(object.id);
  if (!stripeSubscriptionId) {
    throw new AppError("VALIDATION_ERROR", "Subscription missing id", 400);
  }

  const stripeCustomerId = customerIdFrom(object);
  const org = await resolveOrganization({
    stripeCustomerId,
    organizationId: organizationIdFromObject(object),
  });
  if (!org) {
    throw new AppError(
      "NOT_FOUND",
      "Organization not found for subscription",
      404,
    );
  }

  await applyPlanAndSubscription({
    organizationId: org.id,
    stripeCustomerId,
    stripeSubscriptionId,
    status: mapSubscriptionStatus(asString(object.status) ?? "incomplete"),
    currentPeriodEnd: periodEndFromSubscription(object),
    stripePriceId: priceIdFromSubscription(object),
    planCode: extras.planCode ?? metadataValue(object, "planCode"),
    stripeEventId: extras.stripeEventId,
    source: extras.source,
  });
}

async function applyFromCheckoutSession(
  object: Record<string, unknown>,
  extras: { stripeEventId?: string } = {},
) {
  const organizationId = organizationIdFromObject(object);
  const stripeCustomerId = customerIdFrom(object);
  const planCode = metadataValue(object, "planCode");
  const org = await resolveOrganization({ organizationId, stripeCustomerId });
  if (!org) {
    throw new AppError(
      "NOT_FOUND",
      "Organization not found for checkout session",
      404,
    );
  }

  if (stripeCustomerId && org.stripeCustomerId !== stripeCustomerId) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { stripeCustomerId },
    });
  }

  const expanded = await expandSubscriptionObject(object.subscription);
  if (!expanded) return;

  // Ensure org linkage is present for retrieve payloads that omit metadata.
  if (!metadataValue(expanded, "organizationId") && organizationId) {
    expanded.metadata = {
      ...((expanded.metadata as Record<string, unknown> | undefined) ?? {}),
      organizationId,
      ...(planCode ? { planCode } : {}),
    };
  }

  await applyFromSubscription(expanded, {
    planCode,
    stripeEventId: extras.stripeEventId,
    source: "checkout",
  });
}

async function applyFromInvoice(
  object: Record<string, unknown>,
  extras: { stripeEventId?: string; source?: string } = {},
) {
  const expanded = await expandSubscriptionObject(object.subscription);
  if (!expanded) {
    return;
  }

  const stripeCustomerId = customerIdFrom(expanded) ?? customerIdFrom(object);
  if (stripeCustomerId && !customerIdFrom(expanded)) {
    expanded.customer = stripeCustomerId;
  }

  try {
    await applyFromSubscription(expanded, {
      planCode: metadataValue(object, "planCode"),
      stripeEventId: extras.stripeEventId,
      source: extras.source ?? "invoice",
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") {
      logger.warn("stripe webhook: invoice org not found, skipping", {
        invoiceId: asString(object.id),
        subscriptionId: asString(expanded.id),
        customerId: stripeCustomerId,
      });
      return;
    }
    throw err;
  }
}

async function applyClaimedEvent(event: StripeLikeEvent): Promise<void> {
  const object = event.data?.object ?? {};

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await applyFromCheckoutSession(object, { stripeEventId: event.id });
      return;

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await applyFromSubscription(object, {
        stripeEventId: event.id,
        source: event.type,
      });
      return;

    case "invoice.paid":
    case "invoice.payment_succeeded":
      await applyFromInvoice(object, {
        stripeEventId: event.id,
        source: "invoice.paid",
      });
      return;

    case "invoice.payment_failed": {
      await applyFromInvoice(object, {
        stripeEventId: event.id,
        source: "invoice.payment_failed",
      });
      const stripeCustomerId = customerIdFrom(object);
      const org = await resolveOrganization({
        stripeCustomerId,
        organizationId: organizationIdFromObject(object),
      });
      if (org) {
        void notifyBillingLifecycle({
          organizationId: org.id,
          type: "PAYMENT_FAILED",
        });
      }
      return;
    }

    default:
      logger.info("stripe webhook: ignored event type", {
        eventId: event.id,
        type: event.type,
      });
  }
}

/**
 * Idempotent Stripe event processor.
 * Claims the event id first; duplicates return without re-applying side effects.
 * If apply fails after claim, the claim row is deleted so Stripe can retry.
 */
export async function handleStripeEvent(event: StripeLikeEvent): Promise<void> {
  try {
    await prisma.stripeEvent.create({
      data: {
        eventId: event.id,
        type: event.type,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      logger.info("stripe webhook: duplicate ignored", {
        eventId: event.id,
        type: event.type,
      });
      return;
    }
    throw err;
  }

  try {
    await applyClaimedEvent(event);
    logger.info("stripe webhook: processed", {
      eventId: event.id,
      type: event.type,
    });
  } catch (err) {
    await prisma.stripeEvent.deleteMany({ where: { eventId: event.id } });
    logger.error("stripe webhook: apply failed (claim released for retry)", {
      eventId: event.id,
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Alias matching plan interface name. */
export const applySubscriptionFromStripe = handleStripeEvent;
