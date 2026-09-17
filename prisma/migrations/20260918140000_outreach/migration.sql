-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN "contactEmail" TEXT;

-- CreateTable
CREATE TABLE "OutreachTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT,
    "campaignId" TEXT,
    "creatorId" TEXT NOT NULL,
    "toEmail" TEXT,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" "OutreachStatus" NOT NULL DEFAULT 'DRAFT',
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachTemplate_organizationId_name_key" ON "OutreachTemplate"("organizationId", "name");
CREATE INDEX "OutreachTemplate_organizationId_idx" ON "OutreachTemplate"("organizationId");
CREATE INDEX "OutreachMessage_organizationId_idx" ON "OutreachMessage"("organizationId");
CREATE INDEX "OutreachMessage_creatorId_idx" ON "OutreachMessage"("creatorId");
CREATE INDEX "OutreachMessage_campaignId_idx" ON "OutreachMessage"("campaignId");
CREATE INDEX "OutreachMessage_status_idx" ON "OutreachMessage"("status");

ALTER TABLE "OutreachTemplate" ADD CONSTRAINT "OutreachTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OutreachTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
