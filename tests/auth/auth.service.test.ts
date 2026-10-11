import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import {
  register,
  login,
  findValidTrustedDevice,
} from "../../src/modules/auth/auth.service.js";
import { verifyMfaPendingToken } from "../../src/lib/tokens.js";
import { sha256 } from "../../src/lib/crypto.js";
import { redis } from "../../src/lib/redis.js";

describe("auth.service", () => {
  const email = `owner_${Date.now()}@test.com`;

  afterAll(async () => {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.trustedDevice.deleteMany({ where: { userId: user.id } });
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

  it("registers user with OWNER membership on free plan and returns mfa_setup challenge", async () => {
    const result = await register({
      email,
      password: "Secret123!",
      name: "Ashir",
      organizationName: "Tiksly Test",
    });
    expect(result.status).toBe("mfa_setup");
    expect(result.user.email).toBe(email);
    expect(result.organization.slug).toBeTruthy();
    expect(result.mfaPendingToken).toBeTruthy();
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("refreshToken");

    const { sub } = await verifyMfaPendingToken(result.mfaPendingToken);
    expect(sub).toBe(result.user.id);

    const membership = await prisma.membership.findFirst({
      where: { user: { email } },
    });
    expect(membership?.role).toBe("OWNER");
    expect(membership?.status).toBe("ACTIVE");

    const sessions = await prisma.refreshToken.count({
      where: { userId: result.user.id },
    });
    expect(sessions).toBe(0);
  }, 60000);

  it("login without TOTP returns mfa_setup challenge, no session", async () => {
    const result = await login({ email, password: "Secret123!" });
    expect(result.status).toBe("mfa_setup");
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("refreshToken");
    if (result.status !== "mfa_setup") throw new Error("unreachable");
    expect(result.mfaPendingToken).toBeTruthy();
    expect(result.user.email).toBe(email);
  }, 60000);

  it("login with TOTP enabled and no trusted device returns mfa_required", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true },
    });
    try {
      const result = await login({ email, password: "Secret123!" });
      expect(result.status).toBe("mfa_required");
      expect(result).not.toHaveProperty("accessToken");

      // Unknown trusted-device value must not skip the challenge.
      const bogus = await login({
        email,
        password: "Secret123!",
        trustedDeviceRaw: "not-a-real-device",
      });
      expect(bogus.status).toBe("mfa_required");
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { totpEnabled: false },
      });
    }
  }, 60000);

  it("trusted device skips the challenge only when valid; expired/revoked do not", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true },
    });
    const raw = `trusted-${Date.now()}`;
    const device = await prisma.trustedDevice.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    try {
      expect(await findValidTrustedDevice(user.id, raw)).toBe(true);
      expect(await findValidTrustedDevice("other-user", raw)).toBe(false);

      const ok = await login({
        email,
        password: "Secret123!",
        trustedDeviceRaw: raw,
      });
      expect(ok.status).toBe("authenticated");
      if (ok.status !== "authenticated") throw new Error("unreachable");
      expect(ok.accessToken).toBeTruthy();
      expect(ok.refreshToken).toBeTruthy();

      await prisma.trustedDevice.update({
        where: { id: device.id },
        data: { revokedAt: new Date() },
      });
      expect(await findValidTrustedDevice(user.id, raw)).toBe(false);
      const revoked = await login({
        email,
        password: "Secret123!",
        trustedDeviceRaw: raw,
      });
      expect(revoked.status).toBe("mfa_required");

      await prisma.trustedDevice.update({
        where: { id: device.id },
        data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await findValidTrustedDevice(user.id, raw)).toBe(false);
      const expired = await login({
        email,
        password: "Secret123!",
        trustedDeviceRaw: raw,
      });
      expect(expired.status).toBe("mfa_required");
    } finally {
      await prisma.trustedDevice.deleteMany({ where: { userId: user.id } });
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.user.update({
        where: { id: user.id },
        data: { totpEnabled: false },
      });
    }
  }, 60000);

  it("staff never skip the challenge via trusted device", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true },
    });
    const raw = `trusted-staff-${Date.now()}`;
    await prisma.trustedDevice.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.platformMembership.create({
      data: { userId: user.id, role: "SUPERADMIN", status: "ACTIVE" },
    });
    try {
      const result = await login({
        email,
        password: "Secret123!",
        trustedDeviceRaw: raw,
      });
      expect(result.status).toBe("mfa_required");
      expect(result).not.toHaveProperty("accessToken");
    } finally {
      await prisma.platformMembership.deleteMany({ where: { userId: user.id } });
      await prisma.trustedDevice.deleteMany({ where: { userId: user.id } });
      await prisma.user.update({
        where: { id: user.id },
        data: { totpEnabled: false },
      });
    }
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
