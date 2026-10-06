-- AlterTable
ALTER TABLE "BotIdentity" ADD COLUMN "sessionVaultCiphertext" TEXT,
ADD COLUMN "sessionCapturedAt" TIMESTAMP(3);
