import { z } from "zod";
import { isSafeHttpUrl } from "@platform/shared";

export const createFolderSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

export const updateFolderSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const addProductItemSchema = z.object({
  kind: z.literal("PRODUCT"),
  productId: z.string().uuid(),
});

export const addLinkItemSchema = z.object({
  kind: z.literal("LINK"),
  // Narrowed to http(s) for the same reason every other stored URL is:
  // it ends up in an href, and `javascript:`/`data:` there is stored XSS.
  url: z.string().url().refine(isSafeHttpUrl, { message: "Use an http or https URL." }),
  label: z.string().trim().min(1).max(120),
});

export const addItemSchema = z.discriminatedUnion("kind", [addProductItemSchema, addLinkItemSchema]);

export const reorderItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type AddItemInput = z.infer<typeof addItemSchema>;
