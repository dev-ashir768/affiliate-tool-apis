import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { encryptVault } from "../../lib/crypto.js";
import { writeAuditLog } from "../../lib/audit.js";
import {
  buildOtpauthUrl,
  generateBackupCodes,
  generateTotpSecret,
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
