-- A report can be about a comment, and says which kind of problem it is
-- (spam, scam, ...) apart from the reporter's own words.
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'COMMENT';
ALTER TABLE "Report" ADD COLUMN "category" TEXT;
CREATE INDEX "Report_reporterId_targetType_targetId_idx" ON "Report"("reporterId", "targetType", "targetId");
