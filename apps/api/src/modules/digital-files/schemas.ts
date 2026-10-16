import { z } from "zod";

export const createFileProductSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  visibility: z.enum(["PUBLIC", "SUBSCRIBERS", "TIER", "PURCHASED", "PRIVATE"]),
  requiredTierId: z.string().uuid().optional(),
  currency: z.enum(["USD", "EUR"]).default("USD"),
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
});

export type CreateFileProductInput = z.infer<typeof createFileProductSchema>;
