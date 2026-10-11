import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { redis } from "../../src/lib/redis.js";
import { env } from "../../src/config/env.js";

const app = createApp();
const password = "Secret123!";
const emails: string[] = [];

/** Each test gets its own client IP so the shared 5/min setup limit never bleeds across tests. */
function bffHeaders(ip: string) {
  return {
    ...(env.PORTAL_BFF_SECRET
      ? { "X-Portal-Bff-Secret": env.PORTAL_BFF_SECRET }
      : {}),
    "X-Client-IP": ip,
  };
}

function randomIp() {
  const n = () => Math.floor(Math.random() * 250) + 1;
  return `10.${n()}.${n()}.${n()}`;
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const sc = res.headers["set-cookie"];
  return Array.isArray(sc) ? (sc as string[]) : sc ? [String(sc)] : [];
}

async function registerUser(ip: string) {
  const email = `http_2fa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`;
  emails.push(email);
  const res = await request(app)
    .post("/api/v1/auth/register")
    .set(bffHeaders(ip))
    .send({ email, password, name: "Ashir", organizationName: "2FA Org" });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe("mfa_setup");
  const token = res.body.mfaPendingToken as string;
  expect(token).toBeTruthy();
  return { email, token };
}

function secretFromOtpauthUrl(url: string): string {
  const secret = new URL(url).searchParams.get("secret");
  expect(secret).toBeTruthy();
  return secret!;
}

describe("2FA setup HTTP", () => {
  afterAll(async () => {
    for (const email of emails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) continue;
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.twoFactorBackupCode.deleteMany({ where: { userId: user.id } });
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id },
      });
      const orgIds = memberships.map((m) => m.organizationId);
      await prisma.membership.deleteMany({ where: { userId: user.id } });
      if (orgIds.length) {
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await prisma.user.deleteMany({ where: { email } });
    }
    await prisma.$disconnect();
    if (redis.status === "ready") await redis.quit();
  });

  it("register → setup/start → confirm → authenticated with 10 backup codes; second confirm 409", async () => {
    const ip = randomIp();
    const { email, token } = await registerUser(ip);
    const auth = { ...bffHeaders(ip), Authorization: `Bearer ${token}` };

    const startRes = await request(app)
      .post("/api/v1/auth/2fa/setup/start")
      .set(auth);
    expect(startRes.status).toBe(200);
    expect(startRes.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const secret = secretFromOtpauthUrl(startRes.body.otpauthUrl);

    const confirmRes = await request(app)
      .post("/api/v1/auth/2fa/setup/confirm")
      .set(auth)
      .send({ code: authenticator.generate(secret) });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe("authenticated");
    expect(confirmRes.body.backupCodes).toHaveLength(10);
    expect(new Set(confirmRes.body.backupCodes).size).toBe(10);
    expect(confirmRes.body.accessToken).toBeTruthy();
    expect(confirmRes.body.refreshToken).toBeTruthy();
    expect(confirmRes.body.user.email).toBe(email);
    expect(confirmRes.body.redirectTo).toBeTruthy();

    const cookies = setCookies(confirmRes);
    expect(cookies.some((c) => c.startsWith("refresh_token=") && !c.startsWith("refresh_token=;"))).toBe(true);
    // mfa_pending cleared (expired / empty value)
    expect(cookies.some((c) => /^mfa_pending=;/.test(c))).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.totpEnabled).toBe(true);
    expect(user.totpSecretEncrypted).toBeTruthy();
    expect(user.totpSecretEncrypted).not.toContain(secret);
    expect(user.totpVerifiedAt).toBeTruthy();
    expect(await prisma.twoFactorBackupCode.count({ where: { userId: user.id } })).toBe(10);

    const again = await request(app)
      .post("/api/v1/auth/2fa/setup/confirm")
      .set(auth)
      .send({ code: authenticator.generate(secret) });
    expect(again.status).toBe(409);

    const startAgain = await request(app)
      .post("/api/v1/auth/2fa/setup/start")
      .set(auth);
    expect(startAgain.status).toBe(409);
  });

  it("rejects a wrong code and confirm without a prior start", async () => {
    const ip = randomIp();
    const { email, token } = await registerUser(ip);
    const auth = { ...bffHeaders(ip), Authorization: `Bearer ${token}` };

    const noStart = await request(app)
      .post("/api/v1/auth/2fa/setup/confirm")
      .set(auth)
      .send({ code: "123456" });
    expect(noStart.status).toBe(401);

    const startRes = await request(app)
      .post("/api/v1/auth/2fa/setup/start")
      .set(auth);
    const secret = secretFromOtpauthUrl(startRes.body.otpauthUrl);
    const good = authenticator.generate(secret);
    const bad = good === "000000" ? "000001" : "000000";

    const badRes = await request(app)
      .post("/api/v1/auth/2fa/setup/confirm")
      .set(auth)
      .send({ code: bad });
    expect(badRes.status).toBe(401);
    expect(badRes.body.accessToken).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.totpEnabled).toBe(false);
  });

  it("requires a valid MFA pending token (header or cookie)", async () => {
    const ip = randomIp();
    const missing = await request(app)
      .post("/api/v1/auth/2fa/setup/start")
      .set(bffHeaders(ip));
    expect(missing.status).toBe(401);

    const garbage = await request(app)
      .post("/api/v1/auth/2fa/setup/start")
      .set({ ...bffHeaders(ip), Authorization: "Bearer not-a-jwt" });
    expect(garbage.status).toBe(401);
  });

  it("accepts the mfa_pending cookie when Authorization is missing", async () => {
    const ip = randomIp();
    const { token } = await registerUser(ip);

    const startRes = await request(app)
      .post("/api/v1/auth/2fa/setup/start")
      .set(bffHeaders(ip))
      .set("Cookie", `mfa_pending=${token}`);
    expect(startRes.status).toBe(200);
    expect(startRes.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  });

  it("omits refreshToken from the body without the BFF secret", async () => {
    const ip = randomIp();
    const { token } = await registerUser(ip);
    const auth = { Authorization: `Bearer ${token}`, "X-Client-IP": ip };

    const startRes = await request(app)
      .post("/api/v1/auth/2fa/setup/start")
      .set(auth);
    expect(startRes.status).toBe(200);
    const secret = secretFromOtpauthUrl(startRes.body.otpauthUrl);

    const confirmRes = await request(app)
      .post("/api/v1/auth/2fa/setup/confirm")
      .set(auth)
      .send({ code: authenticator.generate(secret) });
    if (env.PORTAL_BFF_SECRET) {
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.refreshToken).toBeUndefined();
      expect(confirmRes.body.accessToken).toBeTruthy();
      expect(
        setCookies(confirmRes).some((c) => c.startsWith("refresh_token=") && !c.startsWith("refresh_token=;")),
      ).toBe(true);
    }
  });

  it("rate limits setup to 5/min per client", async () => {
    const ip = randomIp();
    const headers = bffHeaders(ip);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post("/api/v1/auth/2fa/setup/start").set(headers);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
