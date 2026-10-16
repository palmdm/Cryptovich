/**
 * The per-route ceiling for image uploads, tighter than the API-wide 300 a
 * minute. Each upload is re-encoded by sharp before it is stored — seconds
 * of CPU for a large animated image — so the global limit alone would let
 * one account keep the server busy re-encoding. Twenty a minute is far
 * above what a person pasting screenshots into a post does.
 */
export const uploadRateLimit = { max: 20, timeWindow: "1 minute" as const };
