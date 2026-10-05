import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { prisma } from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/lib/password.js";
import { signAccessToken } from "../../src/lib/tokens.js";
import { createApp } from "../../src/app.js";
import { redis } from "../../src/lib/redis.js";

describe("platform grant/revoke access", () => {
  const suffix = Date.now();
  const app = createApp();

  let freePlanId = "";
  let starterCode = "";

  let superadminToken = "";
  let opsToken = "";

  let orgAId = ""; // free org, will be granted/revoked
  let orgBId = ""; // org with a real Stripe subscription
  let orgCId = ""; // org with CANCELED Stripe subscription

  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const free = await prisma.plan.findUniqueOrThrow({
      where: { code: "free" },
    });
    freePlanId = free.id;

    const starter = await prisma.plan.findFirst({
      where: { code: { not: "free" }, active: true },
    });
    if (!starter) {
      throw new Error("No non-free active plan found for test fixtures");
    }
    starterCode = starter.code;

    const superadmin = await prisma.user.create({
      data: {
        email: `grant_superadmin_${suffix}@test.com`,
        passwordHash: await hashPassword("Secret123!"),
        name: "Grant Superadmin",
      },
    });
    userIds.push(superadmin.id);

    await prisma.platformMembership.create({
      data: { userId: superadmin.id, role: "SUPERADMIN", status: "ACTIVE" },
    });

    superadminToken = await signAccessToken({
      sub: superadmin.id,
      orgId: null,
      orgRole: null,
      platformRole: "SUPERADMIN",
      hasProductAccess: false,
    });

    const ops = await prisma.user.create({
      data: {
        email: `grant_ops_${suffix}@test.com`,
        passwordHash: await hashPassword("Secret123!"),
        name: "Grant Ops",
      },
    });
    userIds.push(ops.id);

    await prisma.platformMembership.create({
      data: { userId: ops.id, role: "OPS", status: "ACTIVE" },
    });

    opsToken = await signAccessToken({
      sub: ops.id,
      orgId: null,
      orgRole: null,
      platformRole: "OPS",
      hasProductAccess: false,
    });

    const orgA = await prisma.organization.create({
      data: {
        name: "Grant Org A",
        slug: `grant-org-a-${suffix}`,
        planId: freePlanId,
        seatLimit: free.seatLimit,
        shopLimit: free.shopLimit,
        botLimit: free.botLimit,
        dailyInviteQuota: free.dailyInviteQuota,
      },
    });
    orgAId = orgA.id;
    orgIds.push(orgA.id);

    const orgB = await prisma.organization.create({
      data: {
        name: "Grant Org B (Stripe)",
        slug: `grant-org-b-${suffix}`,
        planId: starter.id,
        seatLimit: starter.seatLimit,
        shopLimit: starter.shopLimit,
        botLimit: starter.botLimit,
        dailyInviteQuota: starter.dailyInviteQuota,
      },
    });
    orgBId = orgB.id;
    orgIds.push(orgB.id);

    await prisma.subscription.create({
      data: {
        organizationId: orgB.id,
        stripeSubscriptionId: `sub_real_${suffix}`,
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      },
    });

    const orgC = await prisma.organization.create({
      data: {
        name: "Grant Org C (Canceled Stripe)",
        slug: `grant-org-c-${suffix}`,
        planId: freePlanId,
        seatLimit: free.seatLimit,
        shopLimit: free.shopLimit,
        botLimit: free.botLimit,
        dailyInviteQuota: free.dailyInviteQuota,
      },
    });
    orgCId = orgC.id;
    orgIds.push(orgC.id);

    await prisma.subscription.create({
      data: {
        organizationId: orgC.id,
        stripeSubscriptionId: `sub_canceled_${suffix}`,
        status: "CANCELED",
        currentPeriodEnd: new Date(Date.now() - 86400_000),
      },
    });
  }, 60000);

  afterAll(async () => {
    try {
      await prisma.billingLifecycleEvent.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      await prisma.subscription.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      await prisma.membership.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      if (orgIds.length) {
        await prisma.organization.deleteMany({
          where: { id: { in: orgIds } },
        });
      }
      await prisma.platformMembership.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.refreshToken.deleteMany({
        where: { userId: { in: userIds } },
      });
      if (userIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      await prisma.$disconnect();
      if (redis.status === "ready") await redis.quit();
    }
  });

  it("grants manual access to a free org", async () => {
    const res = await request(app)
      .post(`/api/v1/platform/organizations/${orgAId}/grant-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({ planCode: starterCode });

    expect(res.status).toBe(200);
    expect(res.body.billingSource).toBe("manual");
    expect(res.body.hasProductAccess).toBe(true);
    expect(res.body.plan.code).toBe(starterCode);
    expect(res.body.stripeSubscriptionId).toBe(`manual_${orgAId}`);
  }, 60000);

  it("re-grants with a different paid plan and future period end", async () => {
    const otherPlan = await prisma.plan.findFirst({
      where: { code: { notIn: ["free", starterCode] }, active: true },
    });
    const planCode = otherPlan?.code ?? starterCode;
    const currentPeriodEnd = new Date(
      Date.now() + 60 * 86400_000,
    ).toISOString();

    const res = await request(app)
      .post(`/api/v1/platform/organizations/${orgAId}/grant-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({ planCode, currentPeriodEnd });

    expect(res.status).toBe(200);
    expect(res.body.plan.code).toBe(planCode);
    expect(res.body.billingSource).toBe("manual");
    expect(res.body.hasProductAccess).toBe(true);
  }, 60000);

  it("rejects grant on an org with a real Stripe subscription (409)", async () => {
    const res = await request(app)
      .post(`/api/v1/platform/organizations/${orgBId}/grant-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({ planCode: starterCode });

    expect(res.status).toBe(409);
  }, 60000);

  it("allows grant when existing Stripe subscription is CANCELED", async () => {
    const res = await request(app)
      .post(`/api/v1/platform/organizations/${orgCId}/grant-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({ planCode: starterCode });

    expect(res.status).toBe(200);
    expect(res.body.billingSource).toBe("manual");
    expect(res.body.stripeSubscriptionId).toBe(`manual_${orgCId}`);
  }, 60000);

  it("rejects grant with planCode free (400)", async () => {
    const res = await request(app)
      .post(`/api/v1/platform/organizations/${orgAId}/grant-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({ planCode: "free" });

    expect(res.status).toBe(400);
  }, 60000);

  it("revokes manual access, resetting org to free plan", async () => {
    const res = await request(app)
      .post(`/api/v1/platform/organizations/${orgAId}/revoke-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.plan.code).toBe("free");
    expect(res.body.billingSource).toBe("none");
    expect(res.body.hasProductAccess).toBe(false);
  }, 60000);

  it("rejects revoke when there is no manual grant (409)", async () => {
    const resAgain = await request(app)
      .post(`/api/v1/platform/organizations/${orgAId}/revoke-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({});
    expect(resAgain.status).toBe(409);

    const resStripe = await request(app)
      .post(`/api/v1/platform/organizations/${orgBId}/revoke-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({});
    expect(resStripe.status).toBe(409);
  }, 60000);

  it("rejects OPS token grant attempts (403)", async () => {
    const res = await request(app)
      .post(`/api/v1/platform/organizations/${orgAId}/grant-access`)
      .set("Authorization", `Bearer ${opsToken}`)
      .send({ planCode: starterCode });

    expect(res.status).toBe(403);
  }, 60000);

  it("rejects a past currentPeriodEnd with 400 validation error", async () => {
    const pastPeriodEnd = new Date(Date.now() - 86400_000).toISOString();
    const res = await request(app)
      .post(`/api/v1/platform/organizations/${orgAId}/grant-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({ planCode: starterCode, currentPeriodEnd: pastPeriodEnd });

    expect(res.status).toBe(400);
  }, 60000);

  it("denies product access once a manual grant's period end has passed", async () => {
    const futurePeriodEnd = new Date(
      Date.now() + 30 * 86400_000,
    ).toISOString();

    const grantRes = await request(app)
      .post(`/api/v1/platform/organizations/${orgAId}/grant-access`)
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({ planCode: starterCode, currentPeriodEnd: futurePeriodEnd });
    expect(grantRes.status).toBe(200);
    expect(grantRes.body.hasProductAccess).toBe(true);

    // Force-expire the manual grant directly in the DB.
    await prisma.subscription.update({
      where: { organizationId: orgAId },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });

    const getRes = await request(app)
      .get(`/api/v1/platform/organizations/${orgAId}`)
      .set("Authorization", `Bearer ${superadminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.hasProductAccess).toBe(false);
  }, 60000);
});
