import { z } from "zod";

/** What kind of problem a report is about; the admin area words each one. */
export const REPORT_CATEGORIES = ["spam", "scam", "illegal", "harassment", "adult", "copyright", "other"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const createReportSchema = z
  .object({
    // POST, BUNDLE and STICKER_PACK are older names for a product, still
    // accepted from an API client that sends them.
    targetType: z.enum(["CREATOR", "PRODUCT", "COMMENT", "POST", "STICKER_PACK", "BUNDLE"]),
    // An author by username; a post or a comment by id.
    targetId: z.string().trim().min(1).max(64),
    category: z.enum(REPORT_CATEGORIES).default("other"),
    reason: z.string().trim().max(1000).default(""),
  })
  .refine((report) => report.category !== "other" || report.reason.length >= 5, {
    message: "Say in a few words what is wrong.",
    path: ["reason"],
  });

export type CreateReportInput = z.infer<typeof createReportSchema>;
