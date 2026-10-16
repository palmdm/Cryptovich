# Product Spec

## Positioning

Not "Boosty with crypto." A privacy-first creator economy platform where
`DigitalProduct` is the marketplace's fundamental unit, cryptocurrency is
the payment layer, `Entitlement` is the access layer, and ActivityPub is
the distribution layer. Four independently-evolvable layers:

1. **Content** — Posts / Files / Stickers
2. **Marketplace** — DigitalProducts / Bundles / Store
3. **Monetization** — Crypto / Donations / Subscriptions / Purchases
4. **Distribution** — ActivityPub / Mastodon / Sharkey

## User model

Roles: `USER`, `CREATOR`, `ADMIN`, `MODERATOR`. Becoming a creator adds a
`CreatorProfile` to an existing `User` and flips `role` to `CREATOR` — it
is never a separate account (spec rule #7; implemented in
`CreatorService.becomeCreator`). Public creator URL: `/@username` in the
final URL scheme (currently `/:username` — see API.md note on URL scheme).

## Digital products

Every sellable thing is a `DigitalProduct`:

- `type`: `POST | BUNDLE | STICKER_PACK | DIGITAL_FILE` (extensible —
  `COURSE`, `VIDEO`, etc. are additive later; see ARCHITECTURE.md).
  `DIGITAL_FILE` has the schema (`storageKey`, `mimeType`, `checksumSha256`)
  but no working upload/download route yet — no `StorageService`.
- `status`: `DRAFT | PUBLISHED | ARCHIVED | DISABLED`
- `visibility`: `PUBLIC | SUBSCRIBERS | TIER | PURCHASED | PRIVATE`
- `pricing`: `FREE | ONE_TIME | SUBSCRIPTION` per `ProductPrice` row

`POST` and `STICKER_PACK` are fully implemented end to end (create,
publish, price, store listing, entitlement-gated access, purchase). Post
content is plain text today — no inline images/video/audio/stickers in the
editor itself yet (spec rule #24 is only partially met).

## Bundles

A `BUNDLE` is a `DigitalProduct` whose members are linked through
`ProductItem`. `PricingService.computeBundlePricing` computes individual
value, bundle price and savings server-side; the dashboard bundle editor
lets a creator create a bundle, check off which of their published
products belong in it, and publish. Purchasing a bundle grants an
entitlement for the bundle *and* every member product in one transaction,
without duplicating a buyer's existing entitlements (spec rule #18) —
`EntitlementService.listOwned` dedupes the library view by product while
keeping every underlying grant row for correct refund/revocation
semantics. What's missing: drag-and-drop reordering in the UI (the API
supports arbitrary reordering; the editor doesn't expose it yet).

## Stickers

`StickerPack` is a `DigitalProduct` (`type = STICKER_PACK`) with `Sticker`
rows and source-attribution fields (`sourceProvider`, `sourceInstance`,
`sourceUrl`, `sourceAuthor`, `license`, `attribution` — spec rule #30).
Import is real: `TelegramStickerProvider` uses the Bot API's
`getStickerSet`/`getFile` (no per-creator OAuth needed — just a platform
bot token); `SharkeyStickerProvider` hits a creator-supplied instance's
public `/api/emojis` endpoint. A `CreatorExternalConnection` records a
verified connection; `POST /stickers/import` enqueues an `ImportJob` the
worker (`process-import-jobs.ts`, polled every 5s) actually executes,
creating a `DRAFT` sticker-pack product the creator then prices and
publishes. What's missing: the sticker *picker inside the post editor*
(spec rule #33) — the post editor is plain text, so stickers can't be
inserted into a post yet, only sold as their own product.

## Subscriptions and donations

`SubscriptionTier` / `Subscription` and `Donation` are fully wired to
`PaymentService` — the same checkout/state-machine/idempotency machinery
product purchases use, with `purpose` distinguishing them (spec rule #42).
A subscription gets a `PENDING` row at checkout and activates
(`status=ACTIVE`, `startedAt`/`expiresAt` set) only on payment
confirmation; access to `SUBSCRIBERS`/`TIER`-gated products is checked
*live* against `Subscription`, not pre-granted per product, so a creator's
catalog can grow under a tier without a backfill. Cancelling keeps access
until the paid period ends; a background job (`expire-subscriptions.ts`)
settles lapsed subscriptions to `EXPIRED` or `CANCELLED`. There's no
auto-renewal charge — crypto subscriptions here are prepaid periods, not a
custodial recurring mandate, matching the non-custodial preference (spec
rule #51).

## Federation

`FederationInstance`, `CreatorFederationSettings`,
`CreatorFederationInstance` (per-creator allowlist) and `FederatedPost`
match spec rules #66–70, and `FederationService`
(`apps/api/src/modules/federation`) enforces the `PUBLIC` + `FREE`-only
rule (spec rules #69/#73) before a delivery job is even enqueued.
Enabling federation generates a per-creator ActivityPub actor keypair;
delivery is a real signed HTTP request built by `ActivityPubProvider`
(`packages/integrations`), executed by the worker with retry + backoff +
a dead-letter `FAILED` state, never inline in a request. New instance
domains a creator adds start `PENDING` until a platform admin approves
them (spec rule #68's platform-level policy, now wired up in Phase 10's
admin module) — only `APPROVED` instances are ever actually delivered to.
**Known gap:** the platform doesn't yet serve its own creators'
actor/WebFinger documents, so a real, unmodified fediverse instance may
still reject delivery even though the signature is valid — see
docs/FEDERATION.md.

## Admin & moderation

`Report` (creator/product/post/sticker-pack/bundle, spec rule #85) and the
`/admin/*` routes (spec rule #84) are implemented: list users/products/
payments/reports/federation-instances/audit-log, suspend/restore a user
(revokes sessions immediately), disable/enable a product (which then 404s
for non-owners, not just loses its content), resolve a report,
approve/block a federation instance. Every action writes an `AuditLog`
row (spec rule #86). There's no self-serve admin-granting route by
design — see docs/SECURITY.md.

## What "done" means here (spec rule #143)

A feature isn't counted as implemented in this repo unless: backend route
+ service exist, frontend calls the real endpoint (no mock data),
authorization is enforced server-side, errors and loading/empty states are
handled in the UI, and it's covered by at least one test. `docs/ARCHITECTURE.md`'s
phase table and "Known simplifications" section are the authoritative,
up-to-date list of what stops short of that bar and why.
