import type { BotStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";

type ListParams = {
  page: number;
  pageSize: number;
  search?: string;
  status?: BotStatus;
};

const botInclude = {
  shop: {
    select: {
      id: true,
      status: true,
      region: true,
      displayName: true,
      organization: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.BotIdentityInclude;

type BotRow = Prisma.BotIdentityGetPayload<{ include: typeof botInclude }>;

function toPlatformBot(row: BotRow) {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    reservedAt: row.reservedAt,
    createdAt: row.createdAt,
    shop: row.shop
      ? {
          id: row.shop.id,
          status: row.shop.status,
          region: row.shop.region,
          displayName: row.shop.displayName,
          organization: row.shop.organization,
        }
      : null,
  };
}

export async function listPlatformBots(params: ListParams) {
  const where: Prisma.BotIdentityWhereInput = {
    ...(params.search
      ? { email: { contains: params.search, mode: "insensitive" } }
      : {}),
    ...(params.status ? { status: params.status } : {}),
  };

  const [total, rows, grouped] = await Promise.all([
    prisma.botIdentity.count({ where }),
    prisma.botIdentity.findMany({
      where,
      include: botInclude,
      orderBy: { createdAt: "asc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.botIdentity.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const counts = { AVAILABLE: 0, RESERVED: 0, ASSIGNED: 0, DISABLED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  return {
    data: rows.map(toPlatformBot),
    total,
    page: params.page,
    pageSize: params.pageSize,
    counts,
  };
}

export async function createPlatformBots(emails: string[], actorUserId: string) {
  const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()))];

  const existing = await prisma.botIdentity.findMany({
    where: { email: { in: normalized } },
    select: { email: true },
  });
  const existingSet = new Set(existing.map((e) => e.email));
  const toCreate = normalized.filter((e) => !existingSet.has(e));

  if (toCreate.length > 0) {
    await prisma.botIdentity.createMany({
      data: toCreate.map((email) => ({ email, status: "AVAILABLE" })),
      skipDuplicates: true,
    });
    await writeAuditLog({
      actorUserId,
      action: "platform.bot.create",
      entityType: "BotIdentity",
      meta: { emails: toCreate },
    });
  }

  return { created: toCreate, skipped: [...existingSet] };
}

export async function setPlatformBotEnabled(
  id: string,
  enabled: boolean,
  actorUserId: string,
) {
  const bot = await prisma.botIdentity.findUnique({
    where: { id },
    include: botInclude,
  });
  if (!bot) throw new AppError("NOT_FOUND", "Bot not found", 404);

  if (!enabled && bot.shop) {
    throw new AppError(
      "CONFLICT",
      "Bot is linked to a shop. Disconnect the shop first.",
      409,
    );
  }
  if (enabled && bot.status !== "DISABLED") {
    return toPlatformBot(bot);
  }

  const updated = await prisma.botIdentity.update({
    where: { id },
    data: enabled
      ? { status: "AVAILABLE", reservedForOrgId: null, reservedAt: null }
      : { status: "DISABLED", reservedForOrgId: null, reservedAt: null },
    include: botInclude,
  });

  await writeAuditLog({
    actorUserId,
    action: enabled ? "platform.bot.enable" : "platform.bot.disable",
    entityType: "BotIdentity",
    entityId: id,
    meta: { email: bot.email },
  });

  return toPlatformBot(updated);
}

export async function deletePlatformBot(id: string, actorUserId: string) {
  const bot = await prisma.botIdentity.findUnique({
    where: { id },
    include: botInclude,
  });
  if (!bot) throw new AppError("NOT_FOUND", "Bot not found", 404);
  if (bot.shop) {
    throw new AppError(
      "CONFLICT",
      "Bot is linked to a shop. Disconnect the shop first.",
      409,
    );
  }

  await prisma.botIdentity.delete({ where: { id } });
  await writeAuditLog({
    actorUserId,
    action: "platform.bot.delete",
    entityType: "BotIdentity",
    entityId: id,
    meta: { email: bot.email },
  });
}
