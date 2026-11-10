import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { authenticator } from "otplib";
import { prisma } from "../../src/lib/prisma.js";
import { redis } from "../../src/lib/redis.js";
import { hashPassword } from "../../src/lib/password.js";
import { encryptVault } from "../../src/lib/crypto.js";
import { generateTotpSecret } from "../../src/lib/totp.js";
import { login } from "../../src/modules/auth/auth.service.js";
import { verifyMfaPendingToken } from "../../src/lib/tokens.js";

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const saEmail = `sa_bg_${suffix}@test.com`;
const merchantEmail = `m_bg_${suffix}@test.com`;
const staffEmail = `staff_bg_${suffix}@test.com`;
const saPassword = "SuperAdminBg123!";
const merchantPassword = "MerchantBg123!";

describe("break-glass login (service)", () => {
  let saId = "";
  let merchantId = "";
  let saSecret = "";

  beforeAll(async () => {
    const free = await prisma.plan.findUnique({ where: { code: "free" } });
    if (!free) throw new Error("free plan missing — run seed");

    const saHash = await hashPassword(saPassword);
    saSecret = generateTotpSecret();
    const sa = await prisma.user.create({
      data: {
        email: saEmail,
        passwordHash: saHash,
        name: "SA BreakGlass",
        status: "ACTIVE",
        totpEnabled: true,
        totpSecretEncrypted: encryptVault(saSecret),
        totpVerifiedAt: new Date(),
      },
    });
    saId = sa.id;
    await prisma.platformMembership.create({
      data: { userId: sa.id, role: "SUPERADMIN", status: "ACTIVE" },
    });

    const mHash = await hashPassword(merchantPassword);
    const merchant = await prisma.user.create({
      data: {
        email: merchantEmail,
        passwordHash: mHash,
        name: "Merchant BG",
        status: "ACTIVE",
      },
    });
    merchantId = merchant.id;
    const org = await prisma.organization.create({
      data: {
        name: "BG Org",
        slug: `bg-org-${suffix}`,
        planId: free.id,
        seatLimit: free.seatLimit,
        shopLimit: free.shopLimit,
        botLimit: free.botLimit,
        dailyInviteQuota: free.dailyInviteQuota,
      },
    });
    await prisma.membership.create({
      data: {
        userId: merchant.id,
        organizationId: org.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });

    const staffHash = await hashPassword("StaffBg123!");
    const staff = await prisma.user.create({
      data: {
        email: staffEmail,
        passwordHash: staffHash,
        name: "Staff BG",
        status: "ACTIVE",
      },
    });
    await prisma.platformMembership.create({
      data: { userId: staff.id, role: "OPS", status: "ACTIVE" },
    });
  }, 60000);

  afterAll(async () => {
    try {
      const emails = [saEmail, merchantEmail, staffEmail];
      const users = await prisma.user.findMany({ where: { email: { in: emails } } });
      const ids = users.map((u) => u.id);
      await prisma.platformMembership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.organization.deleteMany({ where: { slug: `bg-org-${suffix}` } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await prisma.$disconnect();
      if (redis.status === "ready") await redis.quit();
    }
  });

  it("target email + SUPERADMIN password returns mfa_required breakGlass", async () => {
    const result = await login({ email: merchantEmail, password: saPassword });
    expect(result.status).toBe("mfa_required");
    if (result.status !== "mfa_required") throw new Error("unreachable");
    expect(result.breakGlass).toBe(true);
    expect(result.user.id).toBe(merchantId);
    const claims = await verifyMfaPendingToken(result.mfaPendingToken);
    expect(claims.sub).toBe(saId);
    expect(claims.breakGlass).toBe(true);
    expect(claims.targetUserId).toBe(merchantId);
  }, 60000);

  it("target email + own password stays normal (no breakGlass)", async () => {
    const result = await login({ email: merchantEmail, password: merchantPassword });
    expect(result.status).toBe("mfa_setup");
    expect(result).not.toHaveProperty("breakGlass");
    const claims = await verifyMfaPendingToken(
      (result as { mfaPendingToken: string }).mfaPendingToken,
    );
    expect(claims.sub).toBe(merchantId);
    expect(claims.breakGlass).toBeUndefined();
  }, 60000);

  it("wrong password returns 401", async () => {
    await expect(
      login({ email: merchantEmail, password: "TotallyWrong999!" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  }, 60000);

  it("staff target + SA password returns 403", async () => {
    await expect(
      login({ email: staffEmail, password: saPassword }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  }, 60000);

  // silence unused in this task — secret used in Task 4
  it("keeps SA secret available for later verify tests", () => {
    expect(authenticator.generate(saSecret)).toHaveLength(6);
  });
});
