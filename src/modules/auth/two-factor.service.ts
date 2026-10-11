import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { randomBytes } from "node:crypto";
import { decryptVault, encryptVault, sha256 } from "../../lib/crypto.js";
import { writeAuditLog } from "../../lib/audit.js";
import {
  buildOtpauthUrl,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  verifyTotpCode,
} from "../../lib/totp.js";
import { redirectFor, resolveAccessClaims } from "./auth-claims.js";
import { issueSession } from "./auth.service.js";
import {
  deletePendingTotpSecret,
  getPendingTotpSecret,
  setPendingTotpSecret,
} from "./mfa-setup-store.js";

const alreadyEnabled = () =>
  new AppError("CONFLICT", "Two-factor authentication already enabled", 409);

export async function startTotpSetup(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpEnabled) throw alreadyEnabled();

  const secret = generateTotpSecret();
  // The store encrypts internally; pass plaintext.
  await setPendingTotpSecret(userId, secret, env.MFA_PENDING_TTL_SEC);
  return { otpauthUrl: buildOtpauthUrl(user.email, secret) };
}

export async function confirmTotpSetup(userId: string, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpEnabled) throw alreadyEnabled();

  const secret = await getPendingTotpSecret(userId);
  if (!secret || !verifyTotpCode(secret, code)) {
    throw new AppError("UNAUTHORIZED", "Invalid verification code", 401);
  }

  const { raw, hashes } = generateBackupCodes();
  await prisma.$transaction(async (tx) => {
    // Conditional claim: a concurrent confirm loses here instead of
    // overwriting the secret / duplicating backup codes.
    const claimed = await tx.user.updateMany({
      where: { id: userId, totpEnabled: false },
      data: {
        totpEnabled: true,
        totpSecretEncrypted: encryptVault(secret),
        totpVerifiedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw alreadyEnabled();
    await tx.twoFactorBackupCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    });
  });
  await deletePendingTotpSecret(userId);

  const { claims, platformMembership } = await resolveAccessClaims(userId);
  const session = await issueSession(claims);

  void writeAuditLog({
    actorUserId: userId,
    organizationId: claims.orgId,
    action: "auth.2fa.enabled",
    entityType: "User",
    entityId: userId,
    meta: { platformRole: claims.platformRole },
  });

  return {
    status: "authenticated" as const,
    backupCodes: raw,
    user: { id: user.id, email: user.email, name: user.name },
    organizationId: claims.orgId,
    platformMembership,
    redirectTo: redirectFor(claims.platformRole, claims.hasProductAccess),
    ...session,
  };
}

export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Atomically burns one unused backup code; false if absent or already used. */
async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const row = await prisma.twoFactorBackupCode.findFirst({
    where: { userId, codeHash: hashBackupCode(code), usedAt: null },
    select: { id: true },
  });
  if (!row) return false;
  // Conditional claim so concurrent submissions cannot both spend the code.
  const claimed = await prisma.twoFactorBackupCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1;
}

export async function verifyTotpLogin(
  userId: string,
  code: string,
  opts: { rememberDevice?: boolean; isStaff?: boolean; userAgent?: string },
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.status === "DISABLED") {
    throw new AppError("FORBIDDEN", "Account is disabled", 403);
  }
  if (!user.totpEnabled || !user.totpSecretEncrypted) {
    throw new AppError("FORBIDDEN", "Two-factor authentication is not enabled", 403);
  }

  const secret = decryptVault(user.totpSecretEncrypted);
  let backupUsed = false;
  if (!verifyTotpCode(secret, code)) {
    backupUsed = await consumeBackupCode(userId, code);
    if (!backupUsed) {
      throw new AppError("UNAUTHORIZED", "Invalid verification code", 401);
    }
  }

  const { claims, platformMembership } = await resolveAccessClaims(userId);
  const session = await issueSession(claims);

  // Staff must always complete a TOTP challenge; never mint a trusted device.
  let trustedDeviceRaw: string | undefined;
  if (opts.rememberDevice && !opts.isStaff && !claims.platformRole) {
    trustedDeviceRaw = randomBytes(32).toString("base64url");
    await prisma.trustedDevice.create({
      data: {
        userId,
        tokenHash: sha256(trustedDeviceRaw),
        label: opts.userAgent?.slice(0, 120) ?? null,
        expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS),
      },
    });
  }

  void writeAuditLog({
    actorUserId: userId,
    organizationId: claims.orgId,
    action: "auth.2fa.verified",
    entityType: "User",
    entityId: userId,
    meta: {
      platformRole: claims.platformRole,
      backupUsed,
      rememberDevice: Boolean(trustedDeviceRaw),
    },
  });

  return {
    status: "authenticated" as const,
    trustedDeviceRaw,
    user: { id: user.id, email: user.email, name: user.name },
    organizationId: claims.orgId,
    platformMembership,
    redirectTo: redirectFor(claims.platformRole, claims.hasProductAccess),
    ...session,
  };
}

export async function listTrustedDevices(userId: string) {
  const rows = await prisma.trustedDevice.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, createdAt: true, expiresAt: true },
  });
  return rows.map((d) => ({
    id: d.id,
    label: d.label,
    createdAt: d.createdAt.toISOString(),
    expiresAt: d.expiresAt.toISOString(),
  }));
}

export async function revokeTrustedDevice(userId: string, deviceId: string) {
  const res = await prisma.trustedDevice.updateMany({
    where: { id: deviceId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) {
    throw new AppError("NOT_FOUND", "Trusted device not found", 404);
  }
  void writeAuditLog({
    actorUserId: userId,
    action: "auth.2fa.trusted_device_revoked",
    entityType: "TrustedDevice",
    entityId: deviceId,
  });
}

export async function getTwoFactorStatus(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const [backupCodesRemaining, trustedDevices] = await Promise.all([
    prisma.twoFactorBackupCode.count({ where: { userId, usedAt: null } }),
    listTrustedDevices(userId),
  ]);
  return { enabled: user.totpEnabled, backupCodesRemaining, trustedDevices };
}