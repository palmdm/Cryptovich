import { ActivityPubFeedProvider, RssFeedProvider, type FeedIngestionProvider, type RequestSigner } from "@platform/integrations";
import type { FeedSourcePlatform } from "@platform/db";

/**
 * Mastodon and Sharkey are both standard ActivityPub servers, so one
 * generic provider handles either — for those two the `platform` field is
 * UI labeling, not a technical branch. RSS is a genuinely different
 * protocol and gets its own provider.
 *
 * Kept as a resolvable function (rather than calling the classes directly)
 * so tests can inject a mock provider.
 */
export function resolveFeedProvider(platform: FeedSourcePlatform, sign?: RequestSigner): FeedIngestionProvider {
  // `sign`: reads of an ActivityPub account are signed as this server, or
  // a server in authorized-fetch mode refuses them with 401.
  return platform === "RSS" ? new RssFeedProvider() : new ActivityPubFeedProvider(undefined, sign);
}
