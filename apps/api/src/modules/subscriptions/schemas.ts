import { z } from "zod";

// A sale: percent off (1–90) until an optional moment; null removes it.
const discountPercent = z.number().int().min(1).max(90).nullable().optional();
const discountEndsAt = z.string().datetime({ offset: true }).nullable().optional();

export const createTierSchema = z.object({
  name: z.string().min(1).max(80),
  // Room for a list of what a subscriber gets, as Boosty's tiers carry.
  description: z.string().max(2000).optional(),
  period: z.enum(["MONTH", "YEAR"]),
  currency: z.enum(["USD", "EUR"]).default("USD"),
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export const updateTierSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  // In the tier's own currency. New subscriptions and renewals pay it; a
  // period already paid for is not touched.
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  discountPercent,
  discountEndsAt,
});

export const subscribeSchema = z.object({
  tierId: z.string().uuid(),
  discountCode: z.string().min(1).max(40).optional(),
  // A reward bought with the subscription, in the same payment.
  rewardId: z.string().uuid().optional(),
});

export const createDiscountCodeSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Use only letters, numbers, hyphens and underscores."),
  type: z.enum(["PERCENT_OFF", "AMOUNT_OFF"]),
  value: z.number().int().positive(),
  maxRedemptions: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

export type CreateTierInput = z.infer<typeof createTierSchema>;
export type UpdateTierInput = z.infer<typeof updateTierSchema>;
export type CreateDiscountCodeInput = z.infer<typeof createDiscountCodeSchema>;
