-- A sale on a subscription tier or a paid post: percent off until an optional date.
ALTER TABLE "SubscriptionTier" ADD COLUMN "discountPercent" INTEGER, ADD COLUMN "discountEndsAt" TIMESTAMP(3);
ALTER TABLE "DigitalProduct" ADD COLUMN "discountPercent" INTEGER, ADD COLUMN "discountEndsAt" TIMESTAMP(3);
