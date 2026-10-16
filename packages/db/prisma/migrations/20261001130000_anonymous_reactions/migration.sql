-- A reaction no longer needs an account: a signed-out reader is known by
-- the hash of a random cookie instead (readerKey).
ALTER TABLE "Reaction" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Reaction" ADD COLUMN "readerKey" TEXT;
CREATE UNIQUE INDEX "Reaction_productId_readerKey_emoji_key" ON "Reaction"("productId", "readerKey", "emoji");
DROP INDEX IF EXISTS "Reaction_productId_idx";
CREATE INDEX "Reaction_productId_createdAt_idx" ON "Reaction"("productId", "createdAt");
