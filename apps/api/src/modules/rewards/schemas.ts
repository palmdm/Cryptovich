import { z } from "zod";

const currency = z.enum(["USD", "EUR"]);

export const sendRewardSchema = z.object({
  creatorUsername: z.string().min(1).max(64),
  rewardId: z.string().uuid(),
  message: z.string().trim().max(100).optional(),
  // The author is not told who sent it.
  anonymous: z.boolean().default(false),
});

export const adminRewardSchema = z.object({
  // "0" makes it free.
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a price like 1.50, or 0 for free."),
  currency: currency.default("USD"),
  active: z.boolean().default(true),
  position: z.number().int().min(0).max(10_000).optional(),
});

export type SendRewardInput = z.infer<typeof sendRewardSchema>;
export type AdminRewardInput = z.infer<typeof adminRewardSchema>;
