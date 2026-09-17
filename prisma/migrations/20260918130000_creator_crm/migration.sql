-- AlterTable
-- CreateEnum
CREATE TYPE "CreatorPlatform" AS ENUM ('TIKTOK');
CREATE TYPE "CreatorStage" AS ENUM ('LEAD', 'CONTACTED', 'INVITED', 'ACTIVE', 'REJECTED');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'DONE');

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platform" "CreatorPlatform" NOT NULL DEFAULT 'TIKTOK',
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "region" "ShopRegion",
    "followerCount" INTEGER,
    "notes" TEXT,
    "stage" "CreatorStage" NOT NULL DEFAULT 'LEAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorListMember" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorListMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "brief" TEXT,
    "offerNote" TEXT,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Creator_organizationId_idx" ON "Creator"("organizationId");
CREATE INDEX "Creator_stage_idx" ON "Creator"("stage");
CREATE UNIQUE INDEX "Creator_organizationId_platform_handle_key" ON "Creator"("organizationId", "platform", "handle");
CREATE INDEX "CreatorList_organizationId_idx" ON "CreatorList"("organizationId");
CREATE UNIQUE INDEX "CreatorList_organizationId_name_key" ON "CreatorList"("organizationId", "name");
CREATE INDEX "CreatorListMember_creatorId_idx" ON "CreatorListMember"("creatorId");
CREATE UNIQUE INDEX "CreatorListMember_listId_creatorId_key" ON "CreatorListMember"("listId", "creatorId");
CREATE INDEX "Campaign_organizationId_idx" ON "Campaign"("organizationId");
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorList" ADD CONSTRAINT "CreatorList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorListMember" ADD CONSTRAINT "CreatorListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CreatorList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorListMember" ADD CONSTRAINT "CreatorListMember_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
