-- Goals count paying subscribers as well as money, are marked reached when
-- they get there, and can be marked fulfilled by their author.
CREATE TYPE "GoalKind" AS ENUM ('DONATIONS', 'SUBSCRIBERS');

ALTER TABLE "FundraisingGoal"
  ADD COLUMN "kind" "GoalKind" NOT NULL DEFAULT 'DONATIONS',
  ADD COLUMN "targetCount" INTEGER,
  ADD COLUMN "reachedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ALTER COLUMN "targetMinor" DROP NOT NULL,
  ALTER COLUMN "currency" DROP NOT NULL;
