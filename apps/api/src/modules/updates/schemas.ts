import { z } from "zod";

export const applyUpdateSchema = z.object({ version: z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,6}$/) });
