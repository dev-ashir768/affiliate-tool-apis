import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { handleStripeEvent } from "../../src/modules/billing/webhook.service.js";

describe("billing webhook service", () => {
  const suffix = Date.now();
  const customerId = `cus_test_${suffix}`;
  const priceId = `price_growth_${suffix}`;
  const subscriptionId = `sub_test_${suffix}`;

  let orgId = "";
  let growthPlanId = "";
  let freePlanId = "";
  let growthLimits = {
    seatLimit: 0,
    shopLimit: 0,
    botLimit: 0,
    dailyInviteQuota: 0,
  };

  beforeAll(async () => {
    const free = await prisma.plan.findUniqueOrThrow({
      where: { code: "free" },
    });
    const growth = await prisma.plan.findUniqueOrThrow({
      where: { code: "growth" },
    });
    freePlanId = free.id;
    growthPlanId = growth.id;
    growthLimits = {
      seatLimit: growth.seatLimit,
      shopLimit: growth.shopLimit,
      botLimit: growth.botLimit,
      dailyInviteQuota: growth.dailyInviteQuota,
    };

    await prisma.plan.update({
      where: { id: growth.id },
      data: { stripePriceId: priceId },
    });

    const org = await prisma.organization.create({
      data: {
        name: `Billing Org ${suffix}`,
        slug: `billing-org-${suffix}`,
        planId: free.id,
        stripeCustomerId: customerId,
        seatLimit: free.seatLimit,
        shopLimit: free.shopLimit,
        botLimit: free.botLimit,
        dailyInviteQuota: free.dailyInviteQuota,
      },
    });
    orgId = org.id;
  }, 60000);

  afterAll(async () => {
    try {
      await prisma.subscription.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
      await prisma.stripeEvent.deleteMany({
        where: { eventId: { startsWith: `evt_test_${suffix}` } },
      });
      await prisma.plan.update({
        where: { id: growthPlanId },
        data: { stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? null },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  function subscriptionObject(overrides: Record<string, unknown> = {}) {
    return {
      id: subscriptionId,
      status: "active",
      customer: customerId,
      metadata: { organizationId: orgId, planCode: "growth" },
      items: {
        data: [
          {
            price: { id: priceId },
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
          },
        ],
      },
      ...overrides,
    };
  }

  it("applies active subscription and ignores duplicate event ids", async () => {
    const event = {
      id: `evt_test_${suffix}`,
      type: "customer.subscription.updated",
      data: { object: subscriptionObject() },
    };

    await handleStripeEvent(event as any);
    await handleStripeEvent(event as any);

    const count = await prisma.stripeEvent.count({
      where: { eventId: event.id },
    });
    expect(count).toBe(1);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      include: { subscription: true, plan: true },
    });
    expect(org.planId).toBe(growthPlanId);
    expect(org.plan.code).toBe("growth");
    expect(org.seatLimit).toBe(growthLimits.seatLimit);
    expect(org.shopLimit).toBe(growthLimits.shopLimit);
    expect(org.botLimit).toBe(growthLimits.botLimit);
    expect(org.dailyInviteQuota).toBe(growthLimits.dailyInviteQuota);
    expect(org.subscription?.stripeSubscriptionId).toBe(subscriptionId);
    expect(org.subscription?.status).toBe("ACTIVE");
    expect(org.subscription?.currentPeriodEnd).toBeTruthy();
  });

  it("resolves plan via planCode metadata when stripe price is unknown", async () => {
    const event = {
      id: `evt_test_${suffix}_plancode`,
      type: "customer.subscription.updated",
      data: {
        object: subscriptionObject({
          id: `sub_test_${suffix}_plancode`,
          items: {
            data: [
              {
                price: { id: `price_unknown_${suffix}` },
                current_period_end: Math.floor(Date.now() / 1000) + 86400,
              },
            ],
          },
        }),
      },
    };

    await handleStripeEvent(event as any);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      include: { plan: true, subscription: true },
    });
    expect(org.plan.code).toBe("growth");
    expect(org.botLimit).toBe(growthLimits.botLimit);
    expect(org.subscription?.status).toBe("ACTIVE");
  });

  it("applies TRIALING status from Stripe", async () => {
    const event = {
      id: `evt_test_${suffix}_trial`,
      type: "customer.subscription.updated",
      data: {
        object: subscriptionObject({
          id: `sub_test_${suffix}_trial`,
          status: "trialing",
        }),
      },
    };

    await handleStripeEvent(event as any);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId: orgId },
    });
    expect(sub.status).toBe("TRIALING");
    expect(sub.stripeSubscriptionId).toBe(`sub_test_${suffix}_trial`);
  });

  it("checkout.session.completed with embedded subscription activates plan", async () => {
    const event = {
      id: `evt_test_${suffix}_checkout`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_test_${suffix}`,
          client_reference_id: orgId,
          customer: customerId,
          metadata: { organizationId: orgId, planCode: "growth" },
          subscription: subscriptionObject({
            id: `sub_test_${suffix}_checkout`,
            status: "trialing",
          }),
        },
      },
    };

    await handleStripeEvent(event as any);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      include: { plan: true, subscription: true },
    });
    expect(org.plan.code).toBe("growth");
    expect(org.subscription?.status).toBe("TRIALING");
    expect(org.subscription?.stripeSubscriptionId).toBe(
      `sub_test_${suffix}_checkout`,
    );
  });

  it("canceled subscription reverts org to free plan", async () => {
    const event = {
      id: `evt_test_${suffix}_cancel`,
      type: "customer.subscription.deleted",
      data: {
        object: subscriptionObject({
          id: `sub_test_${suffix}_cancel`,
          status: "canceled",
        }),
      },
    };

    await handleStripeEvent(event as any);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      include: { plan: true, subscription: true },
    });
    expect(org.planId).toBe(freePlanId);
    expect(org.plan.code).toBe("free");
    expect(org.shopLimit).toBe(0);
    expect(org.botLimit).toBe(0);
    expect(org.subscription?.status).toBe("CANCELED");
  });

  it("rolls back StripeEvent claim when apply fails so Stripe can retry", async () => {
    const eventId = `evt_test_${suffix}_retry`;
    const retrySubId = `sub_test_${suffix}_retry`;

    const failingEvent = {
      id: eventId,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: retrySubId,
          status: "active",
          customer: `cus_unknown_${suffix}`,
          items: {
            data: [
              {
                price: { id: priceId },
                current_period_end: Math.floor(Date.now() / 1000) + 86400,
              },
            ],
          },
        },
      },
    };

    await expect(handleStripeEvent(failingEvent as any)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    expect(await prisma.stripeEvent.count({ where: { eventId } })).toBe(0);

    const successEvent = {
      ...failingEvent,
      data: {
        object: {
          ...failingEvent.data.object,
          customer: customerId,
        },
      },
    };

    await handleStripeEvent(successEvent as any);

    expect(await prisma.stripeEvent.count({ where: { eventId } })).toBe(1);

    const sub = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
    });
    expect(sub?.stripeSubscriptionId).toBe(retrySubId);
    expect(sub?.status).toBe("ACTIVE");
  });
});
