-- CreateEnum
CREATE TYPE "BillingLifecycleType" AS ENUM ('REGISTERED', 'SUBSCRIBED', 'RENEWED', 'UPGRADED', 'DOWNGRADED', 'CANCELED');

-- CreateTable
CREATE TABLE "BillingLifecycleEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "BillingLifecycleType" NOT NULL,
    "fromPlanCode" TEXT,
    "toPlanCode" TEXT,
    "actorUserId" TEXT,
    "stripeEventId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingLifecycleEvent_organizationId_createdAt_idx" ON "BillingLifecycleEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingLifecycleEvent_type_createdAt_idx" ON "BillingLifecycleEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "BillingLifecycleEvent_createdAt_idx" ON "BillingLifecycleEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "BillingLifecycleEvent" ADD CONSTRAINT "BillingLifecycleEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
