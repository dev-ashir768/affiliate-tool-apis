-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'CANCELED');
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "CreatorDiscoveryProfile" (
    "id" TEXT NOT NULL,
    "platform" "CreatorPlatform" NOT NULL DEFAULT 'TIKTOK',
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "region" "ShopRegion",
    "followerCount" INTEGER,
    "categories" TEXT[],
    "bio" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorDiscoveryProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shopId" TEXT,
    "creatorId" TEXT,
    "externalOrderId" TEXT NOT NULL,
    "gmvCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "creatorId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorDiscoveryProfile_platform_handle_key" ON "CreatorDiscoveryProfile"("platform", "handle");
CREATE INDEX "CreatorDiscoveryProfile_region_idx" ON "CreatorDiscoveryProfile"("region");
CREATE INDEX "CreatorDiscoveryProfile_followerCount_idx" ON "CreatorDiscoveryProfile"("followerCount");
CREATE INDEX "CreatorDiscoveryProfile_enabled_idx" ON "CreatorDiscoveryProfile"("enabled");

CREATE UNIQUE INDEX "ShopOrder_organizationId_externalOrderId_key" ON "ShopOrder"("organizationId", "externalOrderId");
CREATE INDEX "ShopOrder_organizationId_idx" ON "ShopOrder"("organizationId");
CREATE INDEX "ShopOrder_creatorId_idx" ON "ShopOrder"("creatorId");
CREATE INDEX "ShopOrder_orderedAt_idx" ON "ShopOrder"("orderedAt");
CREATE INDEX "ShopOrder_status_idx" ON "ShopOrder"("status");

CREATE INDEX "Commission_organizationId_idx" ON "Commission"("organizationId");
CREATE INDEX "Commission_orderId_idx" ON "Commission"("orderId");
CREATE INDEX "Commission_creatorId_idx" ON "Commission"("creatorId");
CREATE INDEX "Commission_status_idx" ON "Commission"("status");

ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
