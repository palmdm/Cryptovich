import { z } from "zod";

/** A set's name is at most this long, wherever it is typed. */
const CATEGORY_MAX = 40;

export const importSchema = z.object({
  source: z.enum(["SHARKEY", "TELEGRAM"]),
  sourceRef: z.string().trim().min(1).max(300),
  category: z.string().trim().max(CATEGORY_MAX).optional(),
  // A fediverse instance's sets to take; none listed takes them all.
  remoteCategories: z.array(z.string().max(100)).max(200).optional(),
});

export const importPreviewSchema = z.object({ sourceRef: z.string().trim().min(1).max(300) });

/** A set's new name; an existing set of that name takes the stickers in. */
export const renameSetSchema = z.object({ name: z.string().trim().min(1).max(CATEGORY_MAX) });
