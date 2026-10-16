-- A follower delivery can now be an edit of a post they already have
-- (Update{Note}), not only the post itself (Create{Note}). A server that
-- already holds a post ignores a second Create, so an edit — or the title
-- that Notes now lead with — only reaches it as an Update.
ALTER TYPE "FollowerDeliveryKind" ADD VALUE 'UPDATE';

-- One row per post, inbox and kind: a post's Create and its latest Update
-- are separate deliveries to the same inbox.
DROP INDEX "FollowerDelivery_productId_inbox_key";
CREATE UNIQUE INDEX "FollowerDelivery_productId_inbox_kind_key" ON "FollowerDelivery"("productId", "inbox", "kind");
