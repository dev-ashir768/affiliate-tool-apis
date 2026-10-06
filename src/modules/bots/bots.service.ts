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

export async function reserveBot(organizationId: string) {
  await assertBotCapacity(organizationId);

  const bot = await prisma.botIdentity.findFirst({
    where: {
      status: "AVAILABLE",
      shop: null,
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
    data: {
      status: "RESERVED",
      reservedForOrgId: organizationId,
      reservedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    throw new AppError("CONFLICT", "Bot reservation race; retry", 409);
  }
  return prisma.botIdentity.findUniqueOrThrow({ where: { id: bot.id } });
}
