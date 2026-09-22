-- AlterTable
ALTER TABLE "Creator" ADD COLUMN "productCardGmvAmount" TEXT,
ADD COLUMN "avgCommissionRange" TEXT,
ADD COLUMN "unitsSold" INTEGER,
ADD COLUMN "gpmAmount" TEXT,
ADD COLUMN "gpmCurrency" TEXT,
ADD COLUMN "gpmRange" TEXT,
ADD COLUMN "metricsRaw" JSONB;

-- AlterTable
ALTER TABLE "CreatorDiscoveryProfile" ADD COLUMN "productCardGmvAmount" TEXT,
ADD COLUMN "avgCommissionRange" TEXT,
ADD COLUMN "unitsSold" INTEGER,
ADD COLUMN "gpmAmount" TEXT,
ADD COLUMN "gpmCurrency" TEXT,
ADD COLUMN "gpmRange" TEXT,
ADD COLUMN "contactEmail" TEXT,
ADD COLUMN "metricsRaw" JSONB;
