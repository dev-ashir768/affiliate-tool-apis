import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { register, login } from "../../src/modules/auth/auth.service.js";
import { redis } from "../../src/lib/redis.js";

describe("auth.service", () => {
  const email = `owner_${Date.now()}@test.com`;

  afterAll(async () => {
    try {
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
    } finally {
      await prisma.$disconnect();
      if (redis.status === "ready") await redis.quit();
    }
  });

  it("registers user with OWNER membership on free plan", async () => {
    const result = await register({
      email,
      password: "Secret123!",
      name: "Ashir",
      organizationName: "Tiksly Test",
    });
    expect(result.user.email).toBe(email);
    expect(result.organization.slug).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    const membership = await prisma.membership.findFirst({
      where: { user: { email } },
    });
    expect(membership?.role).toBe("OWNER");
    expect(membership?.status).toBe("ACTIVE");
  }, 60000);

  it("logs in with same credentials", async () => {
    const result = await login({ email, password: "Secret123!" });
    expect(result.accessToken).toBeTruthy();
  }, 60000);

  it("rejects DISABLED users on login", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "DISABLED" },
    });
    await expect(login({ email, password: "Secret123!" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "ACTIVE" },
    });
  }, 60000);
});
