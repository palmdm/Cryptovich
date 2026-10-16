import { safeHttpUrl } from "@platform/shared";
import { API_URL } from "./api";

/**
 * Resolves a stored profile image — an avatar or a page cover — to
 * something safe to put in a `src`.
 *
 * The stored value is either one of our own paths (`/avatars/...`,
 * `/covers/...`), which needs the API origin prefixed, or an absolute URL
 * the author set directly via the profile PATCH. The two are never
 * ambiguous, since a relative path always starts with `/`.
 *
 * The absolute case is author-supplied and ends up in an `img src`, so it
 * is narrowed to http(s) — a `javascript:` or `data:` URL renders nothing
 * rather than executing.
 */
export function uploadedImageSrc(url: string): string | null {
  if (url.startsWith("/") && !url.startsWith("//")) return `${API_URL}${url}`;
  return safeHttpUrl(url);
}
