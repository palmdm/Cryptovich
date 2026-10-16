import { z } from "zod";
import { isDonationAmountInRange, DONATION_MIN_DECIMAL, DONATION_MAX_DECIMAL } from "@platform/shared";

export const donationCheckoutSchema = z.object({
  creatorUsername: z.string().min(1),
  amountDecimal: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    // The regex alone admits "0.00" and arbitrarily large values; the
    // range check is what stops a zero-value payment being created.
    .refine(isDonationAmountInRange, {
      message: `Donations must be between ${DONATION_MIN_DECIMAL} and ${DONATION_MAX_DECIMAL}.`,
    }),
  currency: z.enum(["USD", "EUR"]).default("USD"),
  message: z.string().max(500).optional(),
  isPublic: z.boolean().default(false),
  // A reward bought with the tip, in the same payment.
  rewardId: z.string().uuid().optional(),
});

export type DonationCheckoutInput = z.infer<typeof donationCheckoutSchema>;
