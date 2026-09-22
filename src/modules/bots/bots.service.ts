import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { assertBotCapacity } from "../../lib/entitlements.js";

export async function reserveBot(organizationId: string) {
  await assertBotCapacity(organizationId);

  const bot = await prisma.botIdentity.findFirst({
    where: { status: "AVAILABLE", shop: null },
    orderBy: { createdAt: "asc" },
  });
  if (!bot) throw new AppError("CONFLICT", "No bots available", 409);

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
