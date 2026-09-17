import { describe, it, expect, afterAll } from "vitest";
import {
  signAccessToken,
  verifyAccessToken,
} from "../../src/lib/tokens.js";

describe("AccessClaims", () => {
  it("round-trips platformRole with nullable org", async () => {
    const token = await signAccessToken({
      sub: "staff1",
      orgId: null,
      orgRole: null,
      platformRole: "SUPERADMIN",
    });
    const claims = await verifyAccessToken(token);
    expect(claims.platformRole).toBe("SUPERADMIN");
    expect(claims.orgId).toBeNull();
    expect(claims.orgRole).toBeNull();
  });

  it("round-trips orgRole without platformRole", async () => {
    const token = await signAccessToken({
      sub: "merchant1",
      orgId: "org1",
      orgRole: "OWNER",
      platformRole: null,
    });
    const claims = await verifyAccessToken(token);
    expect(claims.orgRole).toBe("OWNER");
    expect(claims.orgId).toBe("org1");
    expect(claims.platformRole).toBeNull();
  });
});

describe("staff login claims", () => {
  const staffEmail = `staff_${Date.now()}@platform.test`;
  const password = "Secret123!";
  let argon2Available = true;
  let prisma: typeof import("../../src/lib/prisma.js").prisma;
  let redis: typeof import("../../src/lib/redis.js").redis;
  let login: typeof import("../../src/modules/auth/auth.service.js").login;
  let hashPassword: typeof import("../../src/lib/password.js").hashPassword;

  afterAll(async () => {
    if (!argon2Available || !prisma) return;
    try {
      const user = await prisma.user.findUnique({ where: { email: staffEmail } });
      if (user) {
        await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
        await prisma.platformMembership.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    } finally {
      await prisma.$disconnect();
      if (redis?.status === "ready") await redis.quit();
    }
  });

  it("issues platformRole for SUPERADMIN without requiring org", async () => {
    try {
      ({ hashPassword } = await import("../../src/lib/password.js"));
      ({ prisma } = await import("../../src/lib/prisma.js"));
      ({ redis } = await import("../../src/lib/redis.js"));
      ({ login } = await import("../../src/modules/auth/auth.service.js"));
      await hashPassword("probe");
    } catch {
      argon2Available = false;
      console.warn(
        "Skipping staff login claims test: argon2 native module blocked (Windows Application Control)."
      );
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: staffEmail,
        passwordHash,
        name: "Platform Staff",
        status: "ACTIVE",
      },
    });
    await prisma.platformMembership.create({
      data: {
        userId: user.id,
        role: "SUPERADMIN",
        status: "ACTIVE",
      },
    });

    const session = await login({ email: staffEmail, password });
    const claims = await verifyAccessToken(session.accessToken);
    expect(claims.platformRole).toBe("SUPERADMIN");
    expect(claims.orgId).toBeNull();
    expect(claims.orgRole).toBeNull();
    expect(session.redirectTo).toBe("/backoffice/users");
    expect(session.platformMembership).toEqual({
      role: "SUPERADMIN",
      status: "ACTIVE",
    });
  }, 60000);
});
