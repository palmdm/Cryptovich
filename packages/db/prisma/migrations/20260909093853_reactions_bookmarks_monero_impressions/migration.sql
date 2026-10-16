-- AlterEnum
ALTER TYPE "BlockchainNetwork" ADD VALUE 'MONERO';

-- AlterTable
ALTER TABLE "DigitalProduct" ADD COLUMN     "impressionCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reaction_productId_idx" ON "Reaction"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_productId_userId_emoji_key" ON "Reaction"("productId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "Bookmark_productId_idx" ON "Bookmark"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_userId_productId_key" ON "Bookmark"("userId", "productId");

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
