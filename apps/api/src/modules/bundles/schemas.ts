import { z } from "zod";
import { isSafeHttpUrl } from "@platform/shared";

// `z.string().url()` alone accepts `javascript:` and `data:` URLs, which
// become stored XSS the moment one is rendered into an href or src.
// `isSafeHttpUrl` narrows every user-supplied URL to http/https.
const httpUrl = () =>
  z.string().url().refine(isSafeHttpUrl, { message: "Use an http or https URL." });

export const createBundleSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  coverUrl: httpUrl().optional(),
  currency: z.enum(["USD", "EUR"]).default("USD"),
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export const updateBundleSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(500).optional(),
  coverUrl: httpUrl().optional(),
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

export const addItemSchema = z.object({ itemProductId: z.string().uuid() });

export const reorderSchema = z.object({ itemProductIds: z.array(z.string().uuid()).min(1) });

export type CreateBundleInput = z.infer<typeof createBundleSchema>;
export type UpdateBundleInput = z.infer<typeof updateBundleSchema>;
