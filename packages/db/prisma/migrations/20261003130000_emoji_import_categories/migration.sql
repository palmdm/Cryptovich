-- Which of a fediverse instance's emoji sets an import takes; empty takes
-- them all. Before this an import always took the whole instance.
ALTER TABLE "EmojiImportJob" ADD COLUMN "remoteCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
