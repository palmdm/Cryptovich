-- A post closed to everyone but its author until one of their goals is reached.
ALTER TYPE "ProductVisibility" ADD VALUE 'GOAL';

ALTER TABLE "DigitalProduct" ADD COLUMN "requiredGoalId" TEXT;

ALTER TABLE "DigitalProduct" ADD CONSTRAINT "DigitalProduct_requiredGoalId_fkey" FOREIGN KEY ("requiredGoalId") REFERENCES "FundraisingGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DigitalProduct_requiredGoalId_idx" ON "DigitalProduct"("requiredGoalId");
