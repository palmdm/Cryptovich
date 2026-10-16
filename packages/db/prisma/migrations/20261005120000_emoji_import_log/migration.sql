-- What each sticker of an import became, and why one was skipped.
CREATE TYPE "EmojiImportOutcome" AS ENUM ('ADDED', 'SKIPPED');

CREATE TABLE "EmojiImportLogEntry" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortcode" TEXT,
    "set" TEXT,
    "outcome" "EmojiImportOutcome" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmojiImportLogEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmojiImportLogEntry_jobId_outcome_idx" ON "EmojiImportLogEntry"("jobId", "outcome");

ALTER TABLE "EmojiImportLogEntry" ADD CONSTRAINT "EmojiImportLogEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "EmojiImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
