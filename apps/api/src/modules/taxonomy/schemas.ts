import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  position: z.number().int().min(0).max(999).optional(),
});

/**
 * Tags are free text the author types, so they are normalised here rather
 * than trusted: trimmed, lowercased, and deduplicated. Twenty is a limit
 * on the author, not on the schema — a post with fifty tags is not tagged.
 */
export const setProductTagsSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
});

export const setProductCategoriesSchema = z.object({
  categoryIds: z.array(z.string().uuid()).max(20),
});

export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
