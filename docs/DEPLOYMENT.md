# Deployment

This has been run end-to-end for real — `docker compose up -d --build`,
migrations, registering a user, creating a post, loading the web app —
not just written and assumed to work. The gotchas below (env loading,
lockfile, OpenSSL) were all real failures hit and fixed while verifying
this document, not speculative advice.

## Prerequisites

- Docker + Docker Compose v2 (`docker compose version`)
- For host-side commands (`pnpm db:migrate`, running tests, etc.):
  Node.js 20+ and pnpm (`corepack enable`)

## First-time setup

```bash
git clone <repo> && cd <repo>
cp .env.example .env        # fill in real values before a production deploy
docker compose up -d --build
```

This builds and starts five services (`docker-compose.yml`):

| Service | What | Port |
|---|---|---|
| `postgres` | Postgres 16, data in the `pgdata` named volume | 5433→5432 (host offset to avoid colliding with a local install) |
| `redis` | Redis 7 | 6380→6379 |
| `api` | Fastify backend | 4000 |
| `worker` | Background jobs (payment/subscription expiry, sticker import, federation delivery, feed ingestion) — no exposed port | — |
| `web` | Next.js frontend | 3000 |

`api`'s uploaded files (post attachments, avatars) live in the `uploads`
named volume, mounted at `/data/uploads` — set explicitly via `UPLOAD_DIR`
in `docker-compose.yml` rather than left to whatever the container's
working directory happens to be, so it survives a `docker compose up`
recreate.

The build can take a few minutes the first time (three separate images,
each running a full `pnpm install` + TypeScript build). Watch it with
`docker compose up -d --build && docker compose logs -f`.

### Run database migrations

Once `postgres` is healthy (`docker compose ps` shows it healthy within a
few seconds):

```bash
docker compose exec api sh -c "cd packages/db && npx prisma migrate deploy"
```

Use `migrate deploy`, not `migrate dev` — `migrate dev` is an interactive
command (it can prompt for a migration name) and refuses to run at all in
a non-interactive context like a container exec or a CI job. `migrate
deploy` just applies whatever committed migrations aren't applied yet and
exits; that's also what `.github/workflows/ci.yml` uses.

### Verify it's actually up

```bash
curl http://localhost:4000/health   # {"ok":true,"database":true,"redis":true}
curl -I http://localhost:3000       # 200
curl -I http://localhost:4000/docs  # 200 — interactive API docs (Swagger UI)
```

Then open `http://localhost:3000`, register an account, "Become a
creator" from the dashboard, and publish a post.

### Becoming the first admin

There's deliberately no self-serve "become admin" route. Promote directly
in the database:

```bash
docker compose exec postgres psql -U postgres -d platform \
  -c "UPDATE \"User\" SET role = 'ADMIN' WHERE username = 'your-username';"
```

## Environment variables

See `.env.example` for the full annotated list. The ones that matter most
for a real (non-`localhost`) deploy specifically:

- `WEB_ORIGIN` / `NEXT_PUBLIC_API_URL` / `API_PUBLIC_URL` — get these
  right or cookies, CORS and federation URLs all break in
  subtly different ways. `WEB_ORIGIN` and `API_PUBLIC_URL` should be the
  real externally-reachable origins, not `localhost`.
- `UPLOAD_DIR` / `MAX_UPLOAD_BYTES` — file upload storage location/limit.
- `PAYMENT_PROVIDER` / `FEDERATION_PROVIDER` — swap from `mock`/`activitypub`
  defaults once real credentials exist; both are provider-interface
  abstractions, so nothing else changes.

### Running `pnpm db:*` commands from the host

`packages/db/.env` is a **symlink to the repo-root `.env`**
(`packages/db/.env -> ../../.env`). This exists because Prisma's CLI only
auto-loads a `.env` file that sits in the same directory as
`schema.prisma`'s package (or the current working directory) — it never
walks up to a parent directory. Without the symlink, `pnpm db:migrate`
(which runs from `packages/db`) fails with:

```
Error: Environment variable not found: DATABASE_URL.
```

The symlink means `cp .env.example .env` at the repo root is still the
only setup step — `packages/db` picks it up automatically. This is a real
file, tracked in git (a symlink is just a small blob pointing at a
relative path); it stays a dangling link until you actually create the
root `.env`.

## Troubleshooting

**`pnpm db:migrate` (or any Prisma command) says `DATABASE_URL` not
found.** Confirm `.env` exists at the repo root and that
`packages/db/.env` is still the symlink described above (`ls -la
packages/db/.env` should show `-> ../../.env`).

**`prisma migrate dev` says "the environment is non-interactive."** You're
running it somewhere without a real TTY (a script, a container exec, this
kind of automation). Use `prisma migrate deploy` instead — see above.

**Docker build fails on `pnpm install`/`apk add` with `ECONNREFUSED` to a
`127.0.0.1:PORT` (or similar loopback) address, but the same command
works fine outside Docker.** You're behind a proxy
(`http_proxy`/`https_proxy` pointing at a loopback address — common in
corporate networks and sandboxed dev environments), and Docker's build
network doesn't automatically share it. Two layers, check both:

1. Every service's `build:` in `docker-compose.yml` sets `network: host`,
   so build-time `RUN` steps share the host's network namespace instead
   of an isolated one where `127.0.0.1` means the build container itself.
2. Docker separately auto-injects proxy settings from
   `~/.docker/config.json`'s `proxies` section into every build as
   implicit `HTTP_PROXY`/`HTTPS_PROXY` build args — and that file can
   easily go stale or be wrong independent of your actual shell's
   `http_proxy`/`https_proxy`. If the build fails reaching a *different*
   address than your shell's proxy, this file is very likely why: `cat
   ~/.docker/config.json` and compare its `httpProxy`/`httpsProxy` against
   what actually works from your shell, and correct it if they differ.

**Docker build fails on `pnpm install` with a corepack/registry error
(but network access itself is fine).** Two independent things have to
line up: `package.json`'s
`"packageManager"` field pins an exact pnpm version, and that version has
to support the Node version the Dockerfiles use (`node:20-alpine`, i.e.
Node 20). pnpm's own newest major versions have started requiring Node
≥22.13 — if `packageManager` ever gets bumped to one of those without
also bumping the Dockerfiles/CI off Node 20, every Docker build (and CI
run) breaks the same way. Keep them in lockstep, or bump `node:20-alpine`
→ `node:22-alpine` (and the CI `node-version`, and `engines.node`) at the
same time as a newer pnpm.

**Docker build fails with `tsc` unable to find `tsconfig.base.json`.**
Every `apps/*/tsconfig.json` extends the repo-root `tsconfig.base.json`.
If a Dockerfile's `COPY` step doesn't include it, the TypeScript build
fails inside the container even though it works fine on the host (where
the whole repo is already checked out). All three Dockerfiles copy it
explicitly now; if you add a fourth app, don't forget it.

**Docker build resolves different dependency versions than what's
tested/committed.** The lockfile (`pnpm-lock.yaml`) has to actually be
`COPY`'d into the build context *and* installed with `--frozen-lockfile`
— otherwise `pnpm install` inside the container re-resolves semver
ranges fresh, which can silently pull in a newer transitive dependency
than the one every test/typecheck run on the host actually verified
against. This bit us for real once: a Docker-only build picked up a
different `zod` minor version whose type inference was subtly different,
producing a `tsc` error that never appeared on the host. All three
Dockerfiles and CI now use `--frozen-lockfile`.

**`api`/`worker` container starts, logs `Server listening...`, then
immediately crashes with `PrismaClientInitializationError: ... Error
loading shared library libssl.so.1.1: No such file or directory`.** This
is a known Prisma-on-Alpine issue with two layers, both fixed here:

1. Alpine's `node:20-alpine` ships OpenSSL 3.x (`libssl.so.3`) but no
   `openssl` CLI binary. Prisma's runtime probe for "which OpenSSL am I
   on" shells out to that CLI; without it, probing fails and Prisma
   silently assumes OpenSSL 1.1.x — which Alpine doesn't have at all.
   Fixed by `RUN apk add --no-cache openssl` in both stages of the `api`
   and `worker` Dockerfiles.
2. Even with the CLI installed, `generator client` in
   `packages/db/prisma/schema.prisma` explicitly lists `binaryTargets =
   ["native", "linux-musl-openssl-3.0.x"]` so `prisma generate` produces
   the correct engine binary for Alpine regardless of auto-detection.

If you ever move off `node:*-alpine` to a Debian/Ubuntu-based image, this
whole section stops mattering — the OpenSSL detection issue is
Alpine/musl-specific.

## Going to production

Everything above works on a laptop. A public server needs four more
things, and the first is not optional.

### 1. Terminate TLS in front of it — the app now requires HTTPS

`NODE_ENV=production` is pinned by `docker-compose.yml` for the `api`,
`worker` and `web` containers (it deliberately overrides `.env`, which
only governs host-side `pnpm dev`). In production the session cookie is
issued with the `Secure` flag, which means **a browser will refuse to
store it over plain HTTP** and nobody will be able to stay signed in.
That is the intended behaviour: the alternative is a session cookie
travelling in clear text.

So put a TLS-terminating reverse proxy in front and forward two
hostnames — one to the web container, one to the API. With Caddy that is
the whole configuration:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3000
}

api.example.com {
    reverse_proxy 127.0.0.1:4000
}
```

nginx works equally well; the only requirement is that it forwards
`X-Forwarded-For` and `X-Forwarded-Proto` (Fastify is started with
`trustProxy: true`, so it reads them). Then set the public origins in
`.env` so CORS and federation URLs agree:

```bash
WEB_ORIGIN=https://app.example.com
NEXT_PUBLIC_API_URL=https://api.example.com
API_PUBLIC_URL=https://api.example.com
```

`API_PUBLIC_URL` is also the domain your authors' fediverse handles are
built from, so changing it later breaks every actor URI already
published. Decide it before anyone federates.

### 2. Set the secrets

```bash
openssl rand -base64 24        # POSTGRES_PASSWORD
```

`POSTGRES_PASSWORD` is required — compose refuses to start without it
rather than falling back to something guessable, and the same value has
to appear in `DATABASE_URL` for host-side tooling.

Rotating it on an **existing** database needs both halves, because
Postgres only reads `POSTGRES_PASSWORD` when it first initialises its
data directory:

```bash
docker compose exec -T postgres psql -U postgres -d platform \
  -c "ALTER USER postgres WITH PASSWORD 'new-password'"
# then update POSTGRES_PASSWORD and DATABASE_URL in .env
docker compose up -d
```

Also decide `REGISTRATION_MODE`. It ships as `invite`, which is what you
want for a public server; `open` lets anyone register. It is the starting
value only: the administrator can flip it at any time under Admin ->
Settings -> Registration, and that stored choice then wins over `.env`
(to hand the decision back to `.env`, delete the `registrationMode` row
from `ServerSetting`). In `open` mode a code typed at sign-up is still
honoured and shows as the account's inviter.
Every member can create their own invite codes under Settings ->
Invitations (at most 10 live codes each, 10 uses and 90 days per code).

### 3. Migrations apply themselves

The `api` container runs `prisma migrate deploy` before starting
(`apps/api/docker-entrypoint.sh`), so a deploy carrying a schema change
cannot leave the API running against an older database. A deploy is just:

```bash
git pull && docker compose up -d --build
```

Every service is `restart: unless-stopped`, and `api`/`web` have
healthchecks, so a crash or a host reboot brings them back.

Migrations run forward only. There is no automatic rollback — take a
backup before deploying a migration you are unsure of (see **Backup**).

### 4. Schedule the backup

`scripts/backup.sh` writes a dump plus the uploads volume; nothing runs
it for you. A daily cron entry:

```cron
0 3 * * * cd /srv/cryptovich && ./scripts/backup.sh /var/backups/cryptovich >> /var/log/cryptovich-backup.log 2>&1
```

Verify a restore at least once before you need one — see **Restore**.

## What this platform deliberately does not do

Read this before promising any of it to your users.

- **Email is optional, and without it there is no password reset.** Set
  `SMTP_URL` (one URL is the whole configuration) and both password reset
  and address verification work. Leave it unset and both refuse with a
  clear message rather than silently losing the mail — but then an
  account locked out by a lost password is recovered only by someone with
  shell access, via `./scripts/manage-users.sh set-password`. A lost 2FA
  device always needs `disable-2fa`: there is deliberately no emailed
  bypass for a second factor.
- **The platform never holds money.** Payments settle when the recipient
  confirms receipt out-of-band — there is no payment processor, no
  escrow, no chain watching and no automatic settlement. `mark-paid` is
  informational; only the author's confirmation grants access.
- **Uploads are local disk unless you point them at a bucket.** By
  default `UPLOAD_DIR` is a named volume, so it is part of your backup
  and does not survive losing the host on its own. Setting `S3_BUCKET`
  (plus endpoint and credentials) moves them to any S3-compatible store.
  Downloads still stream through the API either way — keep the bucket
  private, since a public or presigned URL would put file access outside
  the platform's own entitlement checks.
- **Federation reaches only what you allow.** Delivery, HTTP signatures,
  actor and WebFinger documents are all real, but outbound traffic scales
  with followers — `FEDERATION_MODE=allowlist` is how you bound it.
- **Horizontal scaling is partial.** Running several `worker` instances
  is safe — each job takes a database lease first, so the others skip a
  tick already being handled instead of repeating it. Several `api`
  instances would additionally need a shared `UPLOAD_DIR`, since uploads
  are local disk; nothing else in the API keeps local state.

## Day-2 operations

```bash
docker compose logs -f api        # tail one service's logs
docker compose restart api        # restart one service
docker compose up -d --build api  # rebuild + redeploy just one service
docker compose down                # stop everything (data volumes persist)
```

## Backup

```bash
./scripts/backup.sh                 # writes ./backups/backup-<timestamp>.tar.gz
./scripts/backup.sh /path/elsewhere  # or a different output directory
```

One archive containing a full `pg_dump` of the database (`--clean
--if-exists`, so it's self-contained and safe to restore into an empty
database) plus a tarball of every uploaded file. Requires the stack to
already be running (`docker compose up -d`).

Run this on a schedule (cron, systemd timer) and ship the resulting
archive off-box — a backup that only ever lives on the same disk as the
database it backs up protects against approximately nothing.

## Restore / quick relocation to a new server

This is the "quick relocation/cloning ... in case of any situations"
capability — moving the whole platform (data included) to a different
machine, or standing up a clone for testing:

1. **On the old/source server:**
   ```bash
   ./scripts/backup.sh
   ```
2. **Copy the archive to the new server** (`scp`, `rsync`, whatever
   transport you have):
   ```bash
   scp backups/backup-<timestamp>.tar.gz newserver:/path/to/repo/backups/
   ```
3. **On the new server:** clone the repo, `cp .env.example .env` and fill
   it in (pointing `WEB_ORIGIN`/`API_PUBLIC_URL` at the new server's real
   address), then bring up just the data layer:
   ```bash
   docker compose up -d postgres redis
   ```
4. **Restore:**
   ```bash
   ./scripts/restore.sh backups/backup-<timestamp>.tar.gz
   ```
5. **Bring the rest of the stack online:**
   ```bash
   docker compose up -d --build
   ```

`restore.sh` drops and recreates every database object the dump touches
(via `pg_dump --clean --if-exists`) and replaces the entire contents of
the uploads volume — it's meant to run against a fresh target, not merge
into one with existing data.

Both scripts were verified against a real (throwaway) Postgres container
and Docker volume during development — seed data, corrupt it, restore,
confirm the original data comes back byte-for-byte — not just written and
assumed to work.
