-- CreateEnum
CREATE TYPE "SampleRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLING', 'FULFILLED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "SampleRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "creatorId" TEXT,
    "affiliateInviteId" TEXT,
    "externalApplicationId" TEXT,
    "externalProductId" TEXT,
    "productTitle" TEXT,
    "creatorUsername" TEXT,
    "creatorOpenId" TEXT,
    "status" "SampleRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "lastError" TEXT,
    "products" JSONB,
    "fulfillmentRaw" JSONB,
    "metricsRaw" JSONB,
    "requestedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SampleRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SampleRequest_organizationId_externalApplicationId_key" ON "SampleRequest"("organizationId", "externalApplicationId");

-- CreateIndex
CREATE INDEX "SampleRequest_organizationId_status_idx" ON "SampleRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SampleRequest_shopId_idx" ON "SampleRequest"("shopId");

-- CreateIndex
CREATE INDEX "SampleRequest_creatorId_idx" ON "SampleRequest"("creatorId");

-- CreateIndex
CREATE INDEX "SampleRequest_affiliateInviteId_idx" ON "SampleRequest"("affiliateInviteId");

-- CreateIndex
CREATE INDEX "SampleRequest_requestedAt_idx" ON "SampleRequest"("requestedAt");

-- AddForeignKey
ALTER TABLE "SampleRequest" ADD CONSTRAINT "SampleRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleRequest" ADD CONSTRAINT "SampleRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleRequest" ADD CONSTRAINT "SampleRequest_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleRequest" ADD CONSTRAINT "SampleRequest_affiliateInviteId_fkey" FOREIGN KEY ("affiliateInviteId") REFERENCES "AffiliateInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
