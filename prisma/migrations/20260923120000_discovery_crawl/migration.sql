-- AlterTable: CreatorDiscoveryProfile crawl indexes + gmvCents
ALTER TABLE "CreatorDiscoveryProfile" ADD COLUMN IF NOT EXISTS "gmvCents" INTEGER;
ALTER TABLE "CreatorDiscoveryProfile" ADD COLUMN IF NOT EXISTS "lastCrawledAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CreatorDiscoveryProfile_source_idx" ON "CreatorDiscoveryProfile"("source");
CREATE INDEX IF NOT EXISTS "CreatorDiscoveryProfile_enabled_region_followerCount_idx" ON "CreatorDiscoveryProfile"("enabled", "region", "followerCount");
CREATE INDEX IF NOT EXISTS "CreatorDiscoveryProfile_enabled_unitsSold_idx" ON "CreatorDiscoveryProfile"("enabled", "unitsSold");
CREATE INDEX IF NOT EXISTS "CreatorDiscoveryProfile_enabled_gmvCents_idx" ON "CreatorDiscoveryProfile"("enabled", "gmvCents");

-- CreateTable
CREATE TABLE IF NOT EXISTS "DiscoveryCrawlCell" (
    "id" TEXT NOT NULL,
    "cellKey" TEXT NOT NULL,
    "region" "ShopRegion" NOT NULL,
    "keyword" TEXT NOT NULL,
    "minFollowers" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastImported" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryCrawlCell_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveryCrawlCell_cellKey_key" ON "DiscoveryCrawlCell"("cellKey");
CREATE INDEX IF NOT EXISTS "DiscoveryCrawlCell_region_idx" ON "DiscoveryCrawlCell"("region");
CREATE INDEX IF NOT EXISTS "DiscoveryCrawlCell_lastRunAt_idx" ON "DiscoveryCrawlCell"("lastRunAt");
CREATE INDEX IF NOT EXISTS "DiscoveryCrawlCell_lastStatus_idx" ON "DiscoveryCrawlCell"("lastStatus");
