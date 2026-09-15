import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { redis } from "../../src/lib/redis.js";

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
      .send({ refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);
  }, 60000);
});
