import { z } from "zod";

export const createTokenSchema = z.object({
  name: z.string().min(1).max(80),
});

export type CreateTokenInput = z.infer<typeof createTokenSchema>;
