import { z } from "zod";

const title = z.string().trim().min(1).max(120);
const description = z.string().trim().max(500).optional();
// Decimal string, converted to integer minor units by Money — the API
// never accepts a float amount (spec: money is minor units end to end).
const targetDecimal = z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 250 or 250.00.");
// Constrained to what Money knows the minor-unit exponent for — an
// unsupported code would otherwise produce a wrong amount.
const currency = z.enum(["USD", "EUR", "BTC", "ETH", "USDT", "USDC"]);
const targetCount = z.number().int("Enter a whole number of subscribers.").min(1).max(10_000_000);

/**
 * A goal either counts money arriving in one-off payments (DONATIONS) or
 * paying subscribers (SUBSCRIBERS). A request without `kind` is a money
 * goal, as every goal was before there were two kinds.
 */
export const createGoalSchema = z.preprocess(
  (value) => (value && typeof value === "object" && !("kind" in value) ? { ...value, kind: "DONATIONS" } : value),
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("DONATIONS"), title, description, targetDecimal, currency: currency.default("USD") }),
    z.object({ kind: z.literal("SUBSCRIBERS"), title, description, targetCount }),
  ]),
);

export const updateGoalSchema = z.object({
  title: title.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  targetDecimal: targetDecimal.optional(),
  targetCount: targetCount.optional(),
  active: z.boolean().optional(),
  // The author's "done": the promise behind the goal kept. False reopens it.
  completed: z.boolean().optional(),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
