import { XMLParser } from "fast-xml-parser";
import type { FeedIngestionProvider, FeedPost } from "./provider.js";
import { FeedIngestionProviderError } from "./provider.js";
import { fetchFeedResource } from "./fetch-feed.js";
import { assertPublicHttpUrl } from "./ssrf-guard.js";
import { stripHtml } from "./html-text.js";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 30;

/**
 * fast-xml-parser does not resolve DTDs or external entities, so an
 * `<!ENTITY … SYSTEM "file:///etc/passwd">` in a hostile feed is inert —
 * the XXE class of attack this parser choice is guarding against.
 * `processEntities` is left off so numeric/character entities in text are
 * handled by stripHtml instead, in one place.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  trimValues: true,
});

/** A feed element is a string, a number, or `{ "#text": … }` with attributes. */
function text(node: unknown): string | undefined {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node && typeof node === "object") {
    const value = (node as Record<string, unknown>)["#text"];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return undefined;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Atom links are `<link href="…" rel="alternate"/>`, possibly repeated. */
function atomLink(entry: Record<string, unknown>): string | undefined {
  for (const link of asArray(entry.link as unknown)) {
    if (typeof link === "string") return link;
    if (link && typeof link === "object") {
      const rec = link as Record<string, unknown>;
      const rel = rec["@_rel"];
      if (rel === undefined || rel === "alternate") {
        const href = rec["@_href"];
        if (typeof href === "string") return href;
      }
    }
  }
  return undefined;
}

function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Pulls a creator's posts from an ordinary RSS 2.0 or Atom feed, so an
 * author whose other outlet is a blog, newsletter or podcast — not a
 * fediverse account — can still run it as their second feed here.
 *
 * Both formats are handled by the same code path because the shapes only
 * differ in element names: channel/item/pubDate against feed/entry/updated.
 */
export class RssFeedProvider implements FeedIngestionProvider {
  /** Injectable for the same reason as the ActivityPub provider: tests mock
   * `fetch` entirely and must not pay for a real DNS lookup. */
  constructor(private readonly guard: (url: string) => Promise<void> = assertPublicHttpUrl) {}

  private async getXml(url: string, hop = 0): Promise<string> {
    if (hop > MAX_REDIRECTS) throw new FeedIngestionProviderError("Too many redirects.");
    // Re-checked on every hop: a redirect can point somewhere the
    // author's original URL never mentioned, including an internal address.
    await this.guard(url);

    const res = await fetchFeedResource(
      url,
      "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
      undefined,
      this.guard === assertPublicHttpUrl,
    );

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new FeedIngestionProviderError("Redirect with no Location header.");
      return this.getXml(new URL(location, url).toString(), hop + 1);
    }
    if (!res.ok) throw new FeedIngestionProviderError(`${url} returned ${res.status}`);

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new FeedIngestionProviderError("Feed is too large.");

    // Read incrementally and abort the moment the cap is passed.
    // `res.text()` would buffer the whole response first, so a feed that
    // omits content-length — or lies about it — could exhaust memory
    // before any size check ran.
    if (!res.body) return "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) throw new FeedIngestionProviderError("Feed is too large.");
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  }

  async fetchRecentPosts(feedUrl: string): Promise<FeedPost[]> {
    const xml = await this.getXml(feedUrl);

    let doc: Record<string, unknown>;
    try {
      doc = parser.parse(xml) as Record<string, unknown>;
    } catch {
      throw new FeedIngestionProviderError("That URL did not return valid XML.");
    }

    const rssChannel = (doc.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
    const atomFeed = doc.feed as Record<string, unknown> | undefined;

    const entries = rssChannel
      ? asArray(rssChannel.item as Record<string, unknown> | Record<string, unknown>[] | undefined)
      : asArray(atomFeed?.entry as Record<string, unknown> | Record<string, unknown>[] | undefined);

    if (!rssChannel && !atomFeed) {
      throw new FeedIngestionProviderError("That URL is not an RSS or Atom feed.");
    }

    const posts: FeedPost[] = [];
    for (const entry of entries.slice(0, MAX_ITEMS)) {
      const url = rssChannel ? text(entry.link) : atomLink(entry);
      // guid/id is the stable identity; the link is the fallback, since a
      // feed without either cannot be deduplicated on re-poll.
      const remoteId = text(entry.guid) ?? text(entry.id) ?? url;
      if (!remoteId) continue;

      const title = text(entry.title)?.trim();
      const rawBody =
        text(entry["content:encoded"]) ??
        text(entry.content) ??
        text(entry.description) ??
        text(entry.summary) ??
        "";
      const bodyText = stripHtml(rawBody);

      // A title-only entry is still a post worth mirroring; an entry with
      // neither title nor body is not.
      if (!title && !bodyText) continue;
      const text_ = title && bodyText ? `${title}\n\n${bodyText}` : title ?? bodyText;

      posts.push({
        remoteId,
        text: text_,
        url: url ?? feedUrl,
        publishedAt: parseDate(text(entry.pubDate) ?? text(entry.published) ?? text(entry.updated)),
      });
    }

    return posts;
  }
}
