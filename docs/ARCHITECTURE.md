# Architecture

## Shape: modular monolith

Microservices are not the right default here (spec rule #105). The backend
(`apps/api`) is a single Fastify process organized into domain modules that
each own their own routes/service/schema files under
`apps/api/src/modules/*`:

```
auth  creators  products  bundles  store  payments  donations
subscriptions  library  connections  stickers  federation
analytics  reports  admin  comments  notifications  streams
feed-sources
```

Frontend (`apps/web`, Next.js App Router) never talks to the database or a
payment/blockchain SDK directly; it only calls `apps/api` over HTTP with
credentialed cookies. `apps/worker` runs every recurring/background job
outside the request lifecycle (spec rule #82): payment expiry, subscription
expiry, sticker import processing, federation delivery with retry, and
dual-feed ingestion.

External-service integrations (Telegram, Sharkey, ActivityPub) live in
`packages/integrations` — a provider-interface package shared by both
`apps/api` (to enqueue/verify) and `apps/worker` (to actually execute),
so neither app duplicates the HTTP/signing logic.

```
                    ┌──────────────┐
                    │   apps/web   │  Next.js, cookie session
                    └──────┬───────┘
                           │ HTTPS + cookies
                    ┌──────▼───────┐
                    │   apps/api   │  Fastify modular monolith
                    └───┬──────┬───┘
                        │      │
                 ┌──────▼──┐ ┌─▼────────┐
                 │ Postgres│ │  Redis   │  rate limiting
                 └─────────┘ └──────────┘
                        ▲
                        │ same schema
                 ┌──────┴───────┐        ┌────────────────────────┐
                 │  apps/worker │◄───────┤ packages/integrations  │
                 │ (all jobs)   │        │ Telegram / Sharkey /   │
                 └──────────────┘        │ ActivityPub providers  │
                                          └────────────────────────┘
```

## Core domain model

`DigitalProduct` is the single marketplace unit (spec rules #9, #10). A
`POST`, `BUNDLE`, `STICKER_PACK` or `DIGITAL_FILE` is a row in
`DigitalProduct` with a type-specific side table (`Post`, `StickerPack`,
`DigitalFile`) holding the type's own fields. Bundle composition uses a
generic `ProductItem` edge (`bundle → member product`) rather than a
type-specific join table, so a future `COURSE` or `VIDEO` type can be added
to a bundle without touching bundle code (spec rules #15, #128–130).

Purchases, payments, wallets and entitlements are separate entities (spec
rule #5) — `User` never grows payment/wallet columns, `DigitalProduct` never
grows payment columns. The only thing allowed to decide "can this user see
this" is `EntitlementService.canAccessProduct` (see below) — no route, no
product-type handler, and definitely no frontend code, is allowed to make
that call itself (spec rules #13, #61, #133, #147).

Full entity list and relationships: `docs/DATABASE.md`.

## Money

All prices are `BigInt` minor units + an ISO-ish currency code, wrapped by
`packages/shared/src/money.ts::Money`. Nothing does float arithmetic on a
price. The frontend never computes a price, a discount, or a bundle
savings figure — `PricingService.computeBundlePricing` is the only place
bundle "individual value / price / savings" math happens (spec rules #12,
#19, #56, #147). Analytics revenue is reported per-currency
(`Record<currency, amountMinor>`), never blended into one number, since a
creator can price different products in USD or EUR.

## Entitlements

`EntitlementService.canAccessProduct(userId, productId)` is backend-side
and returns a typed `AccessDecision` (`PUBLIC`, `OWNER`, `PURCHASED`,
`SUBSCRIBED`, `MANUAL_GRANT`, `NOT_ENTITLED`, `PRODUCT_NOT_FOUND`,
`PRODUCT_DISABLED`). It is called once, at the point of serving content
(`GET /store/:username/:slug`), and gated content (post content,
attachments, sticker URLs, bundle items) is only attached to the response
when the decision says so — the API response for a locked product simply
omits the field rather than sending it and trusting the client not to
render it (spec rule #63). A product that isn't `PUBLISHED`, or one a
moderator has `DISABLED`, 404s its *entire* detail response for a
non-owner — not just its content — so a guessed slug can't confirm a
draft's or moderated item's title/price/existence either.

Subscription-gated visibility (`SUBSCRIBERS`/`TIER`) is checked *live*
against the `Subscription` table rather than pre-granting `Entitlement`
rows per product: a creator's catalog can grow under a tier without a
backfill job re-granting access to every existing subscriber. `TIER`
specifically fails **closed**: if `requiredTierId` is unset, access is
denied outright rather than degrading to "any subscriber of this
creator" — a fallback that would have silently turned a tier-gated
product into a subscribers-only one.

Bundle entitlement fanout has exactly one implementation —
`EntitlementService.grantBundlePurchase` — and every caller, including
`PaymentService.completePurchase`, goes through it (passing the active
`$transaction` client so the grants commit atomically with the purchase
update) rather than re-deriving the loop. It grants an entitlement for the
bundle product *and* every member product in one transaction, using
`upsert` on `(userId, productId, sourceType, sourceId)` so a user who
already owned 3 of 12 bundle items ends up with exactly 12 *distinct*
library entries, not 15 — `EntitlementService.listOwned` dedupes by
product while still keeping every underlying grant row intact, since a
bundle refund shouldn't silently revoke access a direct purchase already
paid for (spec rule #18).

## Payments

`PaymentProvider` (`apps/api/src/modules/payments/provider.ts`) is the only
interface business logic depends on — never a chain SDK directly (spec rule
#48). `MockPaymentProvider` implements it today; a real BTC/EVM adapter
implements the same interface later with zero changes to `PaymentService`,
routes, or the frontend (spec rule #149). The same `PaymentService`
orchestrates product purchases, bundle purchases, donations, *and*
subscription checkouts — one state machine, one idempotency mechanism, for
every purpose (`PaymentPurpose`).

State machine (`PaymentStatus`): `CREATED → AWAITING_PAYMENT → DETECTED →
CONFIRMING → CONFIRMED`, with `EXPIRED / FAILED / UNDERPAID / OVERPAID /
REFUNDED` as terminal/exception states (spec rule #52).

Idempotency (spec rule #55): `Payment.idempotencyKey` is unique;
`PaymentService.applyProviderState` is wrapped in a DB transaction that
first checks whether the payment is already `CONFIRMED`/`REFUNDED` and
no-ops if so, so a replayed confirmation (or, later, a replayed webhook)
cannot create a second `Purchase`/`Entitlement`/`Subscription` activation.
`Purchase.paymentId`, `Donation.paymentId` and `Subscription.paymentId` are
each unique, enforcing one grant per payment at the schema level too.
Starting a checkout is guarded the same way against a *concurrent* request
for the same user+product/tier — `withScopeLock` wraps the
check-for-an-existing-pending-payment read and the create in one
transaction behind a Postgres advisory lock keyed to that scope, so two
simultaneous checkout clicks can't both pass the check before either has
written (`apps/api/test/checkout-race.test.ts` fires 10 concurrent
requests and asserts exactly one `Purchase`/`Subscription` results).

Background expiry (`apps/worker/src/jobs/expire-stale-payments.ts`,
`expire-subscriptions.ts`) moves payments/subscriptions that lapsed past
their `expiresAt` into a terminal state on an interval outside the request
path — the same pattern chain-confirmation polling will use later.
Subscriptions are treated as prepaid periods rather than auto-renewing
custodial charges: there is no automatic second charge, so a lapsed
subscription becomes `EXPIRED` (or `CANCELLED` if the user had already
cancelled) rather than silently re-billing. `expire-stale-payments.ts`
also cancels the `PENDING` `Subscription` row tied to an abandoned
checkout's expired `Payment` — without this, `startSubscriptionCheckout`'s
"you already have a pending/active subscription" guard would permanently
block a user who abandoned checkout once from ever subscribing to that
tier again.

## External integrations (Telegram, Sharkey, ActivityPub)

`packages/integrations` holds every third-party provider interface and
implementation, so `apps/api` (which enqueues work and verifies
connections) and `apps/worker` (which actually executes deliveries/imports)
share one implementation instead of two:

- **Stickers** (`StickerProvider`): `MockStickerProvider` for tests,
  `TelegramStickerProvider` (real — Telegram's Bot API `getStickerSet`
  needs only a bot token, no OAuth), `SharkeyStickerProvider` (real — most
  Sharkey/Misskey instances expose a public `/api/emojis` list). Import
  runs as a background `ImportJob` the worker polls every 5s
  (`process-import-jobs.ts`), never inline in a request.
- **Federation** (`FederationProvider`): `MockFederationProvider` for
  tests, `ActivityPubProvider` — real HTTP Signature-signed delivery
  (`packages/integrations/src/federation/signing.ts`, verified against a
  real RSA keypair in tests) of `Create`/`Update`/`Delete` activities to a
  target instance's shared inbox. Delivery runs as a background job with
  retry + exponential backoff + a dead-letter `FAILED` state after 5
  attempts (`process-federation-jobs.ts`), polled every 10s, and processed
  with `Promise.allSettled` rather than a sequential loop — independent
  deliveries to different instances don't block on each other, so one
  slow/unresponsive instance can't stall the rest of the batch (verified
  in `apps/worker/test/process-federation-jobs.test.ts` by measuring that
  a fast delivery completes in roughly the slow one's own delay, not the
  sum of both). **Known gap:** this platform doesn't yet serve
  actor/WebFinger documents for its own creators, so a real instance that
  insists on dereferencing the sender before trusting a signature will
  still reject delivery even though the signature itself is constructed
  correctly — see docs/FEDERATION.md.

## Admin & moderation

`app.requireAdmin` is a separate authorization check from `requireAuth`,
re-verified on every `/admin/*` route server-side (spec rule #136). Every
moderation action (suspend/restore a user, disable/enable a product,
resolve a report, approve/block a federation instance) writes to
`AuditLog` (spec rule #86). Suspending a user revokes every active
`Session` row immediately, not just on next token refresh. There is no
"become admin" HTTP route by design — the first admin is promoted via a
direct database update, documented in docs/SECURITY.md, since an endpoint
for granting admin access is itself a privilege-escalation surface.

## i18n

Dictionary-based (`apps/web/lib/i18n/dictionaries.ts`), not a UI-text
framework dependency — a `LocaleProvider` context + `useLocale().t(key)`
hook, switchable at runtime via the nav bar's language selector, persisted
to `localStorage`. Coverage today: nav, home, login, register — a working
example of the mechanism, not full app coverage. Every other page's
strings are still hardcoded English; extending coverage is mechanical
(add keys to both `en`/`ru` dictionaries, replace literals with `t(...)`)
and tracked as follow-up rather than silently claimed as done.

## Known simplifications (tracked, not hidden)

- The worker's payment/subscription-expiry jobs re-implement a slice of
  the state transition logic that lives in `PaymentService`; if a real
  chain adapter is added, both should be extracted into a shared package
  instead of duplicated.
- Sessions are stored in Postgres, not cached in Redis yet — correct, but
  an extra query per request. Fine at this scale; add a Redis-backed
  read-through cache before it isn't.
- The Dockerfiles build the whole monorepo into each image (no
  lockfile committed, no multi-stage pruning) — functional, not yet
  optimized for image size or build cache reuse.
- File upload (spec rules #20–21) is real for post attachments —
  `StorageService` (local disk, `apps/api/src/lib/storage.ts`) backs
  `POST /products/:id/attachments`, and every download re-runs
  `EntitlementService.canAccessProduct` rather than trusting a signed URL.
  `DigitalFile` — a standalone file-as-its-own-product type, distinct from
  a `Post`'s attachments — remains unbuilt; every touched call site that
  branches on `DigitalProduct.type` (federation, stickers, bundles,
  analytics) made attaching media to a `POST` the natural fit instead of
  adding a new type. `StorageService` is local-disk only, not an
  interface with a swappable cloud backend the way `PaymentProvider`/
  `FederationProvider` are.
- CSRF: no dedicated double-submit token; `SameSite=Lax` already blocks
  the primary cross-site `POST` vector for a same-site deployment — see
  docs/SECURITY.md for the full reasoning and what would change it.
- ActivityPub federation is outbound-only with no actor/WebFinger hosting
  (see above) — real cross-instance interoperability needs that follow-up.

## What's implemented vs. spec phases 1–10

| Phase | What | Status |
|---|---|---|
| 1–3 | Foundation, auth, DigitalProduct core, content | Done — see PRODUCT_SPEC.md |
| 4 | Bundles: composition, smart pricing, editor UI, purchase | Done |
| 5 | Payments: abstraction, mock provider, checkout, state machine | Done; real chain adapter not started |
| 6 | Donations, subscription tiers, subscriptions, payout | Done; `PayoutService` abstraction not started |
| 7 | Stickers: Telegram + Sharkey import, sticker packs, picker | Done; sticker *picker inside the post editor* (spec rule #33) not built — editor is plain text today |
| 8 | ActivityPub federation | Done outbound-only; actor/WebFinger hosting gap above |
| 9 | Creator dashboard analytics + revenue | Done |
| 10 | Admin/moderation, 2FA, i18n, CI, rate limiting, health checks | Done; CSRF remains open |
| 11 | Media & content: post attachments (image/video/audio/file, `StorageService`), avatar upload, dual-feed ingestion | Done — see below (live streams were built here and removed in 0.3.0) |

Phase 11 detail: `POST /products/:id/attachments` accepts a real file
(≤`MAX_UPLOAD_BYTES`), stored locally and served back only after
`EntitlementService` re-approves the request — video/audio render inline
on the post page, `FILE`-kind attachments download. Dual-feed ingestion
(`apps/worker/src/jobs/ingest-external-feeds.ts`) polls a creator's own
Mastodon/Sharkey account's public ActivityPub outbox and mirrors new posts
in as free, already-published local posts — the same
connect-then-verify-before-persisting shape sticker connections use,
deduped via `FeedImportedItem` so a re-poll never doubles a post.

Not built at all: `DigitalFile` as a standalone product type (see above),
`PayoutService`, rich post editor (images/video/audio embedded inline in
the text itself, vs. today's separate attachments list — spec rule #24's
ambition only partially met), editing attachments on an already-published
post, SEO metadata/sitemap (spec rule #94), full i18n coverage beyond the
pages listed above.
