export interface FeedPost {
  remoteId: string;
  text: string;
  url: string;
  publishedAt: Date;
}

export interface FeedWalkOptions {
  /**
   * Whether a post was imported before. The walk stops at a page with
   * nothing new on it, and a reply to a known post is the author's own
   * thread, so it is kept.
   */
  isKnown?: (remoteId: string) => Promise<boolean>;
  /** The most pages to read (a Mastodon outbox page is 20 posts). */
  maxPages?: number;
}

/**
 * Pulls a creator's own public posts from an external account they also
 * control (Mastodon/Sharkey) so they can appear in this platform's feed
 * too, alongside content authored directly here (spec: dual-feed —
 * "messages are taken from another tool ... paid posts are already
 * specifically written here"). Business logic (the ingestion worker job)
 * depends only on this shape, never on a platform's own API conventions.
 */
export interface FeedIngestionProvider {
  fetchRecentPosts(actorUrl: string): Promise<FeedPost[]>;
  /**
   * Past the first page, back through the account's history — every post,
   * not only the latest few. Optional: a provider without paging (RSS
   * serves one document) has only the recent posts to give.
   */
  fetchPosts?(actorUrl: string, options?: FeedWalkOptions): Promise<FeedPost[]>;
}

export class FeedIngestionProviderError extends Error {}
