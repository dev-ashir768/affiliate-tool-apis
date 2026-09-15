import type { SubscriptionStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

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
      return "CANCELED";
    case "incomplete":
    case "incomplete_expired":
      return "INCOMPLETE";
    default:
      return "INCOMPLETE";
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function customerIdFrom(object: Record<string, unknown>): string | undefined {
  const customer = object.customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) {
    return asString((customer as { id: unknown }).id);
  }
  return undefined;
}

function priceIdFromSubscription(object: Record<string, unknown>): string | undefined {
  const items = object.items as
    | { data?: Array<{ price?: string | { id?: string } }> }
    | undefined;
  const price = items?.data?.[0]?.price;
  if (typeof price === "string") return price;
  if (price && typeof price === "object") return asString(price.id);
  return undefined;
}

function organizationIdFromSession(object: Record<string, unknown>): string | undefined {
  const metadata = object.metadata as { organizationId?: unknown } | undefined;
  return (
    asString(object.client_reference_id) ?? asString(metadata?.organizationId)
  );
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

async function applyPlanAndSubscription(input: {
  organizationId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd?: Date | null;
  stripePriceId?: string;
}) {
  const data: {
    stripeCustomerId?: string;
    planId?: string;
    seatLimit?: number;
    shopLimit?: number;
    dailyInviteQuota?: number;
  } = {};

  if (input.stripeCustomerId) {
    data.stripeCustomerId = input.stripeCustomerId;
  }

  if (input.stripePriceId) {
    const plan = await prisma.plan.findFirst({
      where: { stripePriceId: input.stripePriceId },
    });
    if (plan) {
      data.planId = plan.id;
      data.seatLimit = plan.seatLimit;
      data.shopLimit = plan.shopLimit;
      data.dailyInviteQuota = plan.dailyInviteQuota;
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
}

async function applyFromSubscription(object: Record<string, unknown>) {
  const stripeSubscriptionId = asString(object.id);
  if (!stripeSubscriptionId) {
    throw new AppError("VALIDATION_ERROR", "Subscription missing id", 400);
  }

  const stripeCustomerId = customerIdFrom(object);
  const metadata = object.metadata as { organizationId?: unknown } | undefined;
  const org = await resolveOrganization({
    stripeCustomerId,
    organizationId: asString(metadata?.organizationId),
  });
  if (!org) {
    throw new AppError("NOT_FOUND", "Organization not found for subscription", 404);
  }

  const periodEnd =
    typeof object.current_period_end === "number"
      ? new Date(object.current_period_end * 1000)
      : null;

  await applyPlanAndSubscription({
    organizationId: org.id,
    stripeCustomerId,
    stripeSubscriptionId,
    status: mapSubscriptionStatus(asString(object.status) ?? "incomplete"),
    currentPeriodEnd: periodEnd,
    stripePriceId: priceIdFromSubscription(object),
  });
}

async function applyFromCheckoutSession(object: Record<string, unknown>) {
  const organizationId = organizationIdFromSession(object);
  const stripeCustomerId = customerIdFrom(object);
  const org = await resolveOrganization({ organizationId, stripeCustomerId });
  if (!org) {
    throw new AppError("NOT_FOUND", "Organization not found for checkout session", 404);
  }

  if (stripeCustomerId && org.stripeCustomerId !== stripeCustomerId) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { stripeCustomerId },
    });
  }

  const subscription = object.subscription;
  if (subscription && typeof subscription === "object") {
    await applyFromSubscription(subscription as Record<string, unknown>);
    return;
  }

  const stripeSubscriptionId = asString(subscription);
  if (!stripeSubscriptionId) return;

  // Session only has subscription id — record placeholder; subscription.* events fill details
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      stripeSubscriptionId,
      status: "INCOMPLETE",
      currentPeriodEnd: null,
    },
    update: {
      stripeSubscriptionId,
    },
  });
}

async function applyClaimedEvent(event: StripeLikeEvent): Promise<void> {
  const object = event.data?.object ?? {};

  if (event.type === "checkout.session.completed") {
    await applyFromCheckoutSession(object);
    return;
  }

  if (event.type.startsWith("customer.subscription.")) {
    await applyFromSubscription(object);
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
      return;
    }
    throw err;
  }

  try {
    await applyClaimedEvent(event);
  } catch (err) {
    await prisma.stripeEvent.deleteMany({ where: { eventId: event.id } });
    throw err;
  }
}

/** Alias matching plan interface name. */
export const applySubscriptionFromStripe = handleStripeEvent;
