-- When a feed source last walked the account's whole history. Until it
-- has, the next ingestion reads every outbox page rather than stopping at
-- the first page it already knows — the importer used to read only the
-- newest page, so every source connected before this has a history to
-- catch up on.
ALTER TABLE "FeedSource" ADD COLUMN "fullSyncedAt" TIMESTAMP(3);

-- Posts already imported from another feed: drop the English boilerplate
-- the importer wrote into them, and mark their titles with 🗻 the way new
-- imports are marked.
UPDATE "DigitalProduct"
SET "description" = NULL
WHERE "description" IN ('From the author''s RSS feed', 'From the author''s fediverse account');

UPDATE "Post" p
SET "content" = regexp_replace(p."content", E'\\n*\\(originally posted at [^)]*\\)\\s*$', '')
FROM "FeedImportedItem" f
WHERE f."productId" = p."productId";

UPDATE "DigitalProduct" d
SET "title" = '🗻 ' || d."title"
FROM "FeedImportedItem" f
WHERE f."productId" = d."id" AND d."title" NOT LIKE '🗻%';
