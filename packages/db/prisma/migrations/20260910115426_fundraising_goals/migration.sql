-- CreateTable
CREATE TABLE "FundraisingGoal" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundraisingGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundraisingGoal_creatorId_active_idx" ON "FundraisingGoal"("creatorId", "active");

-- AddForeignKey
ALTER TABLE "FundraisingGoal" ADD CONSTRAINT "FundraisingGoal_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
