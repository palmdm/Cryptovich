# Database

PostgreSQL via Prisma. Full source of truth: `packages/db/prisma/schema.prisma`.
This document explains the design decisions, not every column.

## Identity is pseudonymous and separated from payment/wallet data

- `User.id`, `CreatorProfile.id` are UUIDv4 — non-enumerable, not derived
  from username or email.
- `User.username` is unique but is not the primary key.
- `email` and `passwordHash` are nullable — email is not mandatory for the
  account to function (spec rule #6).
- `Wallet` holds only `network` + `address` (+ optional label). No seed
  phrase or private key column exists anywhere in this schema, and none
  should ever be added (spec rules #51, #148) — custodial key material, if
  ever needed, belongs in a KMS/HSM, not Postgres.
- `Session` stores a SHA-256 hash of the session token, never the raw
  token, plus a hashed IP (`ipHash`) rather than the raw client IP —
  minimizing retained PII per spec rule #4.

## Separation of concerns across tables

| Concern | Table(s) | Deliberately NOT merged into |
|---|---|---|
| Identity/auth | `User`, `Session` | — |
| Public creator identity | `CreatorProfile` | `User` |
| Wallets | `Wallet` | `User`, `Payment` |
| Marketplace item | `DigitalProduct` + type table (`Post`/`StickerPack`/`DigitalFile`) | `Payment`, `Purchase` |
| Pricing | `ProductPrice` | `DigitalProduct` (a product can have multiple price rows over time; only one `active`) |
| Bundle composition | `ProductItem` (generic `product → itemProduct` edge) | a `BundlePost`-style hardcoded join table |
| Purchase record | `Purchase` | `Payment` (a purchase references a payment, it isn't one) |
| Payment/money movement | `Payment`, `BlockchainTransaction` | `Purchase`, `DigitalProduct` |
| Access grant | `Entitlement` | everything else — this is the *only* table anything should query to decide access |

## Constraints that carry real weight

- `DigitalProduct` unique on `(creatorId, slug)` — stable, human-readable
  per-creator URLs without a global slug namespace.
- `ProductItem` unique on `(productId, itemProductId)` — a product can't be
  added to the same bundle twice.
- `Entitlement` unique on `(userId, productId, sourceType, sourceId)` — the
  same purchase/subscription/grant can be replayed (webhook retries,
  reconciliation re-runs) and `upsert` into this key without creating
  duplicate access rows.
- `Payment.idempotencyKey` unique, `Purchase.paymentId` unique,
  `Donation.paymentId` unique, `BlockchainTransaction.txHash` unique — the
  schema itself, not just application code, prevents one payment or one
  on-chain transaction from producing two purchases (spec rule #55).
- Soft delete (`deletedAt`) on `User` and `DigitalProduct` — moderation and
  account deletion don't hard-delete rows that financial/audit records
  point to.
- Every mutable table has `createdAt`; tables with a meaningful edit
  lifecycle also have `updatedAt` (`@updatedAt`).

## Money representation

Every amount column is `BigInt` (`amountMinor`) alongside a `currency`
string — never a float. See `packages/shared/src/money.ts` for the
arithmetic wrapper. Fastify's JSON serialization gets a global
`BigInt.prototype.toJSON` shim (`apps/api/src/server.ts`) so these values
cross the wire as decimal strings, never silently truncated doubles.

## Migrations

`pnpm db:migrate` (wraps `prisma migrate dev`) is the only supported way to
evolve the schema in development. `prisma migrate deploy` is what
production/CI should run — it applies committed migrations without
prompting or generating new ones.
