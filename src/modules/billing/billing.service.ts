import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getStripe, portalBaseUrl } from "./stripe.js";

export async function listPlans() {
  const plans = await prisma.plan.findMany({
    orderBy: { monthlyPriceCents: "asc" },
  });
  return plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    monthlyPriceCents: p.monthlyPriceCents,
    seatLimit: p.seatLimit,
    shopLimit: p.shopLimit,
    dailyInviteQuota: p.dailyInviteQuota,
  }));
}

export async function createCheckoutSession(input: {
  organizationId: string;
  planCode: string;
  actorEmail: string;
}) {
  const plan = await prisma.plan.findUnique({
    where: { code: input.planCode },
  });
  if (!plan) {
    throw new AppError("NOT_FOUND", "Plan not found", 404);
  }
  if (!plan.stripePriceId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Plan is not available for checkout",
      400
    );
  }
  if (plan.code === "free") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Free plan does not require checkout",
      400
    );
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
  });

  const stripe = getStripe();
  const base = portalBaseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: org.stripeCustomerId ?? undefined,
    customer_email: org.stripeCustomerId ? undefined : input.actorEmail,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${base}/billing/success`,
    cancel_url: `${base}/billing/cancel`,
    metadata: { organizationId: org.id },
    client_reference_id: org.id,
    subscription_data: {
      metadata: { organizationId: org.id },
    },
  });

  return { url: session.url, id: session.id };
}

export async function createPortalSession(input: { organizationId: string }) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
  });
  if (!org.stripeCustomerId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Organization has no Stripe customer",
      400
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
