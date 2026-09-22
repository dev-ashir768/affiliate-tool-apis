-- CreateTable
CREATE TABLE "DiscoveryCrawlTerm" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "region" "ShopRegion",
    "regionKey" TEXT NOT NULL DEFAULT 'ALL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryCrawlTerm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscoveryCrawlTerm_keyword_regionKey_key" ON "DiscoveryCrawlTerm"("keyword", "regionKey");
CREATE INDEX "DiscoveryCrawlTerm_enabled_sortOrder_idx" ON "DiscoveryCrawlTerm"("enabled", "sortOrder");
CREATE INDEX "DiscoveryCrawlTerm_region_idx" ON "DiscoveryCrawlTerm"("region");
