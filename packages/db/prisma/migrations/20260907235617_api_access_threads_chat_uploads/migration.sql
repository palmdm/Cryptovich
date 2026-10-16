-- CreateEnum
CREATE TYPE "ApiAccessStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED');

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "CreatorProfile" ADD COLUMN     "chatUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canUploadFiles" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ApiAccessRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ApiAccessStatus" NOT NULL DEFAULT 'REQUESTED',
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "note" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "apiTokenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiAccessRequest_apiTokenId_key" ON "ApiAccessRequest"("apiTokenId");

-- CreateIndex
CREATE INDEX "ApiAccessRequest_status_createdAt_idx" ON "ApiAccessRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ApiAccessRequest_userId_idx" ON "ApiAccessRequest"("userId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ApiAccessRequest" ADD CONSTRAINT "ApiAccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiAccessRequest" ADD CONSTRAINT "ApiAccessRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiAccessRequest" ADD CONSTRAINT "ApiAccessRequest_apiTokenId_fkey" FOREIGN KEY ("apiTokenId") REFERENCES "ApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
