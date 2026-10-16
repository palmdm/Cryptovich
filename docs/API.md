# API

Base URL: `http://localhost:4000` in development (`NEXT_PUBLIC_API_URL`).
All endpoints are JSON. The frontend authenticates with a `httpOnly`,
`SameSite=Lax` session cookie (`platform_session`) via
`fetch(..., { credentials: "include" })`. Your own scripts authenticate
instead with a personal access token (see **Tokens** below) as
`Authorization: Bearer <token>` — no cookie required.

Interactive, directly-callable docs (Swagger UI, built from a
hand-written OpenAPI 3.0 spec) are served at `GET /docs` once the API is
running. This file is the fuller prose reference; `/docs` is the one to
actually try requests from.

> **URL scheme note:** the spec's target public URL is `/@username`
> (spec rule #131). The current implementation uses `/:username` (no `@`)
> for both the API path and the Next.js route, to keep the first slice
> simple. Switching to `/@username` is a routing-only change (Next.js
> dynamic segment rename + API prefix) and is tracked in
> ARCHITECTURE.md's roadmap rather than done ad hoc.

Every endpoint below is implemented and exercised by an integration test in
`apps/api/test/*.test.ts`, except the handful listed under "Not
implemented" at the end.

## Auth — `/auth`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | — | `{ username, password, email? }`. Rate-limited (10/min). |
| POST | `/auth/login` | — | `{ identifier, password }`. Rate-limited (10/min). |
| POST | `/auth/logout` | session | Revokes the current session server-side. |
| GET | `/auth/me` | optional | `{ user: CurrentUser \| null }`. |
| GET | `/auth/sessions` | session cookie | The account's last 50 sign-ins, newest first: `signedInAt`, `userAgent`, the `browser` / `os` / `kind` read from it, `status` (`ACTIVE` / `SIGNED_OUT` / `EXPIRED`) and `current`. A personal access token is refused. |

## Tokens — `/tokens`

The "mini-API for the convenience of automation for the author": a
creator's own script authenticates with one of these instead of a
browser session.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/tokens` | session or token | `{ name }` → `{ token, id, name, createdAt }`. `token` (prefixed `pat_`) is a SHA-256-hashed secret shown exactly once — only the hash is stored, mirroring how session tokens work (`lib/session.ts`), and it's never recoverable after this response. |
| GET | `/tokens/mine` | session or token | Caller's active (non-revoked) tokens — never the raw value or hash, just `id`/`name`/`lastUsedAt`/`createdAt`. |
| DELETE | `/tokens/:id` | session or token, owner | Revokes immediately; a request already in flight with that token still completes, the next one 401s (informationally — see `/auth/me`'s `user: null` behavior). |

## Creators — `/creators`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/creators` | session | Adds a `CreatorProfile` to the caller, sets `role=CREATOR`. Idempotent. |
| PATCH | `/creators/me` | session, must be creator | Update display name/bio/links/avatar/cover/privacy toggles/`manualPaymentInstructions`/`welcomeMessage{NewSubscriber,Renewal,Donor}`. Each welcome-message field falls back to a generic default when left blank — see `NotificationService.welcomeMessageFor`. |
| GET | `/creators/me` | session, must be creator | Caller's own full profile, including the private `manualPaymentInstructions` text (never exposed by the public endpoint below). |
| GET | `/creators/:username` | — | Public profile. Only returns subscriber count if the creator opted in; exposes `acceptsManualPayments: boolean`, never the instructions themselves. |

## Products — `/products`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/products/posts` | session, creator | Creates a `DigitalProduct(type=POST)` in `DRAFT`. |
| POST | `/products/:id/publish` | session, owner | `DRAFT/ARCHIVED → PUBLISHED`. The *first* time a `POST` is published, every active subscriber of the creator gets a `NEW_POST` notification — republishing after an unpublish doesn't repeat it. |
| POST | `/products/:id/unpublish` | session, owner | `→ ARCHIVED`. |
| GET | `/products/mine` | session, creator | Caller's own products (any status). |
| POST | `/products/:id/attachments` | session, owner, `multipart/form-data` | One file field, up to `MAX_UPLOAD_BYTES` (default 5MB). `kind` (`IMAGE`/`VIDEO`/`AUDIO`/`FILE`) is inferred from the MIME type; only posts accept attachments. Stored via `StorageService` (local disk) under a server-generated key, never the raw filename. |
| DELETE | `/products/:id/attachments/:attachmentId` | session, owner | Deletes the row and the underlying stored file. |
| GET | `/products/:id/attachments/:attachmentId/file` | optional | Streams the file back — re-runs `EntitlementService.canAccessProduct` on every request, exactly like the post's own text content; the URL itself carries no access of its own. `FILE`-kind attachments get `Content-Disposition: attachment`, everything else `inline` (playable/viewable directly). |

## Avatars — `/creators/me/avatar`, `/avatars`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/creators/me/avatar` | session, creator, `multipart/form-data` | One image file (PNG/JPEG/GIF/WebP only — no SVG, see SECURITY.md), up to `MAX_UPLOAD_BYTES`. Sets `CreatorProfile.avatarUrl` to a servable `/avatars/:key` path. |
| GET | `/avatars/:key` | none | Always public — no entitlement check, the same as any social-platform avatar. `:key` is validated against the exact `{uuid}.{extension}` shape the upload endpoint produces before it ever touches the filesystem, so nothing resembling a path-traversal attempt can resolve to a real file. |

## Dual-feed ingestion — `/feed-sources`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/feed-sources` | session, creator, rate-limited (15/min) | `{ platform: "MASTODON" \| "SHARKEY", actorUrl }`. Fetches the actor before persisting (fail-closed, same connect-then-verify shape as sticker connections) — 400 if it doesn't resolve, or if it (or any URL its response names in turn) resolves to a private/internal address (SSRF guard, see SECURITY.md). |
| GET | `/feed-sources/mine` | session, creator | Caller's connected accounts, including `lastFetchedAt`/`lastError`. |
| DELETE | `/feed-sources/:id` | session, owner | Deactivates the source; already-imported posts are untouched. |

A background worker tick (`apps/worker/src/jobs/ingest-external-feeds.ts`, every 10 minutes per source) walks each active source's public ActivityPub actor → outbox → first page, and mirrors any standalone `Note` not already seen (deduped via `FeedImportedItem`) into the creator's own feed as a `PUBLIC`, already-`PUBLISHED` `POST` — free content sitting alongside whatever paid posts the creator writes directly here.

## Comments — `/products/:id/comments`, `/comments`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/products/:id/comments` | session | `{ body }` — gated by the exact same rule as the post's own content (`EntitlementService.canAccessProduct`); 403 if the caller can't view the post. Notifies the creator with a `NEW_COMMENT` notification (skipped if the creator is commenting on their own post). |
| GET | `/products/:id/comments` | optional | Same access gate as above — includes anonymous callers when the post is `PUBLIC`. |
| DELETE | `/comments/:id` | session, author or post's creator | Soft delete (`deletedAt`), so it's excluded from listings but kept for moderation history. |

## Notifications — `/notifications`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/notifications` | session | `{ notifications, unreadCount }` — the caller's 50 most recent, newest first. |
| POST | `/notifications/:id/read` | session, owner | Marks one notification read. |
| POST | `/notifications/read-all` | session | Marks every unread notification read. |

## Store — `/store` (public)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/store/:username` | optional | Published products for a creator, featured-first. |
| GET | `/store/:username/:slug` | optional | Returns `{ product, access, content, attachments }`. `content`/`attachments` are only populated when `access.allowed` is `true` — decided server-side by `EntitlementService`, never by the client. |

## Payments — `/payments`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/payments/checkout` | session | `{ productId, method?: "crypto" \| "manual" }` → creates/resumes a `Payment` + `Purchase`. `method: "manual"` skips the crypto provider and returns the creator's own `manualInstructions` text instead of a `paymentRequest`; 400 if the creator hasn't set any. Rate-limited (20/min). |
| GET | `/payments/:id` | session owner, **or unauthenticated** if `Payment.userId` is null | Current payment status. A no-registration donation's payment id is itself the anonymous payer's capability token — anyone holding the (unguessable) id can poll it. |
| POST | `/payments/:id/mark-paid` | none | Payer's "I've sent it" flag (`payerMarkedPaidAt`). Purely informational — never advances `status` on its own; only the recipient's `/confirm` below actually grants access. |
| POST | `/payments/:id/confirm` | session, must be the payment's recipient | The creator/tier-owner confirming receipt themselves. The only way a `method: "manual"` payment ever completes; also usable to unstick a crypto payment without a real chain. Reuses the same completion pipeline as `dev-advance`. |
| POST | `/payments/:id/reject` | session, must be the payment's recipient | Marks the payment `FAILED`; no access is granted. |
| GET | `/payments/pending` | session, creator | This creator's "pending confirmations" queue — every non-terminal payment across their purchases/donations/subscriptions, unioned from the three owning tables (`Payment` has no direct creator column). |
| POST | `/payments/:id/dev-advance` | session, owner, **non-production only** | `{ event: "DETECT" \| "CONFIRM_STEP" \| "FAIL" \| "EXPIRE" \| "UNDERPAY" \| "OVERPAY" }`. Drives the mock provider's state machine and reconciles `Payment`/`Purchase`/`Entitlement`. Returns 404 when `NODE_ENV=production`. |

## Library — `/library`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/library` | session | Every active, deduplicated entitlement the caller holds, with the underlying product. |

## Bundles — `/products/bundles`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/products/bundles` | session, creator | Creates a `DigitalProduct(type=BUNDLE)` in `DRAFT`. |
| PATCH | `/products/bundles/:id` | session, owner | Update title/description/cover/price. |
| POST | `/products/bundles/:id/items` | session, owner | `{ itemProductId }` — add a member product (must be the same creator's, not itself, not another bundle). |
| DELETE | `/products/bundles/:id/items/:itemProductId` | session, owner | Remove a member product. |
| PUT | `/products/bundles/:id/items/order` | session, owner | `{ itemProductIds: string[] }` — reorder. |
| GET | `/products/bundles/:id/detail` | optional | Computed pricing (individual value / bundle price / savings) + member products + per-item `owned` for the viewer. |

## Donations — `/donations`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/donations/checkout` | none | `{ creatorUsername, amountDecimal, currency, message?, isPublic, method?: "crypto" \| "manual" }` → same `Payment`/checkout flow as a product purchase. No account needed — an anonymous request creates a `Donation` with `senderUserId: null`; the returned `payment.id` is the payer's capability token for status/mark-paid. On confirmation the creator gets a `DONATION_RECEIVED` notification; a signed-in donor also gets a `WELCOME_MESSAGE` (anonymous donors have no account to notify). |
| GET | `/donations/public/:username` | — | Recent public donations, only if the creator opted in (`CreatorProfile.showDonations`). |

## Subscriptions — `/subscriptions`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/subscriptions/tiers` | session, creator | Create a `SubscriptionTier`. |
| PATCH | `/subscriptions/tiers/:id` | session, owner | Update name/description/status. |
| GET | `/subscriptions/tiers/mine` | session, creator | Caller's own tiers. |
| GET | `/subscriptions/tiers/:username` | — | Public `ACTIVE` tiers for a creator. |
| POST | `/subscriptions/checkout` | session | `{ tierId, method?: "crypto" \| "manual", discountCode? }` → `Payment(purpose=SUBSCRIPTION)` + a `PENDING` `Subscription`, activated on confirmation. A tier priced at 0 (a free "follow, no payment" tier) or one discounted to 0 activates instantly with `payment: null`. `discountCode` is validated and its price effect computed server-side — the client never states the discounted amount. Once active, the creator gets a `NEW_SUBSCRIBER` or `SUBSCRIPTION_RENEWED` notification (renewal = this user has held *any* prior subscription row for this exact tier) and the subscriber gets a `WELCOME_MESSAGE`. |
| GET | `/subscriptions/mine` | session | Caller's active/past-due subscriptions. |
| POST | `/subscriptions/:id/cancel` | session, owner | Cancels at period end — access continues until `expiresAt`. |
| POST | `/subscriptions/discount-codes` | session, creator | `{ code, type: "PERCENT_OFF" \| "AMOUNT_OFF", value, maxRedemptions?, expiresAt? }` — codes are scoped to the creator; redemption count is enforced with an atomic compare-and-swap, not a lock. |
| GET | `/subscriptions/discount-codes/mine` | session, creator | Caller's own codes. |
| POST | `/subscriptions/discount-codes/:id/deactivate` | session, owner | Stops future redemptions; already-redeemed subscriptions are unaffected. |

## Sticker packs — `/products/stickers`

| Method | Path | Auth | Notes |
|---|---|---|---|
| PATCH | `/products/stickers/:id/price` | session, owner | Set visibility + price on a sticker pack before publishing it via the generic `/products/:id/publish`. |

Authors no longer import packs from Telegram or Sharkey; the server's own
sticker library (Admin → Stickers) is where sets are imported.

## Federation — `/federation`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / PATCH | `/federation/settings` | session, creator | Enable/auto-publish; enabling for the first time generates the creator's ActivityPub actor keypair. |
| POST | `/federation/instances` | session, creator | Add a domain to the caller's allowlist — starts `PENDING` until platform admin approval. |
| DELETE | `/federation/instances/:id` | session, creator | Remove from allowlist. |
| GET | `/federation/instances/mine` | session, creator | Caller's allowlisted instances + their approval status. |
| POST | `/federation/posts/:productId/publish` | session, owner | Enqueues delivery to every allowlisted instance — only for `POST`-type products that are `PUBLIC` + `FREE` (spec rules #69/#73). |
| POST | `/federation/posts/:productId/retract` | session, owner | Synchronous best-effort `Delete` activity per instance the post was published to. |
| GET | `/federation/posts/:productId` | session, owner | Per-instance `FederatedPost` status. |

## Analytics — `/analytics`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/analytics/overview?period=7d\|30d\|90d\|1y\|all` | session, creator | Real revenue (per currency, by source and by product type), purchase/donation/subscriber counts, top products with real view counts and conversion — nothing estimated (spec rule #146). |

## Reports & Admin — `/reports`, `/admin`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/reports` | session | `{ targetType, targetId, reason }`. |
| GET | `/admin/users` \| `/admin/products` \| `/admin/payments` \| `/admin/reports` \| `/admin/federation/instances` \| `/admin/audit-log` | admin | Listings, cursor-paginated. |
| POST | `/admin/users/:id/suspend` \| `/admin/users/:id/restore` | admin | Suspension revokes every active session immediately. |
| POST | `/admin/products/:id/disable` \| `/admin/products/:id/enable` | admin | Disabled products 404 their entire detail response for non-owners. |
| POST | `/admin/reports/:id/resolve` | admin | `{ status: "RESOLVED" \| "DISMISSED", note? }`. |
| POST | `/admin/federation/instances/:id/status` | admin | `{ status: "APPROVED" \| "BLOCKED" \| "PENDING" }` — only `APPROVED` instances ever receive a delivery attempt. |

Every admin route re-checks `role === "ADMIN"` server-side
(`app.requireAdmin`) and writes an `AuditLog` entry — the frontend hiding
the nav link is UX only, not the authorization boundary.

## Two-factor authentication — `/auth/2fa`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/2fa/setup` | session | Generates and stores a TOTP secret; does **not** enable 2FA yet. |
| POST | `/auth/2fa/verify` | session | `{ code }` — only this flips `twoFactorEnabled`, so an unscanned QR can't lock anyone out. |
| POST | `/auth/2fa/disable` | session | `{ password, code }` — both required, so a leaked password alone can't disable 2FA. |

`POST /auth/login` accepts an optional `code` field; if the account has
2FA enabled and it's missing or wrong, login fails with
`TWO_FACTOR_REQUIRED` / `INVALID_2FA_CODE` instead of creating a session.

## Not implemented

`/wallets` (Wallet rows exist in the schema but no CRUD routes),
`/entitlements` as its own resource (checks are internal to `store` and
`payments`), payout endpoints, editing/adding attachments on an
already-published post (the upload UI is only wired into the create-a-post
flow today), and cloud object storage (`StorageService` is local-disk
only — see `UPLOAD_DIR`/`MAX_UPLOAD_BYTES` in ARCHITECTURE.md/.env.example).

## Error shape

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable, safe to show in the UI." } }
```

`AppError` subclasses (`apps/api/src/lib/errors.ts`) are the only errors
that reach the client with their own message; anything unexpected is
logged with full detail server-side and returned as a generic 500 (spec
rule #99).
