import type { FeedIngestionProvider, FeedPost, FeedWalkOptions } from "./provider.js";
import { FeedIngestionProviderError } from "./provider.js";
import { assertPublicHttpUrl } from "./ssrf-guard.js";
import { stripHtml } from "./html-text.js";
import { fetchFeedResource } from "./fetch-feed.js";
import type { RequestSigner } from "../federation/signing.js";

const MAX_REDIRECTS = 3;
/** 100 pages of 20: the whole history of all but the busiest accounts. */
const DEFAULT_MAX_PAGES = 100;

interface NoteItem extends FeedPost {
  inReplyTo: string | null;
}

/**
 * Real implementation against any ActivityPub-speaking account (Mastodon,
 * Sharkey, and compatible instances) — walks the standard actor -> outbox
 * -> pages path that every such server exposes, with no platform-specific
 * API (spec rule #29's "no-auth-required public API" precedent, extended
 * to reads instead of writes).
 */
export class ActivityPubFeedProvider implements FeedIngestionProvider {
  /**
   * `guard` defaults to the real SSRF check but is injectable so tests
   * that mock `fetch` entirely (never touching real DNS/network) don't
   * have to pay for — or fight — a real DNS lookup against a fake domain.
   *
   * `sign` signs every read as this server's instance actor: a server in
   * authorized-fetch mode answers 401 to an unsigned read of an outbox.
   */
  constructor(
    private readonly guard: (url: string) => Promise<void> = assertPublicHttpUrl,
    private readonly sign?: RequestSigner,
  ) {}

  private async getJson<T>(url: string, hop = 0): Promise<T> {
    if (hop > MAX_REDIRECTS) throw new FeedIngestionProviderError("Too many redirects.");
    // Every URL actually fetched is checked here — not just the caller's
    // original `actorUrl` — because the actor/outbox response itself names
    // the next URL to fetch, and a malicious or compromised instance could
    // point that at an internal address the original URL never mentioned.
    await this.guard(url);
    const res = await fetchFeedResource(url, "application/activity+json", this.sign?.(url), this.guard === assertPublicHttpUrl);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new FeedIngestionProviderError("Redirect with no Location header.");
      return this.getJson<T>(new URL(location, url).toString(), hop + 1);
    }
    if (!res.ok) throw new FeedIngestionProviderError(`${url} returned ${res.status}`);
    return (await res.json()) as T;
  }

  /** The newest page only — what checking an account on connect needs. */
  async fetchRecentPosts(actorUrl: string): Promise<FeedPost[]> {
    return this.fetchPosts(actorUrl, { maxPages: 1 });
  }

  /**
   * The account's own posts, newest first, page after page.
   *
   * Replies are kept when they are the author's own thread — a reply to
   * their own post, which is how a long post is written on Mastodon — and
   * dropped when they answer someone else. Every reply used to be dropped,
   * which lost every thread past its first post. Boosts are someone
   * else's posts and are never taken.
   */
  async fetchPosts(actorUrl: string, options: FeedWalkOptions = {}): Promise<FeedPost[]> {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const actor = await this.getJson<{ id?: string; outbox?: string }>(actorUrl);
    if (!actor.outbox) throw new FeedIngestionProviderError("This account's actor document has no outbox.");
    const actorId = actor.id ?? actorUrl;

    type Page = { orderedItems?: unknown[]; items?: unknown[]; next?: string | { id?: string } };
    const outbox = await this.getJson<Page & { first?: string | Page & { id?: string } }>(actor.outbox);

    const notes: NoteItem[] = [];
    let page: Page | null =
      outbox.first === undefined ? outbox : typeof outbox.first === "string" ? null : (outbox.first as Page);
    let nextUrl: string | undefined = typeof outbox.first === "string" ? outbox.first : undefined;

    for (let read = 0; read < maxPages; read += 1) {
      if (!page) {
        if (!nextUrl) break;
        page = await this.getJson<Page>(nextUrl);
      }
      const onPage = notesOn(page);
      notes.push(...onPage);

      // Nothing new on this page: everything older was imported before.
      if (options.isKnown && onPage.length > 0) {
        const known = await Promise.all(onPage.map((note) => options.isKnown!(note.remoteId)));
        if (known.every(Boolean)) break;
      }

      nextUrl = typeof page.next === "string" ? page.next : page.next?.id;
      page = null;
    }

    const own = new Set(notes.map((note) => note.remoteId));
    const kept: FeedPost[] = [];
    for (const note of notes) {
      if (note.inReplyTo) {
        const toOwnPost =
          note.inReplyTo.startsWith(`${actorId}/`) ||
          own.has(note.inReplyTo) ||
          (options.isKnown ? await options.isKnown(note.inReplyTo) : false);
        if (!toOwnPost) continue;
      }
      kept.push({ remoteId: note.remoteId, text: note.text, url: note.url, publishedAt: note.publishedAt });
    }
    return kept;
  }
}

/** The account's own Notes on one outbox page. */
function notesOn(page: { orderedItems?: unknown[]; items?: unknown[] }): NoteItem[] {
  const items = (page.orderedItems ?? page.items ?? []) as Array<Record<string, unknown>>;
  const out: NoteItem[] = [];
  for (const activity of items) {
    if (activity.type !== "Create") continue;
    const object = activity.object as Record<string, unknown> | undefined;
    if (!object || object.type !== "Note") continue;
    const id = object.id as string | undefined;
    const content = object.content as string | undefined;
    const published = object.published as string | undefined;
    if (!id || !content || !published) continue;
    const inReplyTo = object.inReplyTo;
    out.push({
      remoteId: id,
      text: stripHtml(content),
      url: (object.url as string | undefined) ?? id,
      publishedAt: new Date(published),
      inReplyTo: typeof inReplyTo === "string" ? inReplyTo : inReplyTo && typeof inReplyTo === "object" ? ((inReplyTo as { id?: string }).id ?? null) : null,
    });
  }
  return out;
}
