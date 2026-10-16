-- Server-wide stickers and custom emoji, managed by the administrator:
-- usable as :shortcode: in any post and as a reaction anywhere. The file is
-- stored here (not hot-linked), so readers never load it from a third
-- server and it does not vanish when the source does.
CREATE TABLE "ServerEmoji" (
    "id" TEXT NOT NULL,
    "shortcode" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "sizeBytes" INTEGER NOT NULL,
    "sourceUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerEmoji_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServerEmoji_shortcode_key" ON "ServerEmoji"("shortcode");
CREATE INDEX "ServerEmoji_category_idx" ON "ServerEmoji"("category");

CREATE TYPE "EmojiImportSource" AS ENUM ('SHARKEY', 'TELEGRAM');
CREATE TYPE "EmojiImportStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- An import the administrator asked for, carried out by the worker.
CREATE TABLE "EmojiImportJob" (
    "id" TEXT NOT NULL,
    "source" "EmojiImportSource" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "category" TEXT,
    "status" "EmojiImportStatus" NOT NULL DEFAULT 'PENDING',
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmojiImportJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmojiImportJob_status_createdAt_idx" ON "EmojiImportJob"("status", "createdAt");
