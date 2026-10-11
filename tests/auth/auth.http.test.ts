import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { redis } from "../../src/lib/redis.js";
import { env } from "../../src/config/env.js";
import { sha256 } from "../../src/lib/crypto.js";

function cookieHeaderFromSetCookie(
  setCookie: string | string[] | undefined
): string {
  const parts = Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")];
  return parts
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

/** Portal BFF header so auth JSON includes refreshToken when secret is configured. */
function bffHeaders() {
  const secret = env.PORTAL_BFF_SECRET;
  return secret ? { "X-Portal-Bff-Secret": secret } : {};
}

/** Enable TOTP + a trusted device for the user, then log in over HTTP to get a real session. */
async function loginViaTrustedDevice(
  app: ReturnType<typeof createApp>,
  email: string,
  password: string,
  asBff = true,
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: true },
  });
  const raw = `td_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await prisma.trustedDevice.create({
    data: {
      userId: user.id,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return request(app)
    .post("/api/v1/auth/login")
    .set(asBff ? bffHeaders() : {})
    .set("Cookie", `trusted_device=${raw}`)
    .send({ email, password });
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const sc = res.headers["set-cookie"];
  return Array.isArray(sc) ? (sc as string[]) : sc ? [String(sc)] : [];
}

describe("auth HTTP", () => {
  const email = `http_owner_${Date.now()}@test.com`;
  const password = "Secret123!";
  const app = createApp();

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
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

  it("register → me → refresh", async () => {
    const registerRes = await request(app)
      .post("/api/v1/auth/register")
      .set(bffHeaders())
      .send({
        email,
        password,
        name: "Ashir",
        organizationName: "HTTP Org",
      });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.status).toBe("mfa_setup");
    expect(registerRes.body.user.email).toBe(email);
    expect(registerRes.body.accessToken).toBeUndefined();
    expect(registerRes.body.refreshToken).toBeUndefined();
    const registerCookies = setCookies(registerRes);
    expect(registerCookies.some((c) => c.startsWith("mfa_pending="))).toBe(true);
    expect(registerCookies.some((c) => c.startsWith("refresh_token="))).toBe(false);
    if (env.PORTAL_BFF_SECRET) {
      expect(registerRes.body.mfaPendingToken).toBeTruthy();
    }

    // Login without TOTP: same challenge, still no session.
    const challengeRes = await request(app)
      .post("/api/v1/auth/login")
      .set(bffHeaders())
      .send({ email, password });
    expect(challengeRes.status).toBe(200);
    expect(challengeRes.body.status).toBe("mfa_setup");
    expect(challengeRes.body.accessToken).toBeUndefined();
    expect(challengeRes.body.refreshToken).toBeUndefined();
    expect(setCookies(challengeRes).some((c) => c.startsWith("refresh_token="))).toBe(false);

    // Without BFF header the pending token must not be in the JSON body.
    const noBffRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(noBffRes.body.mfaPendingToken).toBeUndefined();
    expect(setCookies(noBffRes).some((c) => c.startsWith("mfa_pending="))).toBe(true);

    // TOTP enabled, no trusted device: mfa_required.
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    const requiredRes = await request(app)
      .post("/api/v1/auth/login")
      .set(bffHeaders())
      .send({ email, password });
    expect(requiredRes.body.status).toBe("mfa_required");
    expect(requiredRes.body.accessToken).toBeUndefined();
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false } });

    // Trusted device cookie skips the challenge and yields a real session.
    const loginRes = await loginViaTrustedDevice(app, email, password);
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.status).toBe("authenticated");
    expect(loginRes.body.accessToken).toBeTruthy();
    expect(loginRes.body.refreshToken).toBeTruthy();
    expect(setCookies(loginRes).some((c) => c.startsWith("refresh_token="))).toBe(true);
    expect(
      setCookies(loginRes).some((c) => c.startsWith("mfa_pending=;")),
    ).toBe(true);

    const accessToken = loginRes.body.accessToken as string;
    const refreshToken = loginRes.body.refreshToken as string;

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);
    expect(meRes.body.memberships?.[0]?.role).toBe("OWNER");
    expect(meRes.body.memberships?.[0]?.organization?.planCode).toBe("free");

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set(bffHeaders())
      .send({ refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);

    // Parallel navigations refresh with the same token at once: all must
    // succeed and converge on one successor instead of logging the user out.
    const current = refreshRes.body.refreshToken as string;
    const burst = await Promise.all(
      [0, 1, 2].map(() =>
        request(app)
          .post("/api/v1/auth/refresh")
          .set(bffHeaders())
          .send({ refreshToken: current }),
      ),
    );
    for (const r of burst) expect(r.status).toBe(200);
    const successors = new Set(burst.map((r) => r.body.refreshToken));
    expect(successors.size).toBe(1);
    expect(successors.has(current)).toBe(false);

    // Lost response: the browser never stored the successor and retries with
    // the old token after the 30s grace. It must get the same successor back
    // while that successor is unused — and stop working once it is used.
    const lostOld = [...successors][0] as string;
    const rotated = await request(app)
      .post("/api/v1/auth/refresh")
      .set(bffHeaders())
      .send({ refreshToken: lostOld });
    expect(rotated.status).toBe(200);
    const successor = rotated.body.refreshToken as string;
    await redis.del(`refresh-grace:${sha256(lostOld)}`);

    const recovered = await request(app)
      .post("/api/v1/auth/refresh")
      .set(bffHeaders())
      .send({ refreshToken: lostOld });
    expect(recovered.status).toBe(200);
    expect(recovered.body.refreshToken).toBe(successor);

    const used = await request(app)
      .post("/api/v1/auth/refresh")
      .set(bffHeaders())
      .send({ refreshToken: successor });
    expect(used.status).toBe(200);
    await redis.del(`refresh-grace:${sha256(lostOld)}`);
    const stale = await request(app)
      .post("/api/v1/auth/refresh")
      .set(bffHeaders())
      .send({ refreshToken: lostOld });
    expect(stale.status).toBe(401);
  }, 60000);

  it("omits refreshToken JSON without BFF secret when secret is configured", async () => {
    if (!env.PORTAL_BFF_SECRET) return;

    const emailNoBff = `http_nobff_${Date.now()}@test.com`;
    const registerRes = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: emailNoBff,
        password,
        name: "No Bff",
        organizationName: "No Bff Org",
      });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.status).toBe("mfa_setup");
    expect(registerRes.body.mfaPendingToken).toBeUndefined();
    expect(registerRes.body.refreshToken).toBeUndefined();
    expect(setCookies(registerRes).some((c) => c.startsWith("mfa_pending="))).toBe(true);

    const loginRes = await loginViaTrustedDevice(app, emailNoBff, password, false);
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.status).toBe("authenticated");
    expect(loginRes.body.accessToken).toBeTruthy();
    expect(loginRes.body.refreshToken).toBeUndefined();
    expect(setCookies(loginRes).some((c) => c.startsWith("refresh_token="))).toBe(true);

    const user = await prisma.user.findUnique({ where: { email: emailNoBff } });
    if (user) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id },
      });
      const orgIds = memberships.map((m) => m.organizationId);
      await prisma.membership.deleteMany({ where: { userId: user.id } });
      if (orgIds.length) {
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await prisma.user.deleteMany({ where: { email: emailNoBff } });
    }
  }, 60000);

  it("prefers refresh_token cookie over stale body token", async () => {
    const email2 = `http_cookie_${Date.now()}@test.com`;
    const registerRes = await request(app)
      .post("/api/v1/auth/register")
      .set(bffHeaders())
      .send({
        email: email2,
        password,
        name: "Cookie Pref",
        organizationName: "Cookie Org",
      });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.status).toBe("mfa_setup");

    // Register no longer issues a session; get one via a trusted device.
    const loginRes = await loginViaTrustedDevice(app, email2, password);
    expect(loginRes.status).toBe(200);
    const staleRefresh = loginRes.body.refreshToken as string;
    expect(loginRes.headers["set-cookie"]).toBeDefined();

    // Rotate so the login token is revoked; cookie carries the valid token
    const rotateRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set(bffHeaders())
      .set("Cookie", cookieHeaderFromSetCookie(loginRes.headers["set-cookie"]))
      .send({});

    expect(rotateRes.status).toBe(200);
    const cookieRefresh = rotateRes.body.refreshToken as string;
    expect(cookieRefresh).not.toBe(staleRefresh);

    // Body stale (revoked); cookie valid — cookie must win
    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set(bffHeaders())
      .set("Cookie", cookieHeaderFromSetCookie(rotateRes.headers["set-cookie"]))
      .send({ refreshToken: staleRefresh });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.refreshToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).not.toBe(staleRefresh);
    expect(refreshRes.body.refreshToken).not.toBe(cookieRefresh);

    const user = await prisma.user.findUnique({ where: { email: email2 } });
    if (user) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id },
      });
      const orgIds = memberships.map((m) => m.organizationId);
      await prisma.membership.deleteMany({ where: { userId: user.id } });
      if (orgIds.length) {
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await prisma.user.deleteMany({ where: { email: email2 } });
    }
  }, 60000);
});
