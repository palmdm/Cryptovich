-- Search engines and fediverse search are two choices now. Whoever had
-- hidden from search keeps both hidden; from here on they are apart.
ALTER TABLE "CreatorProfile" ADD COLUMN "hideFromFediverseSearch" BOOLEAN NOT NULL DEFAULT false;
UPDATE "CreatorProfile" SET "hideFromFediverseSearch" = "hideFromSearch";
