-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AutomationStepKind" AS ENUM ('EMAIL', 'AFFILIATE_INVITE');

-- CreateEnum
CREATE TYPE "AutomationStepStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT,
    "shopId" TEXT,
    "name" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "creatorIds" TEXT[],
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "kind" "AutomationStepKind" NOT NULL,
    "status" "AutomationStepStatus" NOT NULL DEFAULT 'PENDING',
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL,
    "result" JSONB,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRun_organizationId_idx" ON "AutomationRun"("organizationId");

-- CreateIndex
CREATE INDEX "AutomationRun_campaignId_idx" ON "AutomationRun"("campaignId");

-- CreateIndex
CREATE INDEX "AutomationRun_shopId_idx" ON "AutomationRun"("shopId");

-- CreateIndex
CREATE INDEX "AutomationRun_status_idx" ON "AutomationRun"("status");

-- CreateIndex
CREATE INDEX "AutomationRun_createdAt_idx" ON "AutomationRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRunStep_runId_stepIndex_key" ON "AutomationRunStep"("runId", "stepIndex");

-- CreateIndex
CREATE INDEX "AutomationRunStep_status_idx" ON "AutomationRunStep"("status");

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRunStep" ADD CONSTRAINT "AutomationRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
