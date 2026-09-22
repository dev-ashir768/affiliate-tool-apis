-- CreateEnum
CREATE TYPE "ImMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ImMessageStatus" AS ENUM ('RECEIVED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN "creatorImId" TEXT;

-- CreateTable
CREATE TABLE "CreatorConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "creatorId" TEXT,
    "externalConversationId" TEXT NOT NULL,
    "creatorImId" TEXT,
    "creatorUsername" TEXT,
    "avatarUrl" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessagePreview" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorImMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "direction" "ImMessageDirection" NOT NULL,
    "msgType" TEXT NOT NULL DEFAULT 'TEXT',
    "contentText" TEXT,
    "contentRaw" TEXT,
    "senderImId" TEXT,
    "status" "ImMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorImMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Creator_creatorImId_idx" ON "Creator"("creatorImId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorConversation_shopId_externalConversationId_key" ON "CreatorConversation"("shopId", "externalConversationId");

-- CreateIndex
CREATE INDEX "CreatorConversation_organizationId_idx" ON "CreatorConversation"("organizationId");

-- CreateIndex
CREATE INDEX "CreatorConversation_creatorId_idx" ON "CreatorConversation"("creatorId");

-- CreateIndex
CREATE INDEX "CreatorConversation_creatorImId_idx" ON "CreatorConversation"("creatorImId");

-- CreateIndex
CREATE INDEX "CreatorConversation_updatedAt_idx" ON "CreatorConversation"("updatedAt");

-- CreateIndex
CREATE INDEX "CreatorImMessage_conversationId_idx" ON "CreatorImMessage"("conversationId");

-- CreateIndex
CREATE INDEX "CreatorImMessage_externalMessageId_idx" ON "CreatorImMessage"("externalMessageId");

-- CreateIndex
CREATE INDEX "CreatorImMessage_sentAt_idx" ON "CreatorImMessage"("sentAt");

-- AddForeignKey
ALTER TABLE "CreatorConversation" ADD CONSTRAINT "CreatorConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorConversation" ADD CONSTRAINT "CreatorConversation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorConversation" ADD CONSTRAINT "CreatorConversation_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorImMessage" ADD CONSTRAINT "CreatorImMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CreatorConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
