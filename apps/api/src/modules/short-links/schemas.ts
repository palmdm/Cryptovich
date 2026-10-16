import { z } from "zod";
import { isSafeHttpUrl } from "@platform/shared";

export const createShortLinkSchema = z.object({
  url: z.string().trim().url().max(2000).refine(isSafeHttpUrl, { message: "Use an http or https URL." }),
  title: z.string().trim().max(120).optional(),
});
