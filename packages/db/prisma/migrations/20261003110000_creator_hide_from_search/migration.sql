-- The author's own choice to keep their page and posts out of search
-- engines (noindex) and out of fediverse search and suggestions.
ALTER TABLE "CreatorProfile" ADD COLUMN "hideFromSearch" BOOLEAN NOT NULL DEFAULT false;
