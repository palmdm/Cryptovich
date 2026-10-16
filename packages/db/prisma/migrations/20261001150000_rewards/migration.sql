-- Rewards: server stickers offered for supporters to buy for an author.
-- CreateEnum
CREATE TYPE "RewardGiftStatus" AS ENUM ('PENDING', 'GRANTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'REWARD';

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "emojiId" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardGift" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "paymentId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "message" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "RewardGiftStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedAt" TIMESTAMP(3),

    CONSTRAINT "RewardGift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Reward_emojiId_key" ON "Reward"("emojiId");

-- CreateIndex
CREATE INDEX "Reward_active_position_idx" ON "Reward"("active", "position");

-- CreateIndex
CREATE INDEX "RewardGift_creatorId_status_idx" ON "RewardGift"("creatorId", "status");

-- CreateIndex
CREATE INDEX "RewardGift_paymentId_idx" ON "RewardGift"("paymentId");

-- CreateIndex
CREATE INDEX "RewardGift_senderUserId_creatorId_createdAt_idx" ON "RewardGift"("senderUserId", "creatorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_emojiId_fkey" FOREIGN KEY ("emojiId") REFERENCES "ServerEmoji"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGift" ADD CONSTRAINT "RewardGift_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGift" ADD CONSTRAINT "RewardGift_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGift" ADD CONSTRAINT "RewardGift_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGift" ADD CONSTRAINT "RewardGift_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

