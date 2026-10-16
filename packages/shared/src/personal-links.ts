import { isSafeHttpUrl } from "./safe-url.js";

/**
 * `@[text](url)`: a link the author wants to know about. Each signed-in
 * reader who may read the post gets it as a short link of their own
 * (`/s/<code>`), so the author's "Links" page shows who followed it. Where
 * there is no reader to make one for — another server, the author's own
 * preview — it is an ordinary link.
 */
export const PERSONAL_LINK = /@\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** Every address a text asks to personalise, once each, http(s) only. */
export function personalLinkTargets(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(PERSONAL_LINK)) {
    const url = match[2]!;
    if (isSafeHttpUrl(url)) seen.add(url);
  }
  return [...seen];
}

/**
 * The text with each `@[text](url)` turned into `[text](short)` from `shortFor`
 * — or, for an address it has none for, into the plain `[text](url)`.
 */
export function resolvePersonalLinks(text: string, shortFor: (url: string) => string | undefined = () => undefined): string {
  return text.replace(PERSONAL_LINK, (_whole, label: string, url: string) => `[${label}](${shortFor(url) ?? url})`);
}
