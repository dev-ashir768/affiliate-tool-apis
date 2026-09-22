-- CreateEnum
CREATE TYPE "AffiliateInviteStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AffiliateInviteRecipientStatus" AS ENUM ('PENDING', 'INVITED', 'CONFLICT', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN "creatorOpenId" TEXT;

-- AlterTable
ALTER TABLE "CreatorDiscoveryProfile" ADD COLUMN "creatorOpenId" TEXT;

-- CreateTable
CREATE TABLE "AffiliateInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "message" TEXT,
    "endAt" TIMESTAMP(3) NOT NULL,
    "sellerContactEmail" TEXT,
    "hasFreeSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleApprovalExempt" BOOLEAN NOT NULL DEFAULT false,
    "products" JSONB NOT NULL,
    "externalCollaborationId" TEXT,
    "status" "AffiliateInviteStatus" NOT NULL DEFAULT 'DRAFT',
    "lastError" TEXT,
    "conflicts" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateInviteRecipient" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "creatorOpenId" TEXT NOT NULL,
    "status" "AffiliateInviteRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateInviteRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Creator_creatorOpenId_idx" ON "Creator"("creatorOpenId");

-- CreateIndex
CREATE INDEX "CreatorDiscoveryProfile_creatorOpenId_idx" ON "CreatorDiscoveryProfile"("creatorOpenId");

-- CreateIndex
CREATE INDEX "AffiliateInvite_organizationId_idx" ON "AffiliateInvite"("organizationId");

-- CreateIndex
CREATE INDEX "AffiliateInvite_shopId_idx" ON "AffiliateInvite"("shopId");

-- CreateIndex
CREATE INDEX "AffiliateInvite_campaignId_idx" ON "AffiliateInvite"("campaignId");

-- CreateIndex
CREATE INDEX "AffiliateInvite_status_idx" ON "AffiliateInvite"("status");

-- CreateIndex
CREATE INDEX "AffiliateInvite_createdAt_idx" ON "AffiliateInvite"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateInviteRecipient_inviteId_creatorId_key" ON "AffiliateInviteRecipient"("inviteId", "creatorId");

-- CreateIndex
CREATE INDEX "AffiliateInviteRecipient_creatorId_idx" ON "AffiliateInviteRecipient"("creatorId");

-- CreateIndex
CREATE INDEX "AffiliateInviteRecipient_status_idx" ON "AffiliateInviteRecipient"("status");

-- AddForeignKey
ALTER TABLE "AffiliateInvite" ADD CONSTRAINT "AffiliateInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateInvite" ADD CONSTRAINT "AffiliateInvite_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateInvite" ADD CONSTRAINT "AffiliateInvite_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateInviteRecipient" ADD CONSTRAINT "AffiliateInviteRecipient_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "AffiliateInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateInviteRecipient" ADD CONSTRAINT "AffiliateInviteRecipient_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
