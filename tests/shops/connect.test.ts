import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { prisma } from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/lib/password.js";
import { signAccessToken } from "../../src/lib/tokens.js";
import { createApp } from "../../src/app.js";
import {
  connectShop,
  disconnectShop,
  getShop,
  listShops,
} from "../../src/modules/shops/shops.service.js";
import { redis } from "../../src/lib/redis.js";

describe("shops connect", () => {
  const suffix = Date.now();
  const ownerEmail = `shop_owner_${suffix}@test.com`;

  let orgId = "";
  let ownerId = "";
  let planId = "";
  const app = createApp();
  const createdShopIds: string[] = [];

  beforeAll(async () => {
    const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
    planId = free.id;

    const owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: await hashPassword("Secret123!"),
        name: "Shop Owner",
      },
    });
    ownerId = owner.id;

    const org = await prisma.organization.create({
      data: {
        name: "Shop Org",
        slug: `shop-org-${suffix}`,
        planId,
        seatLimit: 1,
        shopLimit: 0,
        dailyInviteQuota: 0,
      },
    });
    orgId = org.id;

    await prisma.membership.create({
      data: {
        userId: owner.id,
        organizationId: org.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
  }, 60000);

  afterAll(async () => {
    try {
      if (createdShopIds.length) {
        const shops = await prisma.shop.findMany({
          where: { id: { in: createdShopIds } },
        });
        await prisma.shop.deleteMany({ where: { id: { in: createdShopIds } } });
        const botIds = shops.map((s) => s.botIdentityId);
        if (botIds.length) {
          await prisma.botIdentity.updateMany({
            where: { id: { in: botIds } },
            data: {
              status: "AVAILABLE",
              reservedForOrgId: null,
              reservedAt: null,
            },
          });
        }
      }
      if (orgId) {
        await prisma.membership.deleteMany({ where: { organizationId: orgId } });
        await prisma.organization.delete({ where: { id: orgId } });
      }
      if (ownerId) {
        await prisma.refreshToken.deleteMany({ where: { userId: ownerId } });
        await prisma.user.delete({ where: { id: ownerId } });
      }
    } finally {
      await prisma.$disconnect();
      if (redis.status === "ready") await redis.quit();
    }
  });

  it("connectShop when shopLimit is 0 throws PLAN_LIMIT", async () => {
    await expect(
      connectShop({ organizationId: orgId, region: "US" })
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });
  }, 60000);

  it("connects shop and reserves bot", async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { shopLimit: 1 },
    });

    const shop = await connectShop({ organizationId: orgId, region: "US" });
    createdShopIds.push(shop.id);

    expect(shop.status).toBe("PENDING_INVITE");
    expect(shop.botEmail).toMatch(/@/);
    expect(shop.region).toBe("US");
  }, 60000);

  it("second connect when limit 1 throws PLAN_LIMIT", async () => {
    await expect(
      connectShop({ organizationId: orgId, region: "UK" })
    ).rejects.toMatchObject({ code: "PLAN_LIMIT" });
  }, 60000);

  it("listShops / getShop / disconnectShop work", async () => {
    const listed = await listShops(orgId);
    expect(listed.length).toBe(1);
    expect(listed[0].botEmail).toMatch(/@/);

    const detail = await getShop(orgId, listed[0].id);
    expect(detail.id).toBe(listed[0].id);
    expect(detail.status).toBe("PENDING_INVITE");

    const disconnected = await disconnectShop(orgId, detail.id);
    expect(disconnected.status).toBe("DISCONNECTED");

    const bot = await prisma.botIdentity.findUniqueOrThrow({
      where: { id: detail.botIdentityId },
    });
    expect(bot.status).toBe("AVAILABLE");
    expect(bot.reservedForOrgId).toBeNull();
    expect(bot.reservedAt).toBeNull();
  }, 60000);

  it("HTTP: connect requires OWNER/ADMIN; members can list/get", async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { shopLimit: 2 },
    });

    const accessToken = await signAccessToken({
      sub: ownerId,
      orgId,
      role: "OWNER",
    });

    const connectRes = await request(app)
      .post("/api/v1/shops/connect")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ region: "UK" });

    expect(connectRes.status).toBe(201);
    expect(connectRes.body.status).toBe("PENDING_INVITE");
    expect(connectRes.body.botEmail).toMatch(/@/);
    createdShopIds.push(connectRes.body.id);

    const listRes = await request(app)
      .get("/api/v1/shops")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.shops.length).toBeGreaterThanOrEqual(1);

    const getRes = await request(app)
      .get(`/api/v1/shops/${connectRes.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(connectRes.body.id);

    const delRes = await request(app)
      .delete(`/api/v1/shops/${connectRes.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.status).toBe("DISCONNECTED");
  }, 60000);
});
