import { z } from "zod";
import { isSafeHttpUrl } from "@platform/shared";

// `z.string().url()` alone accepts `javascript:` and `data:` URLs, which
// become stored XSS the moment one is rendered into an href or src.
// `isSafeHttpUrl` narrows every user-supplied URL to http/https.
// A sale: percent off (1–90) until an optional moment; null removes it.
const discountPercent = z.number().int().min(1).max(90).nullable().optional();
const discountEndsAt = z.string().datetime({ offset: true }).nullable().optional();

const httpUrl = () =>
  z.string().url().refine(isSafeHttpUrl, { message: "Use an http or https URL." });

export const createPostSchema = z
  .object({
    title: z.string().min(1).max(160),
    description: z.string().max(500).optional(),
    coverUrl: httpUrl().optional(),
    visibility: z.enum(["PUBLIC", "SUBSCRIBERS", "TIER", "PURCHASED", "PRIVATE", "GOAL"]),
    requiredTierId: z.string().uuid().optional(),
    /** GOAL: the author's goal that opens the post once it is reached. */
    requiredGoalId: z.string().uuid().optional(),
    content: z.string().min(1).max(50_000),
    excerpt: z.string().max(500).optional(),
    currency: z.enum(["USD", "EUR"]).default("USD"),
    priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
    discountPercent,
    discountEndsAt,
  })
  .refine((data) => data.visibility !== "TIER" || Boolean(data.requiredTierId), {
    message: "A subscription tier is required for tier-gated visibility.",
    path: ["requiredTierId"],
  })
  .refine((data) => data.visibility !== "GOAL" || Boolean(data.requiredGoalId), {
    message: "Choose the goal that opens this post.",
    path: ["requiredGoalId"],
  });

export type CreatePostInput = z.infer<typeof createPostSchema>;

/**
 * Editing an existing post. Every field is optional so a caller can
 * change one thing without restating the rest, and `slug` is absent on
 * purpose: it is the post's permalink, and rewriting it would break
 * every link already shared to the piece.
 */
export const updatePostSchema = z
  .object({
    title: z.string().min(1).max(160).optional(),
    description: z.string().max(500).nullable().optional(),
    coverUrl: httpUrl().nullable().optional(),
    visibility: z.enum(["PUBLIC", "SUBSCRIBERS", "TIER", "PURCHASED", "PRIVATE", "GOAL"]).optional(),
    requiredTierId: z.string().uuid().nullable().optional(),
    requiredGoalId: z.string().uuid().nullable().optional(),
    content: z.string().min(1).max(50_000).optional(),
    excerpt: z.string().max(500).nullable().optional(),
    currency: z.enum(["USD", "EUR"]).optional(),
    priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    discountPercent,
    discountEndsAt,
  })
  .refine((data) => data.visibility !== "TIER" || data.requiredTierId !== null, {
    message: "A subscription tier is required for tier-gated visibility.",
    path: ["requiredTierId"],
  })
  .refine((data) => data.visibility !== "GOAL" || data.requiredGoalId !== null, {
    message: "Choose the goal that opens this post.",
    path: ["requiredGoalId"],
  });

export type UpdatePostInput = z.infer<typeof updatePostSchema>;
