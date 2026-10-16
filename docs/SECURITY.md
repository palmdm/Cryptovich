# Security

## Authentication

- Passwords hashed with Argon2id (`argon2` package,
  `apps/api/src/lib/password.ts`), never stored or logged in plaintext.
- Sessions are opaque random tokens (32 bytes, base64url); only a SHA-256
  hash is stored server-side (`Session.tokenHash`), so a database read
  never discloses a usable session token.
- Session cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production, 30-day
  expiry, server-side revocation on logout (`Session.revokedAt`).
- Login/registration are rate-limited (10 requests/min/IP via
  `@fastify/rate-limit`) to blunt credential stuffing and enumeration.
- Optional TOTP 2FA is implemented end to end (`apps/api/src/lib/totp.ts` —
  hand-rolled RFC 6238 over `node:crypto`, verified against the RFC 4226
  test vector in `apps/api/test/totp.test.ts`). Enrollment is two-step:
  `POST /auth/2fa/setup` generates a secret but does not enable 2FA;
  `POST /auth/2fa/verify` only flips `twoFactorEnabled` after a real code
  is confirmed, so a user can't lock themselves out with an unscanned QR
  code. Login requires the code once enabled; **disabling requires both
  the password AND a current code** — a leaked/reused password alone
  cannot strip 2FA off an account (`apps/api/test/two-factor-flow.test.ts`
  asserts a password-only attempt leaves it enabled). The code comparison
  itself (`verifyTotp`) uses `crypto.timingSafeEqual`, not `===`, so a
  timing side-channel can't be used to narrow down the correct digits.

## Authorization

- Every state-changing route calls `app.requireAuth(request)`, which
  throws a typed 401 if there's no valid session — there is no route that
  trusts a client-supplied user id.
- Ownership checks are explicit and server-side: `ProductService.publish`
  loads the product and compares `product.creatorId` to the caller's
  `CreatorProfile.id` before mutating anything (spec rule #135 — Creator A
  cannot touch Creator B's product).
- Content access is never decided twice in two different ways.
  `EntitlementService.canAccessProduct` is the single call site; the store
  route is the only place gated content is attached to a response, and it
  only does so after checking `access.allowed` (spec rules #61, #133).
- Rejects are generic on purpose where they should be: a locked/nonexistent
  product both return `PRODUCT_NOT_FOUND`-shaped responses rather than
  leaking which case it was.
- `TIER`-gated visibility fails **closed**: if a product is marked
  `visibility: TIER` but was never actually assigned a
  `requiredTierId` (a state that should be unreachable — creation
  validates it — but the access check doesn't trust that), it denies
  everyone rather than falling back to "any subscriber of this creator,"
  which would silently downgrade a tier-gated product to a
  subscribers-only one and leak access to subscribers on a cheaper tier.
  `apps/api/test/tier-gating.test.ts` asserts a subscriber to a $2 tier
  cannot see a post gated to the creator's $20 tier.

## File uploads & media

- Every uploaded file (post attachment or avatar) is stored on disk under a
  server-generated UUID key — never the client-supplied filename — so
  nothing about the stored path is attacker-influenced (`StorageService`,
  `apps/api/src/lib/storage.ts`).
- Post attachments are gated exactly like the post's own text content: the
  download route (`GET /products/:id/attachments/:attachmentId/file`)
  re-runs `EntitlementService.canAccessProduct` on *every* request rather
  than trusting a prior decision — the URL itself carries no capability of
  its own, unlike a signed S3 URL would.
- Avatars are deliberately the one upload type never gated (an avatar is
  always public, the same as any social platform), but `GET /avatars/:key`
  still validates `:key` against the exact `{uuid}.{extension}` shape
  `StorageService.save` produces, via a strict regex, before it's used to
  build a filesystem path — a `../../etc/passwd`-style value in the URL
  never reaches `fs.createReadStream` at all, it 404s at the validation
  step. `apps/api/test/media-uploads.test.ts` asserts this directly.
- Upload size is enforced twice: `@fastify/multipart`'s registered
  `fileSize` limit (one byte over `MAX_UPLOAD_BYTES`, so an oversized file
  is detectably truncated rather than silently accepted at exactly the
  limit) throws before a buffer is ever fully read, and each service
  method re-checks the buffer's actual size as defense in depth.
- Avatar uploads are further restricted to a small allowlist of raster
  image MIME types (PNG/JPEG/GIF/WebP) — not just "starts with `image/`",
  and deliberately **not** SVG. SVG is XML that can carry a
  `<script>`/event-handler payload; accepting it as an "image" and serving
  it back unauthenticated from this platform's own origin would be a
  stored-XSS vector, not just an upload. The MIME allowlist also has to be
  narrow because the extension embedded in the stored filename has to be
  trustworthy enough to round-trip back to the correct `Content-Type` on
  serve with no separate metadata store backing it.
- Post attachments accept any file type on upload (spec: "any type"), so
  the same defense can't live at the accept step — instead, how a file is
  *served back* is allowlisted, not denylisted: `GET
  /products/:id/attachments/:attachmentId/file` only sets
  `Content-Disposition: inline` for a MIME type on a small known-safe list
  (`SAFE_INLINE_MIME_TYPES`, `apps/api/src/lib/safe-inline-mime.ts`);
  anything else — including a client-claimed `image/svg+xml` or
  `text/html` trying to pass as an image — is forced to download instead.
  Both this route and the avatar route also send
  `X-Content-Type-Options: nosniff`, so a browser can't second-guess the
  declared type and render a mislabeled file as something more dangerous.
  `apps/api/test/media-uploads.test.ts` covers both the SVG-avatar
  rejection and the forced-download behavior directly.
- Dual-feed ingestion fetches a URL the creator supplies (`actorUrl`) and,
  in turn, every URL that remote server's own response names (its outbox,
  its page). Both are classic SSRF surface — a malicious or compromised
  target could point either at an internal service (`169.254.169.254`
  cloud metadata, `127.0.0.1`, an internal admin panel). Every fetch inside
  `ActivityPubFeedProvider` — the initial actor fetch, the outbox fetch,
  and any redirect hop (`redirect: "manual"`, re-validated up to 3 hops) —
  is checked first by `assertPublicHttpUrl` (`packages/integrations/src/
  feed/ssrf-guard.ts`): the hostname is resolved via real DNS and every
  returned address is rejected if it's loopback, RFC1918 private,
  link-local, or IPv6 unique-local. `packages/integrations/src/feed/
  ssrf-guard.test.ts` and `apps/api/test/feed-sources.test.ts` cover this
  with both literal-IP cases and a real, *listening* loopback server that
  still gets rejected (proving it's the guard, not just a closed port).

## Payments

- Nothing about price, ownership, or payment success is ever accepted from
  the client. `PaymentService.startProductCheckout` reads the price from
  the database; the frontend only ever displays what the backend returned.
- `Payment.idempotencyKey` and `Purchase.paymentId` are unique at the
  schema level; `applyProviderState` runs inside a transaction that treats
  an already-`CONFIRMED`/`REFUNDED` payment as a no-op — replay-safe by
  construction, not just by convention (spec rule #55).
- Starting checkout (`startProductCheckout`, `startSubscriptionCheckout`)
  is also replay-safe against a *concurrent* request for the same
  user+product/tier: a Postgres session-scoped advisory lock
  (`pg_advisory_xact_lock`, `withScopeLock` in
  `apps/api/src/modules/payments/service.ts`) serializes the
  check-then-act "does a pending checkout already exist" read against
  writes for that exact scope, while unrelated checkouts run in parallel.
  `apps/api/test/checkout-race.test.ts` fires 10 concurrent checkout
  requests for the same user+product and asserts exactly one `Purchase`
  row results — without the lock this is a real race (two clicks, two
  browser tabs, or a client retry could otherwise create two payments for
  one product).
- The `dev-advance` endpoint that lets a client drive the payment state
  machine is explicitly gated to non-production
  (`if (config.isProduction) throw Errors.notFound()`), because in a real
  deployment payment state must only ever be advanced by verified
  chain-observation, never by a client request.
- No private key or seed phrase field exists in the schema (`Wallet` only
  stores `network` + `address`); see DATABASE.md.
- Manual/external payment methods (PayPal, bank transfer, etc.) and
  anonymous donations are explicitly trust-based, never self-serve:
  `POST /payments/:id/confirm` and `/reject` only succeed for the payment's
  *recipient* (`resolveRecipientUserId` resolves the creator via the
  purchase/donation/subscription that owns the payment) — a payer can never
  confirm their own payment. The payer's own `/mark-paid` only sets an
  informational `payerMarkedPaidAt` timestamp and never changes `status`.
- A no-registration donation's `Payment.userId` is `null`; its `payment.id`
  (a UUIDv4) doubles as the anonymous payer's capability token — anyone who
  knows the exact id can `GET /payments/:id` or `mark-paid`, the same
  pattern Stripe's client secrets use. `GET /payments/:id` still enforces
  ordinary ownership whenever `userId` is *not* null.
- Subscription discount codes redeem via an atomic conditional `updateMany`
  (`WHERE redeemedCount < maxRedemptions`) rather than a read-then-write, so
  two concurrent redemptions of a limited code can't both succeed past its
  cap — `apps/api/test/manual-payments-and-discounts.test.ts` covers this
  alongside the per-creator scoping (a code from one creator is rejected on
  another creator's tier).

## Input validation

Every mutating route validates its body with a `zod` schema before
touching the database; validation failures return a 400 with a
user-safe message (`Errors.validation`), never a raw Zod error object.

## Data minimization

- Email is optional (`User.email` nullable) — the product works
  pseudonymously (spec rules #4, #6).
- `Session.ipHash` stores a truncated SHA-256 of the client IP, not the
  raw address.
- Public creator profile only exposes subscriber count / donation
  visibility / purchase counts if the creator explicitly opted in
  (`CreatorProfile.showSubscriberCount` etc., default `false`).

## Error handling

The global Fastify error handler (`apps/api/src/server.ts`) distinguishes
three cases: a typed `AppError` (safe message, forwarded as-is), a Zod/
Fastify validation error (generic "Invalid request"), and everything else
(logged with full detail server-side, generic 500 to the client) — no
stack trace or internal error string ever reaches the browser (spec rule
#99).

## Admin & moderation

- `app.requireAdmin` is a separate check from `requireAuth` — every
  `/admin/*` route re-verifies `role === "ADMIN"` server-side; the frontend
  hiding the nav link is UX only, not the security boundary (spec rule
  #136).
- Every admin/moderation action (suspend/restore a user, disable/enable a
  product, resolve a report, change a federation instance's approval
  status) writes to `AuditLog` via `logAdminAction`
  (`apps/api/src/lib/audit-log.ts`) — never with secrets in `metadata`
  (spec rule #86).
- Suspending a user (`POST /admin/users/:id/suspend`) immediately revokes
  every one of their active `Session` rows and blocks future logins with a
  clear `ACCOUNT_SUSPENDED` error — it doesn't just flip a flag that's
  checked lazily.
- A disabled/suspended product's entire detail response 404s for
  non-owners (not just its content) — the same treatment as an unpublished
  draft, so moderation status isn't inferrable from response shape.
- There is no self-serve "become admin" flow by design; the first admin is
  promoted via a direct database update (`UPDATE "User" SET role='ADMIN'
  WHERE username = '...'`) — documented here rather than built as a route,
  since an HTTP endpoint for granting admin is itself a privilege-escalation
  surface worth not having.

## Not yet implemented (tracked)

- Webhook signature verification (no real payment provider sends webhooks
  yet — the mock provider is driven by an authenticated, owner-checked
  dev-only endpoint instead).
- File upload MIME/size validation and signed-URL delivery (`StorageService`
  doesn't exist yet — see ARCHITECTURE.md).
- CSRF: deliberately not added as a dedicated double-submit token. The
  session cookie is `SameSite=Lax`, which already blocks the cookie from
  being sent on cross-site `POST`/`PATCH`/`DELETE` in every modern
  browser — the primary CSRF vector — so a same-site-only deployment is
  covered today. A dedicated token becomes worth the added complexity
  (and the corresponding `X-CSRF-Token` plumbing through every mutating
  test and the frontend fetch wrapper) once this needs to support
  embedding or cross-site form submission, or support for browsers that
  predate `SameSite` cookie enforcement.
