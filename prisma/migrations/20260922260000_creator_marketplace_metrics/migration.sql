-- AlterTable
ALTER TABLE "Creator" ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "gmvAmount" TEXT,
ADD COLUMN "gmvCurrency" TEXT,
ADD COLUMN "gmvRange" TEXT,
ADD COLUMN "videoGmvAmount" TEXT,
ADD COLUMN "liveGmvAmount" TEXT,
ADD COLUMN "metricsSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CreatorDiscoveryProfile" ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "gmvAmount" TEXT,
ADD COLUMN "gmvCurrency" TEXT,
ADD COLUMN "gmvRange" TEXT,
ADD COLUMN "videoGmvAmount" TEXT,
ADD COLUMN "liveGmvAmount" TEXT,
ADD COLUMN "metricsSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Creator_followerCount_idx" ON "Creator"("followerCount");

-- CreateIndex
CREATE INDEX "Creator_metricsSyncedAt_idx" ON "Creator"("metricsSyncedAt");

-- CreateIndex
CREATE INDEX "CreatorDiscoveryProfile_metricsSyncedAt_idx" ON "CreatorDiscoveryProfile"("metricsSyncedAt");
