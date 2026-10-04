import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { createCheckoutSession } from "../../src/modules/billing/billing.service.js";

const sessionsCreate = vi.fn();
const subscriptionsRetrieve = vi.fn();

vi.mock("../../src/modules/billing/stripe.js", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: sessionsCreate,
      },
    },
    subscriptions: {
      retrieve: subscriptionsRetrieve,
      update: vi.fn(),
    },
  }),
  portalBaseUrl: () => "http://localhost:3000",
}));

describe("createCheckoutSession with manual subscription", () => {
  const suffix = Date.now();
  let orgId = "";
  let planCode = "";
  const orgIds: string[] = [];

  beforeAll(async () => {
    const plan = await prisma.plan.findFirst({
      where: { code: { not: "free" }, active: true, stripePriceId: { not: null } },
    });
    if (!plan?.stripePriceId) {
      throw new Error("Need an active paid plan with stripePriceId for checkout test");
    }
    planCode = plan.code;

    const org = await prisma.organization.create({
      data: {
        name: "Manual sub checkout org",
        slug: `manual-checkout-${suffix}`,
        planId: plan.id,
        seatLimit: plan.seatLimit,
        shopLimit: plan.shopLimit,
        botLimit: plan.botLimit,
        dailyInviteQuota: plan.dailyInviteQuota,
      },
    });
    orgId = org.id;
    orgIds.push(org.id);

    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        stripeSubscriptionId: `manual_${org.id}`,
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      },
    });
  }, 60000);

  afterAll(async () => {
    await prisma.subscription.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  beforeEach(() => {
    sessionsCreate.mockReset();
    subscriptionsRetrieve.mockReset();
    sessionsCreate.mockResolvedValue({
      id: "cs_test",
      url: "https://checkout.stripe.test/session",
    });
  });

  it("creates checkout session instead of plan change for manual grant", async () => {
    const result = await createCheckoutSession({
      organizationId: orgId,
      planCode,
      actorEmail: "owner@test.com",
    });

    expect(result.mode).toBe("checkout");
    expect(sessionsCreate).toHaveBeenCalledOnce();
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
  }, 60000);
});
