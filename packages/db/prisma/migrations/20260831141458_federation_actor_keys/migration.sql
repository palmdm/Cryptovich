-- AlterTable
ALTER TABLE "CreatorFederationSettings" ADD COLUMN     "actorPrivateKeyPem" TEXT,
ADD COLUMN     "actorPublicKeyPem" TEXT;

-- AlterTable
ALTER TABLE "FederatedPost" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

