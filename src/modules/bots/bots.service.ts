import { randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { assertBotCapacity } from "../../lib/entitlements.js";

function liveVerify() {
  return (
    env.SHOP_VERIFY_MODE === "playwright" &&
    !env.PLAYWRIGHT_SHOP_VERIFY_DRY_RUN &&
    env.SHOP_VERIFY_TARGET === "live"
  );
}

function reservedData(organizationId: string) {
  return {
    status: "RESERVED" as const,
    reservedForOrgId: organizationId,
    reservedAt: new Date(),
  };
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function randomLocalPart(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += BASE32[b % 32];
  return `bot-${out}`;
}

/**
 * Bot for a new shop connection. Order:
 * 1. the organization's own idle self-serve bot (reconnect keeps its TikTok login),
 * 2. a freshly generated self-serve bot when BOT_EMAIL_DOMAIN is set,
 * 3. the staff-managed shared pool.
 */
export async function allocateBotForShop(organizationId: string) {
  await assertBotCapacity(organizationId);

  const owned = await prisma.botIdentity.findFirst({
    where: { ownerOrganizationId: organizationId, status: "AVAILABLE", shop: null },
    orderBy: [{ sessionCapturedAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
  });
  if (owned) {
    const updated = await prisma.botIdentity.updateMany({
      where: { id: owned.id, status: "AVAILABLE" },
      data: reservedData(organizationId),
    });
    if (updated.count === 1) {
      return prisma.botIdentity.findUniqueOrThrow({ where: { id: owned.id } });
    }
  }

  if (env.BOT_EMAIL_DOMAIN) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const email = `${randomLocalPart()}@${env.BOT_EMAIL_DOMAIN.toLowerCase()}`;
      const exists = await prisma.botIdentity.findUnique({ where: { email } });
      if (exists) continue;
      return prisma.botIdentity.create({
        data: { email, ownerOrganizationId: organizationId, ...reservedData(organizationId) },
      });
    }
    throw new AppError("CONFLICT", "Could not generate a bot email; retry", 409);
  }

  return reserveBot(organizationId);
}

/** Reserve a bot from the staff-managed shared pool. */
export async function reserveBot(organizationId: string) {
  await assertBotCapacity(organizationId);

  const bot = await prisma.botIdentity.findFirst({
    where: {
      status: "AVAILABLE",
      shop: null,
      ownerOrganizationId: null,
      // Live verify can only accept invites from a bot with a saved TikTok login.
      ...(liveVerify() ? { sessionVaultCiphertext: { not: null } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!bot) {
    throw new AppError(
      "CONFLICT",
      "No connection slots are free right now. Please try again later or contact support.",
      409,
    );
  }

  const updated = await prisma.botIdentity.updateMany({
    where: { id: bot.id, status: "AVAILABLE" },
    data: reservedData(organizationId),
  });
  if (updated.count !== 1) {
    throw new AppError("CONFLICT", "Bot reservation race; retry", 409);
  }
  return prisma.botIdentity.findUniqueOrThrow({ where: { id: bot.id } });
}
