import type { FeedIngestionProvider, FeedPost } from "./provider.js";

export class MockFeedIngestionProvider implements FeedIngestionProvider {
  constructor(private readonly postsByActor: Record<string, FeedPost[]> = {}) {}

  async fetchRecentPosts(actorUrl: string): Promise<FeedPost[]> {
    return this.postsByActor[actorUrl] ?? [];
  }
}
