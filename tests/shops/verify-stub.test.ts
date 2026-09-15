import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Job } from "bullmq";
import request from "supertest";
import { prisma } from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/lib/password.js";
import { signAccessToken } from "../../src/lib/tokens.js";
import { createApp } from "../../src/app.js";
import { connectShop } from "../../src/modules/shops/shops.service.js";
import { requestVerify } from "../../src/modules/shops/verify.service.js";
import {
  processShopVerify,
  type ShopVerifyJobData,
} from "../../src/workers/shop-verify.processor.js";
import { runPlaywrightVerify } from "../../src/workers/shop-verify.playwright.scaffold.js";
import { shopVerifyQueue } from "../../src/lib/queue.js";
import { redis } from "../../src/lib/redis.js";

function fakeJob(data: ShopVerifyJobData, id = "test-job"): Job<ShopVerifyJobData> {
  return { id, data } as Job<ShopVerifyJobData>;
}

describe("shop verify stub", () => {
  const suffix = Date.now();
  const ownerEmail = `verify_owner_${suffix}@test.com`;

  let orgId = "";
  let ownerId = "";
  let planId = "";
  const app = createApp();
  const createdShopIds: string[] = [];
  const ownedBotIds: string[] = [];

  beforeAll(async () => {
    const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
    planId = free.id;

    for (let i = 0; i < 6; i++) {
      const bot = await prisma.botIdentity.create({
        data: {
          email: `verify-bot-${suffix}-${i}@test.com`,
          status: "AVAILABLE",
        },
      });
      ownedBotIds.push(bot.id);
    }

    const owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: await hashPassword("Secret123!"),
        name: "Verify Owner",
      },
    });
    ownerId = owner.id;

    const org = await prisma.organization.create({
      data: {
        name: "Verify Org",
        slug: `verify-org-${suffix}`,
        planId,
        seatLimit: 1,
        shopLimit: 10,
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
        await prisma.shopVerificationJob.deleteMany({
          where: { shopId: { in: createdShopIds } },
        });
        const shops = await prisma.shop.findMany({
          where: { id: { in: createdShopIds } },
        });
        await prisma.shop.deleteMany({ where: { id: { in: createdShopIds } } });
        const botIds = shops
          .map((s) => s.botIdentityId)
          .filter((id): id is string => Boolean(id));
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
      if (ownedBotIds.length) {
        await prisma.botIdentity.deleteMany({ where: { id: { in: ownedBotIds } } });
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

  it("stub verify marks shop ACTIVE", async () => {
    const shop = await connectShop({ organizationId: orgId, region: "US" });
    createdShopIds.push(shop.id);

    const verificationJob = await prisma.shopVerificationJob.create({
      data: {
        shopId: shop.id,
        mode: "STUB",
        status: "QUEUED",
      },
    });

    await processShopVerify(
      fakeJob({
        shopId: shop.id,
        organizationId: orgId,
        mode: "STUB",
        verificationJobId: verificationJob.id,
      })
    );

    const updated = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
    expect(updated.status).toBe("ACTIVE");
    expect(updated.verifiedAt).toBeTruthy();

    expect(shop.botIdentityId).toBeTruthy();
    const bot = await prisma.botIdentity.findUniqueOrThrow({
      where: { id: shop.botIdentityId! },
    });
    expect(bot.status).toBe("ASSIGNED");

    const jobRow = await prisma.shopVerificationJob.findUniqueOrThrow({
      where: { id: verificationJob.id },
    });
    expect(jobRow.status).toBe("SUCCEEDED");
  }, 60000);

  it("requestVerify rejects shops that are not PENDING_INVITE or FAILED", async () => {
    const shop = await connectShop({ organizationId: orgId, region: "UK" });
    createdShopIds.push(shop.id);

    await prisma.shop.update({
      where: { id: shop.id },
      data: { status: "ACTIVE", verifiedAt: new Date() },
    });

    await expect(requestVerify(orgId, shop.id)).rejects.toMatchObject({
      code: "SHOP_NOT_READY",
    });
  }, 60000);

  it("requestVerify creates job; test skip leaves PENDING_INVITE", async () => {
    const shop = await connectShop({ organizationId: orgId, region: "US" });
    createdShopIds.push(shop.id);

    const result = await requestVerify(orgId, shop.id);
    expect(result.status).toBe("PENDING_INVITE");
    expect(result.verificationJobId).toBeTruthy();

    // Enqueue skipped in test — shop stays PENDING_INVITE until processShopVerify.
    const updated = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
    expect(updated.status).toBe("PENDING_INVITE");

    const jobRow = await prisma.shopVerificationJob.findUniqueOrThrow({
      where: { id: result.verificationJobId },
    });
    expect(jobRow.status).toBe("QUEUED");
    expect(jobRow.mode).toBe("STUB");
  }, 60000);

  it("enqueue failure marks shop FAILED (not stuck VERIFYING)", async () => {
    const shop = await connectShop({ organizationId: orgId, region: "UK" });
    createdShopIds.push(shop.id);

    process.env.FORCE_SHOP_VERIFY_ENQUEUE = "1";
    const addSpy = vi
      .spyOn(shopVerifyQueue, "add")
      .mockRejectedValue(new Error("redis down"));

    try {
      await expect(requestVerify(orgId, shop.id)).rejects.toMatchObject({
        code: "INTERNAL",
      });

      const updated = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } });
      expect(updated.status).toBe("FAILED");
      expect(updated.status).not.toBe("VERIFYING");
      expect(updated.statusReason).toMatch(/redis down/i);

      const jobRow = await prisma.shopVerificationJob.findFirstOrThrow({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
      });
      expect(jobRow.status).toBe("FAILED");
      expect(jobRow.lastError).toMatch(/redis down/i);

      // Can re-verify after FAILED
      delete process.env.FORCE_SHOP_VERIFY_ENQUEUE;
      addSpy.mockRestore();
      const again = await requestVerify(orgId, shop.id);
      expect(again.verificationJobId).toBeTruthy();
      expect(again.status).toBe("PENDING_INVITE");
    } finally {
      delete process.env.FORCE_SHOP_VERIFY_ENQUEUE;
      addSpy.mockRestore();
    }
  }, 60000);

  it("Playwright scaffold throws NOT_IMPLEMENTED", async () => {
    await expect(
      runPlaywrightVerify({
        shopId: "x",
        organizationId: "y",
        mode: "PLAYWRIGHT",
        verificationJobId: "z",
      })
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("HTTP POST /shops/:id/verify enqueues verify", async () => {
    const shop = await connectShop({ organizationId: orgId, region: "UK" });
    createdShopIds.push(shop.id);

    const accessToken = await signAccessToken({
      sub: ownerId,
      orgId,
      role: "OWNER",
    });

    const res = await request(app)
      .post(`/api/v1/shops/${shop.id}/verify`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.verificationJobId).toBeTruthy();
    // Test env skips enqueue; shop stays PENDING_INVITE until worker/processor runs.
    expect(res.body.status).toBe("PENDING_INVITE");
    const updated = await prisma.shop.findUniqueOrThrow({
      where: { id: shop.id },
    });
    expect(updated.status).toBe("PENDING_INVITE");
  }, 60000);
});
