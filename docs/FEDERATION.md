# Federation (ActivityPub)

**Status: implemented, outbound-only, with one documented interoperability
gap.** `FederationProvider` (`packages/integrations/src/federation`),
`MockFederationProvider`, and a real `ActivityPubProvider` — genuine HTTP
Signature-signed delivery of `Create`/`Update`/`Delete` activities to a
target instance's shared inbox — all exist and are tested (including
verifying the signature is cryptographically valid, and a local fake-inbox
integration test for the worker job). Settings, instance allowlisting,
per-post publish/retract routes (`apps/api/src/modules/federation`) and a
background delivery job with retry + exponential backoff + a dead-letter
`FAILED` state (`apps/worker/src/jobs/process-federation-jobs.ts`) are all
wired up and covered by tests.

**Known interoperability gap:** this platform does not yet serve actor
documents (`GET /users/:username`) or a WebFinger endpoint
(`/.well-known/webfinger`) for its own creators. A real Mastodon/Sharkey
instance that insists on dereferencing the sending actor before trusting a
signed delivery will still reject it, even though the signature itself is
constructed correctly. Building actor/WebFinger hosting is the natural
next step before this can interoperate with a live, unmodified fediverse
server — tracked here rather than left silently broken.

## Why this is a provider abstraction, not a direct integration

Business logic (a `FederationService`) will depend only on this interface,
matching the `PaymentProvider` pattern already used for payments:

```ts
interface FederationProvider {
  connect(): Promise<void>;
  verifyConnection(): Promise<boolean>;
  publishPost(post: PublicPostPayload): Promise<{ remotePostId: string; remoteUrl: string }>;
  updatePost(remotePostId: string, post: PublicPostPayload): Promise<void>;
  deletePost(remotePostId: string): Promise<void>;
  publishMedia(media: MediaPayload): Promise<{ remoteUrl: string }>;
  getActor(): Promise<ActorInfo>;
}
```

`ActivityPubProvider` will be the primary implementation, usable against
Mastodon, Sharkey, or any ActivityPub-compatible instance. A
`MockFederationProvider` (spec rule #115) should land alongside it for
tests, simulating publish/update/delete/failure/timeout/retry/duplicate
exactly the way `MockPaymentProvider` simulates the payment chain today.

## Rules the future implementation must enforce

1. **Free public content only, by default.** Only `DigitalProduct` rows
   with `visibility = PUBLIC` and an active `FREE` price are eligible for
   federation (spec rules #69, #73). This must be checked at the moment a
   federation job is enqueued, not assumed from the caller.
2. **Per-creator opt-in and allowlist.** Nothing federates unless
   `CreatorFederationSettings.enabled = true`, and only to instances the
   creator explicitly added to `CreatorFederationInstance` (spec rule #68)
   — federation is never on by default for an existing creator.
3. **Background jobs, not request-time HTTP calls.** Publishing to a
   remote instance happens in `apps/worker`, with retry + exponential
   backoff + a dead-letter path, the same way `expire-stale-payments`
   already runs on an interval outside the request lifecycle (spec rule
   #71). `FederatedPost.status` (`PENDING/PUBLISHED/FAILED/DELETED/
   RETRACTED`) tracks per-instance delivery state so a partial failure
   across instances is visible and retryable per-instance.
4. **Paid → free transitions may federate; free → paid must retract.** If
   a paid post's visibility changes to `PUBLIC` + `FREE`, it becomes
   eligible for a new federation job. If a federated free post is later
   made paid, the service must attempt retraction/deletion on every
   instance it reached — and must not claim success it can't guarantee,
   since not every remote instance supports (or will honor) a delete
   request (spec rule #74).
5. **Never leak private data outward.** The `PublicPostPayload` sent to
   `publishPost` must never include wallet addresses, payment/purchase
   data, subscriber lists, internal UUIDs, or private analytics — only
   what's already public on the platform (spec rule #75).
6. **No full bidirectional sync in v1.** Replies, likes, boosts and follows
   flowing back from the fediverse are explicitly out of scope for the
   first implementation (spec rule #79); the interface above is shaped so
   they can be added later without a redesign (e.g. `getActor` already
   anticipates inbound activity handling).

## UI

Implemented: `/dashboard/federation` (enable/auto-publish toggles, instance
allowlist management with per-instance approval status) and a "Federate to
your instances" action on a creator's own public/free post page — shown
only for `POST`-type products that are actually `PUBLIC` + `FREE` and
owned by the viewer, never present-but-disabled for ineligible content
(spec rules #1, #78, #133). Not yet built: a per-post federation status
breakdown (which instances succeeded/failed) beyond the raw
`GET /federation/posts/:productId` API, and the "Posts published / last
sync" per-instance dashboard summary from spec rule #77.
