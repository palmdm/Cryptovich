import { z } from "zod";

export const suspendUserSchema = z.object({ reason: z.string().min(3).max(500) });
export const resolveReportSchema = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
  note: z.string().max(1000).optional(),
});
export const setInstanceStatusSchema = z.object({ status: z.enum(["APPROVED", "BLOCKED", "PENDING"]) });

export type SuspendUserInput = z.infer<typeof suspendUserSchema>;
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
export type SetInstanceStatusInput = z.infer<typeof setInstanceStatusSchema>;
