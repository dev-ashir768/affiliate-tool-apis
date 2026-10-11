import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { redis } from "../../src/lib/redis.js";
import { env } from "../../src/config/env.js";
import { sha256 } from "../../src/lib/crypto.js";

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

/** Register + complete TOTP setup; returns what a later login/verify needs. */
async function registerWithTotp(ip: string) {
  const { email, token } = await registerUser(ip);
  const auth = { ...bffHeaders(ip), Authorization: `Bearer ${token}` };
  const startRes = await request(app).post("/api/v1/auth/2fa/setup/start").set(auth);
  const secret = secretFromOtpauthUrl(startRes.body.otpauthUrl);
  const confirmRes = await request(app)
    .post("/api/v1/auth/2fa/setup/confirm")
    .set(auth)
    .send({ code: authenticator.generate(secret) });
  expect(confirmRes.status).toBe(200);
  return {
    email,
    secret,
    backupCodes: confirmRes.body.backupCodes as string[],
    accessToken: confirmRes.body.accessToken as string,
  };
}

/** Password login; returns the MFA pending token (or the full response). */
async function loginChallenge(ip: string, email: string, cookie?: string) {
  const req = request(app)
    .post("/api/v1/auth/login")
    .set(bffHeaders(ip))
    .send({ email, password });
  const res = cookie ? await req.set("Cookie", cookie) : await req;
  expect(res.status).toBe(200);
  return res;
}

function verifyReq(ip: string, pendingToken: string) {
  return request(app)
    .post("/api/v1/auth/2fa/verify")
    .set({ ...bffHeaders(ip), Authorization: `Bearer ${pendingToken}` });
}

function liveCookie(cookies: string[], name: string): string | undefined {
  const c = cookies.find((x) => x.startsWith(`${name}=`) && !x.startsWith(`${name}=;`));
  return c?.split(";")[0].slice(name.length + 1);
}

describe("2FA setup HTTP", () => {
  afterAll(async () => {
    for (const email of emails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) continue;
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.trustedDevice.deleteMany({ where: { userId: user.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.platformMembership.deleteMany({ where: { userId: user.id } });
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

  describe("verify + trusted devices", () => {
    it("login -> verify with TOTP authenticates, clears mfa_pending, no trusted cookie by default", async () => {
      const ip = randomIp();
      const { email, secret } = await registerWithTotp(ip);

      const challenge = await loginChallenge(ip, email);
      expect(challenge.body.status).toBe("mfa_required");
      expect(challenge.body.accessToken).toBeUndefined();

      const res = await verifyReq(ip, challenge.body.mfaPendingToken).send({
        code: authenticator.generate(secret),
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("authenticated");
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.user.email).toBe(email);
      expect(res.body.redirectTo).toBeTruthy();

      const cookies = setCookies(res);
      expect(liveCookie(cookies, "refresh_token")).toBeTruthy();
      expect(cookies.some((c) => /^mfa_pending=;/.test(c))).toBe(true);
      expect(liveCookie(cookies, "trusted_device")).toBeUndefined();
    });

    it("rejects a wrong code and requires a pending token", async () => {
      const ip = randomIp();
      const { email, secret } = await registerWithTotp(ip);
      const challenge = await loginChallenge(ip, email);

      const good = authenticator.generate(secret);
      const bad = good === "000000" ? "000001" : "000000";
      const badRes = await verifyReq(ip, challenge.body.mfaPendingToken).send({ code: bad });
      expect(badRes.status).toBe(401);
      expect(badRes.body.accessToken).toBeUndefined();

      const noToken = await request(app)
        .post("/api/v1/auth/2fa/verify")
        .set(bffHeaders(ip))
        .send({ code: good });
      expect(noToken.status).toBe(401);
    });

    it("accepts a backup code once; reuse fails", async () => {
      const ip = randomIp();
      const { email, backupCodes } = await registerWithTotp(ip);
      const code = backupCodes[0];

      const first = await loginChallenge(ip, email);
      const ok = await verifyReq(ip, first.body.mfaPendingToken).send({ code });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe("authenticated");

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const used = await prisma.twoFactorBackupCode.count({
        where: { userId: user.id, usedAt: { not: null } },
      });
      expect(used).toBe(1);

      const second = await loginChallenge(ip, email);
      const reuse = await verifyReq(ip, second.body.mfaPendingToken).send({ code });
      expect(reuse.status).toBe(401);
      expect(reuse.body.accessToken).toBeUndefined();

      // A different, unused backup code still works.
      const other = await verifyReq(ip, second.body.mfaPendingToken).send({
        code: backupCodes[1].toUpperCase(),
      });
      expect(other.status).toBe(200);
    });

    it("rememberDevice sets trusted_device cookie for merchants; next login skips TOTP; revoke restores challenge", async () => {
      const ip = randomIp();
      const { email, secret, accessToken } = await registerWithTotp(ip);
      const challenge = await loginChallenge(ip, email);

      const res = await verifyReq(ip, challenge.body.mfaPendingToken)
        .set("User-Agent", "vitest-device/1.0")
        .send({ code: authenticator.generate(secret), rememberDevice: true });
      expect(res.status).toBe(200);

      const raw = liveCookie(setCookies(res), "trusted_device");
      expect(raw).toBeTruthy();
      const cookieHeader = setCookies(res).find((c) => c.startsWith("trusted_device="))!;
      expect(cookieHeader).toMatch(/HttpOnly/i);
      expect(cookieHeader).toMatch(/Max-Age=2592000/);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const devices = await prisma.trustedDevice.findMany({ where: { userId: user.id } });
      expect(devices).toHaveLength(1);
      expect(devices[0].tokenHash).toBe(sha256(raw!));
      expect(devices[0].tokenHash).not.toBe(raw);
      expect(devices[0].label).toBe("vitest-device/1.0");

      // Trusted device skips the TOTP challenge.
      const skip = await loginChallenge(ip, email, `trusted_device=${raw}`);
      expect(skip.body.status).toBe("authenticated");
      expect(skip.body.accessToken).toBeTruthy();

      const authz = { ...bffHeaders(ip), Authorization: `Bearer ${res.body.accessToken ?? accessToken}` };
      const status = await request(app).get("/api/v1/auth/2fa/status").set(authz);
      expect(status.status).toBe(200);
      expect(status.body.enabled).toBe(true);
      expect(status.body.trustedDevices).toHaveLength(1);
      const deviceId = status.body.trustedDevices[0].id as string;

      const unknown = await request(app)
        .delete("/api/v1/auth/2fa/trusted-devices/does-not-exist")
        .set(authz);
      expect(unknown.status).toBe(404);

      const del = await request(app)
        .delete(`/api/v1/auth/2fa/trusted-devices/${deviceId}`)
        .set(authz);
      expect(del.status).toBe(204);

      const after = await loginChallenge(ip, email, `trusted_device=${raw}`);
      expect(after.body.status).toBe("mfa_required");
      const again = await request(app)
        .delete(`/api/v1/auth/2fa/trusted-devices/${deviceId}`)
        .set(authz);
      expect(again.status).toBe(404);
    });

    it("ignores rememberDevice for staff", async () => {
      const ip = randomIp();
      const { email, secret } = await registerWithTotp(ip);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.platformMembership.create({
        data: { userId: user.id, role: "SUPERADMIN", status: "ACTIVE" },
      });

      const challenge = await loginChallenge(ip, email);
      expect(challenge.body.status).toBe("mfa_required");
      const res = await verifyReq(ip, challenge.body.mfaPendingToken).send({
        code: authenticator.generate(secret),
        rememberDevice: true,
      });
      expect(res.status).toBe(200);
      expect(liveCookie(setCookies(res), "trusted_device")).toBeUndefined();
      expect(await prisma.trustedDevice.count({ where: { userId: user.id } })).toBe(0);
    });

    it("password reset revokes all trusted devices", async () => {
      const ip = randomIp();
      const { email, secret } = await registerWithTotp(ip);
      const challenge = await loginChallenge(ip, email);
      const res = await verifyReq(ip, challenge.body.mfaPendingToken).send({
        code: authenticator.generate(secret),
        rememberDevice: true,
      });
      const raw = liveCookie(setCookies(res), "trusted_device")!;
      expect(raw).toBeTruthy();

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const resetRaw = `reset-${Math.random().toString(36).slice(2)}`;
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(resetRaw),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      const reset = await request(app)
        .post("/api/v1/auth/reset-password")
        .set(bffHeaders(ip))
        .send({ token: resetRaw, password: "NewSecret456!" });
      expect(reset.status).toBe(200);

      const devices = await prisma.trustedDevice.findMany({ where: { userId: user.id } });
      expect(devices.length).toBeGreaterThan(0);
      expect(devices.every((d) => d.revokedAt !== null)).toBe(true);

      const relogin = await request(app)
        .post("/api/v1/auth/login")
        .set(bffHeaders(ip))
        .set("Cookie", `trusted_device=${raw}`)
        .send({ email, password: "NewSecret456!" });
      expect(relogin.status).toBe(200);
      expect(relogin.body.status).toBe("mfa_required");
    });

    it("rate limits verify to 5/min per client", async () => {
      const ip = randomIp();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await request(app)
          .post("/api/v1/auth/2fa/verify")
          .set(bffHeaders(ip))
          .send({ code: "123456" });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
      expect(statuses[5]).toBe(429);
    });
  });

  describe("status, regenerate, admin reset", () => {
    function authz(ip: string, token: string) {
      return { ...bffHeaders(ip), Authorization: `Bearer ${token}` };
    }

    /** A SUPERADMIN with TOTP, logged in through the full challenge. */
    async function superadminToken(ip: string) {
      const { email, secret } = await registerWithTotp(ip);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.platformMembership.create({
        data: { userId: user.id, role: "SUPERADMIN", status: "ACTIVE" },
      });
      const challenge = await loginChallenge(ip, email);
      const res = await verifyReq(ip, challenge.body.mfaPendingToken).send({
        code: authenticator.generate(secret),
      });
      expect(res.status).toBe(200);
      return res.body.accessToken as string;
    }

    it("status reports enabled and remaining backup codes", async () => {
      const ip = randomIp();
      const { accessToken, backupCodes, email } = await registerWithTotp(ip);
      const res = await request(app).get("/api/v1/auth/2fa/status").set(authz(ip, accessToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        enabled: true,
        backupCodesRemaining: 10,
        trustedDevices: [],
      });

      const challenge = await loginChallenge(ip, email);
      await verifyReq(ip, challenge.body.mfaPendingToken).send({ code: backupCodes[0] });
      const after = await request(app).get("/api/v1/auth/2fa/status").set(authz(ip, accessToken));
      expect(after.body.backupCodesRemaining).toBe(9);
    });

    it("regenerate with valid TOTP replaces all backup codes", async () => {
      const ip = randomIp();
      const { accessToken, secret, backupCodes, email } = await registerWithTotp(ip);
      const res = await request(app)
        .post("/api/v1/auth/2fa/backup-codes/regenerate")
        .set(authz(ip, accessToken))
        .send({ code: authenticator.generate(secret) });
      expect(res.status).toBe(200);
      expect(res.body.backupCodes).toHaveLength(10);
      expect(new Set(res.body.backupCodes).size).toBe(10);
      expect(res.body.backupCodes.some((c: string) => backupCodes.includes(c))).toBe(false);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(await prisma.twoFactorBackupCode.count({ where: { userId: user.id } })).toBe(10);

      // Old code no longer works, a new one does.
      const c1 = await loginChallenge(ip, email);
      const old = await verifyReq(ip, c1.body.mfaPendingToken).send({ code: backupCodes[0] });
      expect(old.status).toBe(401);
      const fresh = await verifyReq(ip, c1.body.mfaPendingToken).send({
        code: res.body.backupCodes[0],
      });
      expect(fresh.status).toBe(200);

      const audit = await prisma.auditLog.findFirst({
        where: { action: "auth.2fa.backup_codes_regenerated", entityId: user.id },
      });
      expect(audit).toBeTruthy();
    });

    it("regenerate rejects a wrong code, a backup code, and no auth; keeps existing codes", async () => {
      const ip = randomIp();
      const { accessToken, secret, backupCodes, email } = await registerWithTotp(ip);
      const good = authenticator.generate(secret);
      const bad = good === "000000" ? "000001" : "000000";
      const url = "/api/v1/auth/2fa/backup-codes/regenerate";

      const wrong = await request(app).post(url).set(authz(ip, accessToken)).send({ code: bad });
      expect(wrong.status).toBe(401);
      const viaBackup = await request(app)
        .post(url)
        .set(authz(ip, accessToken))
        .send({ code: backupCodes[0] });
      expect(viaBackup.status).toBe(401);
      const anon = await request(app).post(url).set(bffHeaders(ip)).send({ code: good });
      expect(anon.status).toBe(401);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(
        await prisma.twoFactorBackupCode.count({ where: { userId: user.id, usedAt: null } }),
      ).toBe(10);
    });

    it("superadmin reset clears 2FA, revokes devices and refresh tokens, audits; target must re-enroll", async () => {
      const ip = randomIp();
      const adminToken = await superadminToken(ip);

      const target = await registerWithTotp(ip);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: target.email } });
      const challenge = await loginChallenge(ip, target.email);
      const verified = await verifyReq(ip, challenge.body.mfaPendingToken).send({
        code: authenticator.generate(target.secret),
        rememberDevice: true,
      });
      expect(verified.status).toBe(200);
      const trusted = liveCookie(setCookies(verified), "trusted_device")!;
      expect(trusted).toBeTruthy();
      expect(
        await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } }),
      ).toBeGreaterThan(0);

      const res = await request(app)
        .post("/api/v1/auth/2fa/admin/reset")
        .set(authz(ip, adminToken))
        .send({ userId: user.id });
      expect(res.status).toBe(204);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.totpEnabled).toBe(false);
      expect(after.totpSecretEncrypted).toBeNull();
      expect(after.totpVerifiedAt).toBeNull();
      expect(await prisma.twoFactorBackupCode.count({ where: { userId: user.id } })).toBe(0);
      const devices = await prisma.trustedDevice.findMany({ where: { userId: user.id } });
      expect(devices.length).toBeGreaterThan(0);
      expect(devices.every((d) => d.revokedAt !== null)).toBe(true);
      expect(
        await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } }),
      ).toBe(0);

      // Trusted device no longer skips; user is sent back to enrollment.
      const relogin = await loginChallenge(ip, target.email, `trusted_device=${trusted}`);
      expect(relogin.body.status).toBe("mfa_setup");

      const audit = await prisma.auditLog.findFirst({
        where: { action: "auth.2fa.admin_reset", entityId: user.id },
      });
      expect(audit).toBeTruthy();
      expect(audit!.actorUserId).not.toBe(user.id);
      await prisma.auditLog.deleteMany({ where: { action: "auth.2fa.admin_reset", entityId: user.id } });
    });

    it("admin reset: non-superadmin 403, unauthenticated 401, unknown user 404, bad body 400", async () => {
      const ip = randomIp();
      const merchant = await registerWithTotp(ip);
      const url = "/api/v1/auth/2fa/admin/reset";

      const forbidden = await request(app)
        .post(url)
        .set(authz(ip, merchant.accessToken))
        .send({ userId: "whatever" });
      expect(forbidden.status).toBe(403);

      // OPS staff is not enough either.
      const opsIp = randomIp();
      const ops = await registerWithTotp(opsIp);
      const opsUser = await prisma.user.findUniqueOrThrow({ where: { email: ops.email } });
      await prisma.platformMembership.create({
        data: { userId: opsUser.id, role: "OPS", status: "ACTIVE" },
      });
      const opsChallenge = await loginChallenge(opsIp, ops.email);
      const opsVerified = await verifyReq(opsIp, opsChallenge.body.mfaPendingToken).send({
        code: authenticator.generate(ops.secret),
      });
      const opsRes = await request(app)
        .post(url)
        .set(authz(opsIp, opsVerified.body.accessToken))
        .send({ userId: opsUser.id });
      expect(opsRes.status).toBe(403);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: opsUser.id } })).totpEnabled,
      ).toBe(true);

      const anon = await request(app).post(url).set(bffHeaders(ip)).send({ userId: "x" });
      expect(anon.status).toBe(401);

      const adminToken = await superadminToken(randomIp());
      const missing = await request(app)
        .post(url)
        .set(authz(ip, adminToken))
        .send({ userId: "does-not-exist" });
      expect(missing.status).toBe(404);
      const badBody = await request(app).post(url).set(authz(ip, adminToken)).send({});
      expect(badBody.status).toBe(400);
    });
  });});
