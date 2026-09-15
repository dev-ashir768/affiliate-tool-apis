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

  beforeAll(async () => {
    const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
    const growth = await prisma.plan.findUniqueOrThrow({ where: { code: "growth" } });
    growthPlanId = growth.id;

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
      // Restore seeded growth price id (usually null without env)
      await prisma.plan.update({
        where: { id: growthPlanId },
        data: { stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? null },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("ignores duplicate stripe event ids", async () => {
    const event = {
      id: `evt_test_${suffix}`,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: subscriptionId,
          status: "active",
          customer: customerId,
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
    expect(org.seatLimit).toBe(3);
    expect(org.shopLimit).toBe(3);
    expect(org.dailyInviteQuota).toBe(1500);
    expect(org.subscription?.stripeSubscriptionId).toBe(subscriptionId);
    expect(org.subscription?.status).toBe("ACTIVE");
    expect(org.subscription?.currentPeriodEnd).toBeTruthy();
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

    expect(
      await prisma.stripeEvent.count({ where: { eventId } })
    ).toBe(0);

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

    expect(
      await prisma.stripeEvent.count({ where: { eventId } })
    ).toBe(1);

    const sub = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
    });
    expect(sub?.stripeSubscriptionId).toBe(retrySubId);
    expect(sub?.status).toBe("ACTIVE");
  });
});
