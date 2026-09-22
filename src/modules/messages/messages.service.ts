import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import {
  createTikTokConversation,
  listTikTokConversationMessages,
  listTikTokConversations,
  listTikTokNewestUnread,
  markTikTokConversationsRead,
  sendTikTokImMessage,
} from "../../lib/tiktok-shop/client.js";
import { getShopOpenApiCredentials } from "../shops/tiktok-oauth.service.js";

function toConversation(row: {
  id: string;
  shopId: string;
  creatorId: string | null;
  externalConversationId: string;
  creatorImId: string | null;
  creatorUsername: string | null;
  avatarUrl: string | null;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  creator?: { handle: string; displayName: string | null } | null;
  shop?: { displayName: string | null; region: string } | null;
}) {
  return {
    id: row.id,
    shopId: row.shopId,
    shopDisplayName: row.shop?.displayName ?? null,
    shopRegion: row.shop?.region ?? null,
    creatorId: row.creatorId,
    creatorHandle: row.creator?.handle ?? null,
    creatorDisplayName: row.creator?.displayName ?? null,
    externalConversationId: row.externalConversationId,
    creatorImId: row.creatorImId,
    creatorUsername: row.creatorUsername,
    avatarUrl: row.avatarUrl,
    unreadCount: row.unreadCount,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessage(row: {
  id: string;
  externalMessageId: string | null;
  direction: string;
  msgType: string;
  contentText: string | null;
  contentRaw: string | null;
  senderImId: string | null;
  status: string;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    externalMessageId: row.externalMessageId,
    direction: row.direction,
    msgType: row.msgType,
    contentText: row.contentText,
    contentRaw: row.contentRaw,
    senderImId: row.senderImId,
    status: row.status,
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function assertOAuthShop(organizationId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({
    where: {
      id: shopId,
      organizationId,
      status: { not: "DISCONNECTED" },
    },
  });
  if (!shop) throw new AppError("NOT_FOUND", "Shop not found", 404);
  if (!shop.oauthConnectedAt) {
    throw new AppError(
      "SHOP_NOT_READY",
      "Shop has not completed TikTok OAuth",
      400,
    );
  }
  const credentials = await getShopOpenApiCredentials(organizationId, shopId);
  return { shop, credentials };
}

async function linkCreatorByUsername(
  organizationId: string,
  username: string | null,
  creatorImId: string | null,
) {
  if (!username && !creatorImId) return null;
  const handle = username?.replace(/^@/, "").trim();
  const creator = await prisma.creator.findFirst({
    where: {
      organizationId,
      platform: "TIKTOK",
      OR: [
        ...(handle ? [{ handle }] : []),
        ...(creatorImId ? [{ creatorImId }] : []),
      ],
    },
  });
  if (creator && creatorImId && !creator.creatorImId) {
    await prisma.creator.update({
      where: { id: creator.id },
      data: { creatorImId },
    });
  }
  return creator?.id ?? null;
}

export async function syncAndListConversations(
  organizationId: string,
  input: {
    shopId: string;
    pageSize?: number;
    pageToken?: string | null;
    sync?: boolean;
  },
) {
  const { credentials } = await assertOAuthShop(organizationId, input.shopId);
  const shouldSync = input.sync !== false;

  let nextPageToken: string | null = null;
  let hasMore = false;

  if (shouldSync) {
    const remote = await listTikTokConversations({
      credentials,
      pageSize: input.pageSize,
      pageToken: input.pageToken,
      onlyNeedConversationId: false,
    });
    nextPageToken = remote.nextPageToken;
    hasMore = remote.hasMore;

    for (const c of remote.conversations) {
      const creatorId = await linkCreatorByUsername(
        organizationId,
        c.username,
        c.creatorImId,
      );
      await prisma.creatorConversation.upsert({
        where: {
          shopId_externalConversationId: {
            shopId: input.shopId,
            externalConversationId: c.id,
          },
        },
        create: {
          organizationId,
          shopId: input.shopId,
          creatorId,
          externalConversationId: c.id,
          creatorImId: c.creatorImId,
          creatorUsername: c.username,
          avatarUrl: c.avatarUrl,
          unreadCount: c.unreadCount,
          lastSyncedAt: new Date(),
        },
        update: {
          creatorId: creatorId ?? undefined,
          creatorImId: c.creatorImId ?? undefined,
          creatorUsername: c.username ?? undefined,
          avatarUrl: c.avatarUrl ?? undefined,
          unreadCount: c.unreadCount,
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  const rows = await prisma.creatorConversation.findMany({
    where: { organizationId, shopId: input.shopId },
    include: {
      creator: { select: { handle: true, displayName: true } },
      shop: { select: { displayName: true, region: true } },
    },
    orderBy: [{ unreadCount: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });

  return {
    conversations: rows.map(toConversation),
    nextPageToken,
    hasMore,
    synced: shouldSync,
  };
}

export async function openConversationWithCreator(
  organizationId: string,
  actorUserId: string | undefined,
  input: { shopId: string; creatorId: string },
) {
  const { credentials } = await assertOAuthShop(organizationId, input.shopId);
  const creator = await prisma.creator.findFirst({
    where: { id: input.creatorId, organizationId },
  });
  if (!creator) throw new AppError("NOT_FOUND", "Creator not found", 404);
  if (!creator.creatorOpenId) {
    throw new AppError(
      "FAILED_PRECONDITION",
      "Creator missing creatorOpenId — sync Discover then Save to CRM",
      400,
    );
  }

  const remote = await createTikTokConversation({
    credentials,
    creatorOpenId: creator.creatorOpenId,
  });

  if (remote.creatorImId && !creator.creatorImId) {
    await prisma.creator.update({
      where: { id: creator.id },
      data: { creatorImId: remote.creatorImId },
    });
  }

  const row = await prisma.creatorConversation.upsert({
    where: {
      shopId_externalConversationId: {
        shopId: input.shopId,
        externalConversationId: remote.conversationId,
      },
    },
    create: {
      organizationId,
      shopId: input.shopId,
      creatorId: creator.id,
      externalConversationId: remote.conversationId,
      creatorImId: remote.creatorImId,
      creatorUsername: remote.username ?? creator.handle,
      avatarUrl: remote.avatarUrl,
      unreadCount: remote.unreadCount,
      lastSyncedAt: new Date(),
    },
    update: {
      creatorId: creator.id,
      creatorImId: remote.creatorImId ?? undefined,
      creatorUsername: remote.username ?? undefined,
      avatarUrl: remote.avatarUrl ?? undefined,
      unreadCount: remote.unreadCount,
      lastSyncedAt: new Date(),
    },
    include: {
      creator: { select: { handle: true, displayName: true } },
      shop: { select: { displayName: true, region: true } },
    },
  });

  if (actorUserId) {
    await writeAuditLog({
      actorUserId,
      action: "messages.conversation.open",
      entityType: "CreatorConversation",
      entityId: row.id,
      meta: {
        shopId: input.shopId,
        creatorId: creator.id,
        isNew: remote.isNew,
      },
    });
  }

  return { conversation: toConversation(row), isNew: remote.isNew };
}

export async function listConversationMessages(
  organizationId: string,
  conversationId: string,
  input?: { pageSize?: number; pageToken?: string | null; sync?: boolean },
) {
  const local = await prisma.creatorConversation.findFirst({
    where: { id: conversationId, organizationId },
  });
  if (!local) throw new AppError("NOT_FOUND", "Conversation not found", 404);

  const { credentials } = await assertOAuthShop(organizationId, local.shopId);
  const shouldSync = input?.sync !== false;

  let nextPageToken: string | null = null;
  let hasMore = false;

  if (shouldSync) {
    const remote = await listTikTokConversationMessages({
      credentials,
      conversationId: local.externalConversationId,
      pageSize: input?.pageSize,
      pageToken: input?.pageToken,
    });
    nextPageToken = remote.nextPageToken;
    hasMore = remote.hasMore;

    for (const m of remote.messages) {
      const direction =
        m.type === "SYSTEM" || m.type === "NOTIFICATION"
          ? ("SYSTEM" as const)
          : m.senderId && local.creatorImId && m.senderId === local.creatorImId
            ? ("INBOUND" as const)
            : ("OUTBOUND" as const);

      if (m.id) {
        const existing = await prisma.creatorImMessage.findFirst({
          where: {
            conversationId: local.id,
            externalMessageId: m.id,
          },
        });
        if (existing) {
          await prisma.creatorImMessage.update({
            where: { id: existing.id },
            data: {
              contentText: m.contentText,
              contentRaw: m.contentRaw,
              msgType: m.type ?? "TEXT",
              senderImId: m.senderId,
              direction,
              sentAt: m.createTime
                ? new Date(m.createTime * 1000)
                : existing.sentAt,
            },
          });
          continue;
        }
      }

      await prisma.creatorImMessage.create({
        data: {
          conversationId: local.id,
          externalMessageId: m.id,
          direction,
          msgType: m.type ?? "TEXT",
          contentText: m.contentText,
          contentRaw: m.contentRaw,
          senderImId: m.senderId,
          status: direction === "OUTBOUND" ? "SENT" : "RECEIVED",
          sentAt: m.createTime ? new Date(m.createTime * 1000) : new Date(),
        },
      });
    }

    const latest = remote.messages
      .slice()
      .sort((a, b) => (a.createTime ?? 0) - (b.createTime ?? 0))
      .at(-1);
    await prisma.creatorConversation.update({
      where: { id: local.id },
      data: {
        lastSyncedAt: new Date(),
        lastMessagePreview: latest?.contentText ?? undefined,
        lastMessageAt: latest?.createTime
          ? new Date(latest.createTime * 1000)
          : undefined,
      },
    });
  }

  const messages = await prisma.creatorImMessage.findMany({
    where: { conversationId: local.id },
    orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
    take: 200,
  });

  return {
    conversationId: local.id,
    externalConversationId: local.externalConversationId,
    messages: messages.map(toMessage),
    nextPageToken,
    hasMore,
    synced: shouldSync,
  };
}

export async function sendConversationMessage(
  organizationId: string,
  actorUserId: string | undefined,
  conversationId: string,
  text: string,
) {
  const local = await prisma.creatorConversation.findFirst({
    where: { id: conversationId, organizationId },
  });
  if (!local) throw new AppError("NOT_FOUND", "Conversation not found", 404);

  const { credentials } = await assertOAuthShop(organizationId, local.shopId);

  const pending = await prisma.creatorImMessage.create({
    data: {
      conversationId: local.id,
      direction: "OUTBOUND",
      msgType: "TEXT",
      contentText: text,
      contentRaw: JSON.stringify({ content: text }),
      status: "SENT",
      sentAt: new Date(),
    },
  });

  try {
    const sent = await sendTikTokImMessage({
      credentials,
      conversationId: local.externalConversationId,
      text,
    });

    const updated = await prisma.creatorImMessage.update({
      where: { id: pending.id },
      data: {
        externalMessageId: sent.messageId,
        status: "SENT",
        lastError: null,
      },
    });

    await prisma.creatorConversation.update({
      where: { id: local.id },
      data: {
        lastMessagePreview: text.slice(0, 200),
        lastMessageAt: new Date(),
        lastSyncedAt: new Date(),
      },
    });

    if (local.creatorId) {
      const creator = await prisma.creator.findUnique({
        where: { id: local.creatorId },
      });
      if (
        creator &&
        (creator.stage === "LEAD" || creator.stage === "CONTACTED")
      ) {
        await prisma.creator.update({
          where: { id: creator.id },
          data: { stage: "CONTACTED" },
        });
      }
    }

    if (actorUserId) {
      await writeAuditLog({
        actorUserId,
        action: "messages.send",
        entityType: "CreatorImMessage",
        entityId: updated.id,
        meta: {
          conversationId: local.id,
          externalMessageId: sent.messageId,
        },
      });
    }

    return toMessage(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.creatorImMessage.update({
      where: { id: pending.id },
      data: { status: "FAILED", lastError: message },
    });
    logger.error("im send failed", {
      conversationId: local.id,
      error: message,
    });
    if (err instanceof AppError) throw err;
    throw new AppError("BAD_GATEWAY", message, 502);
  }
}

export async function markConversationsRead(
  organizationId: string,
  input: { shopId: string; conversationIds: string[] },
) {
  const { credentials } = await assertOAuthShop(organizationId, input.shopId);
  const locals = await prisma.creatorConversation.findMany({
    where: {
      organizationId,
      shopId: input.shopId,
      id: { in: input.conversationIds },
    },
  });
  if (locals.length === 0) {
    throw new AppError("NOT_FOUND", "No matching conversations", 404);
  }

  await markTikTokConversationsRead({
    credentials,
    conversationIds: locals.map((c) => c.externalConversationId),
  });

  await prisma.creatorConversation.updateMany({
    where: { id: { in: locals.map((c) => c.id) } },
    data: { unreadCount: 0 },
  });

  return { ok: true as const, marked: locals.length };
}

export async function getNewestUnread(
  organizationId: string,
  shopId: string,
) {
  const { credentials } = await assertOAuthShop(organizationId, shopId);
  const items = await listTikTokNewestUnread({ credentials });
  return { items };
}
