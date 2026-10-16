import { z } from "zod";

export const updateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  autoPublish: z.boolean().optional(),
});

export const addInstanceSchema = z.object({
  domain: z.string().min(3).max(255),
  platform: z.enum(["MASTODON", "SHARKEY", "ACTIVITYPUB"]),
});

export const publishSchema = z.object({
  instanceIds: z.array(z.string().uuid()).optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type AddInstanceInput = z.infer<typeof addInstanceSchema>;
export type PublishInput = z.infer<typeof publishSchema>;
