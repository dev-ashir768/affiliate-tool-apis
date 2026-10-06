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
    expect(registerRes.body.accessToken).toBeTruthy();
    expect(registerRes.body.refreshToken).toBeTruthy();
    expect(registerRes.headers["set-cookie"]).toBeDefined();

    const accessToken = registerRes.body.accessToken as string;
    const refreshToken = registerRes.body.refreshToken as string;

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
    expect(registerRes.body.accessToken).toBeTruthy();
    expect(registerRes.body.refreshToken).toBeUndefined();
    expect(registerRes.headers["set-cookie"]).toBeDefined();

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
    const staleRefresh = registerRes.body.refreshToken as string;
    expect(registerRes.headers["set-cookie"]).toBeDefined();

    // Rotate so register token is revoked; cookie carries the valid token
    const rotateRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set(bffHeaders())
      .set("Cookie", cookieHeaderFromSetCookie(registerRes.headers["set-cookie"]))
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
