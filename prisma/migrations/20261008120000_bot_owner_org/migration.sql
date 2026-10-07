-- AlterTable
ALTER TABLE "BotIdentity" ADD COLUMN "ownerOrganizationId" TEXT;

-- CreateIndex
CREATE INDEX "BotIdentity_ownerOrganizationId_status_idx" ON "BotIdentity"("ownerOrganizationId", "status");
