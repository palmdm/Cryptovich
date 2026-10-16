import { z } from "zod";
import { isSafeHttpUrl } from "@platform/shared";

// `z.string().url()` alone accepts `javascript:` and `data:` URLs, which
// become stored XSS the moment one is rendered into an href or src.
// `isSafeHttpUrl` narrows every user-supplied URL to http/https.
const httpUrl = () =>
  z.string().url().refine(isSafeHttpUrl, { message: "Use an http or https URL." });

export const createFeedSourceSchema = z.object({
  platform: z.enum(["MASTODON", "SHARKEY", "RSS"]),
  // For MASTODON/SHARKEY this is the actor document URL; for RSS it is the
  // feed URL itself. One column, because the ingestion worker only ever
  // hands it back to the provider that understands it.
  actorUrl: httpUrl(),
});

export type CreateFeedSourceInput = z.infer<typeof createFeedSourceSchema>;
