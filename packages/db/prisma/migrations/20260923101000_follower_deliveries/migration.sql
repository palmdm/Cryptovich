-- A post on its way to a follower's inbox. Until this existed, a post
-- reached only instances on an administrator's allowlist, so somebody who
-- followed an author from Mastodon saw the follow go through and then
-- never received a single post.
CREATE TYPE "FollowerDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

CREATE TABLE "FollowerDelivery" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "inbox" TEXT NOT NULL,
    "status" "FollowerDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowerDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FollowerDelivery_productId_inbox_key" ON "FollowerDelivery"("productId", "inbox");
CREATE INDEX "FollowerDelivery_status_nextAttemptAt_idx" ON "FollowerDelivery"("status", "nextAttemptAt");

ALTER TABLE "FollowerDelivery" ADD CONSTRAINT "FollowerDelivery_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
