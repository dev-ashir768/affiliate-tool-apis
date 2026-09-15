-- Make Shop.botIdentityId optional so disconnect can release the bot FK
ALTER TABLE "Shop" ALTER COLUMN "botIdentityId" DROP NOT NULL;
