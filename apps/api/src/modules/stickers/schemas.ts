import { z } from "zod";

export const setPriceSchema = z.object({
  visibility: z.enum(["PUBLIC", "SUBSCRIBERS", "TIER", "PURCHASED", "PRIVATE"]),
  currency: z.enum(["USD", "EUR"]).default("USD"),
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export type SetPriceInput = z.infer<typeof setPriceSchema>;
