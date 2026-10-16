import { z } from "zod";

export const updateTelegramSchema = z.object({
  receivePosts: z.boolean().optional(),
  publishEnabled: z.boolean().optional(),
  publishVisibility: z.enum(["PUBLIC", "SUBSCRIBERS"]).optional(),
  publishAsDraft: z.boolean().optional(),
});

/** What the worker hands over when an author writes a post to the bot. */
export const telegramPublishSchema = z.object({
  chatId: z.string().regex(/^-?\d{1,20}$/),
  title: z.string().trim().min(1).max(160),
  content: z.string().min(1).max(50_000),
  files: z
    .array(
      z.object({
        storageKey: z.string().regex(/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/),
        mimeType: z.string().max(100),
        filename: z.string().trim().min(1).max(255),
      }),
    )
    .max(10)
    .default([]),
});
