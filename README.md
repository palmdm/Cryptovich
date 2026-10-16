# Cryptovich

> [!NOTE]
> The project was previously called 4tip, so in preparation for version 1.0 a migration was made to the new name, but in some places the old name still remains. In the invitation codes generated for 4TIP registration, “4TIP” remains at the beginning of the code to make the code type easier to identify and understand.

A donation platform that emphasizes privacy, anonymity, and security, as well as support for social features and federation via the ActivityPub protocol. It serves as a self-hosted alternative to projects like Patreon and Boosty.

> [!NOTE]
> Since the project was originally designed for Russian-speaking users, you may come across some Russian text here and there. The changelog is written exclusively in Russian (but hey, everyone knows how to use a translator, and if something isn't clear, a neural network can help out—that's the world we live in).

## Architecture

Modular monolith, not microservices:

- `apps/web` — Next.js (App Router) frontend
- `apps/api` — Fastify backend, organized as domain modules (`auth`,
  `tokens`, `creators`, `products`, `bundles`, `store`, `payments`,
  `donations`, `subscriptions`, `library`, `connections`, `stickers`,
  `federation`, `analytics`, `reports`, `admin`, `comments`,
  `notifications`, `streams`, `podcasts`, `feed-sources`)
- `apps/worker` — every background job: payment/subscription expiry
  (30s), sticker import processing (5s), federation delivery with retry +
  backoff (10s), dual-feed ingestion (60s)
- `packages/db` — Prisma schema + generated client, shared by api/worker
- `packages/shared` — cross-cutting domain types and the `Money` value type
- `packages/integrations` — external provider interfaces + implementations
  (Telegram/Sharkey stickers, ActivityPub federation with real HTTP
  Signature request signing), shared by api and worker

## Prerequisites


## Getting started

1. Install full Docker and Docker Compose
2. Clone, edit .env file and launch!

```bash
git clone https://github.com/palmdm/Cryptovich && cd Cryptovich
cp .env.example .env
```

And now:

```bash
chmod +x ./scripts/upgrade.sh && ./scripts/upgrade.sh
```

or 

```bash
docker compose up -d --build && docker builder prune -f
```

Visit `http://localhost:3000`, register an account, "Become a creator" from
the dashboard, then publish a free or paid post. Paid posts route through
the mock crypto checkout — see below.

### Becoming the first admin

There's deliberately no self-serve "become admin" route — granting admin
access via an HTTP endpoint is itself a privilege-escalation surface worth
not having. Promote the first admin directly in the database:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE username = 'your-username';
```

They'll see the Admin link in the nav on next load, and every `/admin/*`
route re-checks `role === 'ADMIN'` server-side regardless of what the
frontend shows.

## Mock payment provider

There is no live blockchain integration yet. `MockPaymentProvider`
(`apps/api/src/modules/payments/mock-provider.ts`) implements the same
`PaymentProvider` interface a real BTC/EVM adapter would, and simulates the
full payment state machine: `AWAITING_PAYMENT → DETECTED → CONFIRMING →
CONFIRMED`, plus `FAILED` / `EXPIRED` / `UNDERPAID` / `OVERPAID`. The same
state machine backs product purchases, bundle purchases, donations *and*
subscription checkouts — one `PaymentService`, one idempotency mechanism.

In development, the product page exposes "Simulate: payment detected /
next confirmation / payment failed" buttons that call
`POST /payments/:id/dev-advance` — a dev/test-only endpoint (returns 404 in
production) that drives the same reconciliation path a real chain poller
would use. This lets the entire checkout → purchase → entitlement flow be
exercised without any real crypto.

Swapping in a real chain adapter later means implementing `PaymentProvider`
against a real RPC/indexer and pointing `PAYMENT_PROVIDER` at it —
`PaymentService`, `EntitlementService`, routes and the frontend do not
change.

## Sticker import & federation providers

`packages/integrations` holds real (not just mocked) implementations
alongside their mocks:

- **Telegram** (`TelegramStickerProvider`) — uses the Bot API's
  `getStickerSet`/`getFile`, which need only `TELEGRAM_BOT_TOKEN`, no
  per-creator OAuth.
- **Sharkey** (`SharkeyStickerProvider`) — hits a creator-provided
  instance's public `/api/emojis` endpoint.
- **ActivityPub** (`ActivityPubProvider`) — builds and delivers real,
  HTTP Signature-signed `Create`/`Update`/`Delete` activities. It does not
  yet serve actor/WebFinger documents for this platform's own creators
  (see `docs/FEDERATION.md`), so live interoperability with an unmodified
  Mastodon/Sharkey instance needs that follow-up piece — the signing and
  delivery mechanics themselves are real and tested (including verifying
  a generated signature cryptographically, and delivering to a local fake
  inbox in the worker's integration tests).

## Testing

```bash
pnpm test        # unit tests — Money, TOTP (against the RFC 4226 vector),
                  # mock payment/sticker/federation providers, HTTP Signature
                  # signing — no DB required for these
pnpm typecheck
pnpm lint
pnpm build
```

`apps/api/test/*.test.ts` and `apps/worker/test/*.test.ts` are integration
tests that boot the real app (or call the real worker job function)
against a real Postgres database (via `DATABASE_URL`), including spinning
up a local fake HTTP server to exercise real sticker-import and
federation-delivery network code without touching the real internet. They
require Postgres to be reachable (`docker compose up -d postgres`).

## CI

`.github/workflows/ci.yml` runs install → Prisma migrate → lint →
typecheck → test → build against real Postgres/Redis service containers on
every push/PR — the same commands as above, not a
separate reduced check.

## API documentation & automation

- Interactive, hand-written OpenAPI 3.0 docs are served at `GET /docs`
  (Swagger UI) once the API is running — browsable and directly callable,
  covering the creator-automation and admin surface in particular. The
  fuller prose reference is `docs/API.md`.
- Personal access tokens (`POST /tokens`, prefixed `pat_`) let a creator's
  own script authenticate with `Authorization: Bearer <token>` instead of
  a browser session — spec: "a mini-API for the convenience of
  automation for the author." Managed from `/dashboard/tokens` or
  directly against the API.

## Production deployment

`docker-compose.yml` builds `apps/api`, `apps/worker` and `apps/web` as
separate images alongside Postgres and Redis, with a named volume for
uploaded files (`UPLOAD_DIR`, mounted at `/data/uploads` in the `api`
container so it survives a recreate). The Dockerfiles are functional but
not yet layer-cache-optimized (no lockfile is committed yet, so
`pnpm install` always resolves fresh) — tightening that, plus production
observability beyond the `/health` DB+Redis check, remains open.

See `docs/DEPLOYMENT.md` for the full deploy walkthrough, environment
variable guidance, and the backup/restore scripts
(`scripts/backup.sh`/`scripts/restore.sh`) — a single timestamped archive
(database + uploads) that's also how you relocate or clone the whole
platform onto a different server.

## Environment variables

See `.env.example`. Every external integration (payments, federation,
sticker import providers, object storage) is read through an env var and an
abstraction interface — nothing in business logic imports a vendor SDK
directly.
