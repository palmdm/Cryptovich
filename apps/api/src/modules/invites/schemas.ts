import { z } from "zod";

export const createInviteSchema = z.object({
  note: z.string().max(200).optional(),
  // Null means unlimited uses; the default is a single-use code.
  maxUses: z.number().int().min(1).max(1000).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

/**
 * What an ordinary member may ask for. Tighter than the administrator's
 * form on purpose: a single code can never be unlimited, and it lapses.
 */
export const createOwnInviteSchema = z.object({
  note: z.string().max(200).optional(),
  maxUses: z.number().int().min(1).max(10).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
