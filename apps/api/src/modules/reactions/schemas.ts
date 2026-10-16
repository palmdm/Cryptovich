import { z } from "zod";
import { isReactionEmoji } from "@platform/shared";

export const toggleReactionSchema = z.object({
  emoji: z.string().refine(isReactionEmoji, "Not a supported reaction."),
});

export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>;
