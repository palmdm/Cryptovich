import { z } from "zod";
import { SHORTCODE_PATTERN, SHORTCODE_MAX_LENGTH, isSafeHttpUrl } from "@platform/shared";


export const createEmojiSchema = z.object({
  shortcode: z
    .string()
    .trim()
    .min(1)
    .max(SHORTCODE_MAX_LENGTH)
    .regex(SHORTCODE_PATTERN, "Use lowercase letters, numbers, underscores and hyphens."),
  url: z.string().url().max(500).refine(isSafeHttpUrl, { message: "Use an http or https URL." }),
});

export type CreateEmojiInput = z.infer<typeof createEmojiSchema>;
