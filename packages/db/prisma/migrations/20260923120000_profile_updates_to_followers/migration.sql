-- A follower delivery can now also be a profile update (Update{Person}),
-- which is how a new avatar, header or name reaches the servers of an
-- author's followers straight away instead of whenever each one happens
-- to re-fetch the actor.
CREATE TYPE "FollowerDeliveryKind" AS ENUM ('POST', 'PROFILE');

ALTER TABLE "FollowerDelivery" ADD COLUMN "kind" "FollowerDeliveryKind" NOT NULL DEFAULT 'POST';
ALTER TABLE "FollowerDelivery" ADD COLUMN "creatorId" TEXT;
ALTER TABLE "FollowerDelivery" ALTER COLUMN "productId" DROP NOT NULL;

ALTER TABLE "FollowerDelivery" ADD CONSTRAINT "FollowerDelivery_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "FollowerDelivery_creatorId_kind_status_idx" ON "FollowerDelivery"("creatorId", "kind", "status");
