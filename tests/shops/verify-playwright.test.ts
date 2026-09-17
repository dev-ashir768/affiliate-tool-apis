import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/lib/password.js";
import { decryptVault } from "../../src/lib/crypto.js";
import { connectShop } from "../../src/modules/shops/shops.service.js";
import { requestVerify } from "../../src/modules/shops/verify.service.js";
import { runPlaywrightVerify } from "../../src/workers/shop-verify.playwright.scaffold.js";
import {
  ShopVerifyTerminalError,
  isShopVerifyTerminalError,
} from "../../src/workers/shop-verify.errors.js";
import { env } from "../../src/config/env.js";
import { redis } from "../../src/lib/redis.js";
import { UnrecoverableError } from "bullmq";

describe("shop verify playwright", () => {
  const suffix = Date.now();
  const ownerEmail = `pw_verify_owner_${suffix}@test.com`;

  let orgId = "";
  let planId = "";
  const createdShopIds: string[] = [];
  const ownedBotIds: string[] = [];

  beforeAll(async () => {
    const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
    planId = free.id;

    for (let i = 0; i < 3; i++) {
      const bot = await prisma.botIdentity.create({
        data: {
          email: `pw-verify-bot-${suffix}-${i}@test.com`,
          status: "AVAILABLE",
        },
      });
      ownedBotIds.push(bot.id);
    }

    const owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: await hashPassword("Secret123!"),
        name: "PW Verify Owner",
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: "PW Verify Org",
        slug: `pw-verify-org-${suffix}`,
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
        await prisma.shop.deleteMany({ where: { id: { in: createdShopIds } } });
      }
      await prisma.membership.deleteMany({ where: { organizationId: orgId } });
      if (orgId) {
        await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
      }
      await prisma.user.deleteMany({ where: { email: ownerEmail } });
      if (ownedBotIds.length) {
        await prisma.botIdentity.deleteMany({ where: { id: { in: ownedBotIds } } });
      }
    } finally {
      await prisma.$disconnect();
      await redis.quit().catch(() => undefined);
    }
  }, 60000);

  it("exposes typed terminal errors for invite outcomes", () => {
    const rejected = new ShopVerifyTerminalError("INVITE_REJECTED");
    expect(isShopVerifyTerminalError(rejected)).toBe(true);
    expect(rejected.reasonCode).toBe("INVITE_REJECTED");
    expect(rejected.message).toMatch(/rejected/i);

    const expired = new ShopVerifyTerminalError("INVITE_EXPIRED");
    expect(expired.message).toMatch(/expired/i);

    // Processor wraps terminal errors so BullMQ will not retry
    const wrapped = new UnrecoverableError(rejected.message);
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe(rejected.message);
  });

  it("dry-run PLAYWRIGHT activates with decryptable vault", async () => {
    if (!env.PLAYWRIGHT_SHOP_VERIFY_DRY_RUN) {
      console.warn(
        "skipping dry-run vault test: PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=false"
      );
      return;
    }

    const shop = await connectShop({ organizationId: orgId, region: "US" });
    createdShopIds.push(shop.id);
    const queued = await requestVerify(orgId, shop.id);

    await runPlaywrightVerify({
      shopId: shop.id,
      organizationId: orgId,
      mode: "PLAYWRIGHT",
      verificationJobId: queued.verificationJobId!,
    });

    const updated = await prisma.shop.findUniqueOrThrow({
      where: { id: shop.id },
    });
    expect(updated.status).toBe("ACTIVE");
    expect(updated.sessionVaultCiphertext).toBeTruthy();

    const payload = JSON.parse(decryptVault(updated.sessionVaultCiphertext!));
    expect(payload.mode).toBe("playwright-dry-run");
    expect(payload.verifiedAt).toBeTruthy();

    const job = await prisma.shopVerificationJob.findUniqueOrThrow({
      where: { id: queued.verificationJobId! },
    });
    expect(job.status).toBe("SUCCEEDED");
  }, 60000);
});
