-- Payments are settled by the recipient confirming receipt, so the
-- chain-observation states and the provider columns no longer describe
-- anything the system can produce.

-- Any row still parked in a chain-observation state can only have come
-- from the removed simulator; treat it as never having been paid.
UPDATE "Payment" SET "status" = 'EXPIRED'
 WHERE "status" IN ('DETECTED', 'CONFIRMING', 'UNDERPAID', 'OVERPAID');

DROP TABLE IF EXISTS "BlockchainTransaction";

ALTER TABLE "Payment" DROP COLUMN IF EXISTS "provider";
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "providerRef";

ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'AWAITING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'FAILED', 'REFUNDED');
ALTER TABLE "Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "status" TYPE "PaymentStatus" USING ("status"::text::"PaymentStatus");
ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'CREATED';
DROP TYPE "PaymentStatus_old";
