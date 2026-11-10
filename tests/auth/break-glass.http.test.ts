import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { redis } from "../../src/lib/redis.js";
import { env } from "../../src/config/env.js";
import { hashPassword } from "../../src/lib/password.js";
import { encryptVault } from "../../src/lib/crypto.js";
import { generateTotpSecret } from "../../src/lib/totp.js";
import { verifyAccessToken } from "../../src/lib/tokens.js";

const app = createApp();

function bffHeaders(ip: string) {
  return {
    ...(env.PORTAL_BFF_SECRET
      ? { "X-Portal-Bff-Secret": env.PORTAL_BFF_SECRET }
      : {}),
    "X-Client-IP": ip,
  };
}

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const saEmail = `sa_bg_http_${suffix}@test.com`;
const merchantEmail = `m_bg_http_${suffix}@test.com`;
const saPassword = "SuperAdminBgHttp123!";
const merchantPassword = "MerchantBgHttp123!";
const ip = `10.${Math.floor(Math.random() * 200) + 1}.20.30`;

describe("break-glass HTTP", () => {
  let saId = "";
  let merchantId = "";
  let saSecret = "";
  let orgSlug = "";

  beforeAll(async () => {
    const free = await prisma.plan.findUnique({ where: { code: "free" } });
    if (!free) throw new Error("free plan missing — run seed");

    saSecret = generateTotpSecret();
    const sa = await prisma.user.create({
      data: {
        email: saEmail,
        passwordHash: await hashPassword(saPassword),
        name: "SA BG HTTP",
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

    const merchant = await prisma.user.create({
      data: {
        email: merchantEmail,
        passwordHash: await hashPassword(merchantPassword),
        name: "Merchant BG HTTP",
        status: "ACTIVE",
      },
    });
    merchantId = merchant.id;
    orgSlug = `bg-http-org-${suffix}`;
    const org = await prisma.organization.create({
      data: {
        name: "BG HTTP Org",
        slug: orgSlug,
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
  }, 60000);

  afterAll(async () => {
    try {
      const users = await prisma.user.findMany({
        where: { email: { in: [saEmail, merchantEmail] } },
      });
      const ids = users.map((u) => u.id);
      await prisma.auditLog.deleteMany({
        where: { OR: [{ actorUserId: { in: ids } }, { entityId: { in: ids } }] },
      });
      await prisma.platformMembership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.organization.deleteMany({ where: { slug: orgSlug } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await prisma.$disconnect();
      if (redis.status === "ready") await redis.quit();
    }
  });

  it("login + setup blocked + verify mints target session and audit", async () => {
    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .set(bffHeaders(ip))
      .send({ email: merchantEmail, password: saPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.status).toBe("mfa_required");
    expect(loginRes.body.breakGlass).toBe(true);
    expect(loginRes.body.user.id).toBe(merchantId);
    const pending = loginRes.body.mfaPendingToken as string;
    expect(pending).toBeTruthy();

    const setupRes = await request(app)
      .post("/api/v1/auth/2fa/setup/start")
      .set({ ...bffHeaders(ip), Authorization: `Bearer ${pending}` });
    expect(setupRes.status).toBe(403);

    const verifyRes = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set({ ...bffHeaders(ip), Authorization: `Bearer ${pending}` })
      .send({ code: authenticator.generate(saSecret) });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.breakGlass).toBe(true);
    expect(verifyRes.body.user.id).toBe(merchantId);
    expect(verifyRes.body.accessToken).toBeTruthy();

    const claims = await verifyAccessToken(verifyRes.body.accessToken);
    expect(claims.sub).toBe(merchantId);
    expect(claims.platformRole).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: "auth.break_glass", actorUserId: saId, entityId: merchantId },
    });
    expect(audit).toBeTruthy();
  }, 60000);
});
