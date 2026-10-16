#!/bin/sh
set -e

# Schema first, then the server. Without this a deploy carrying a
# migration starts an API whose Prisma client expects columns the
# database does not have yet — the failure surfaces as scattered 500s at
# runtime rather than as a failed deploy.
#
# `migrate deploy` only applies migrations that already exist; it never
# generates one and never prompts, which is what makes it safe to run
# unattended on every start. Applying an already-applied migration is a
# no-op, so repeated restarts are harmless.
#
# The Prisma binary is invoked directly rather than through `pnpm`: pnpm
# is provisioned by corepack, which downloads it on first use. A server
# with no outbound internet — a perfectly reasonable way to run this —
# would then crash-loop here instead of starting.
echo "Applying database migrations..."
./packages/db/node_modules/.bin/prisma migrate deploy --schema packages/db/prisma/schema.prisma

# Images uploaded before uploads were optimised are still stored as sent —
# which is how a 2.1MB avatar ended up past Mastodon's 2MB limit and never
# showed on another server. Rewritten once, here, so an upgrade fixes them
# without anyone having to know the script exists. Already-optimised files
# are skipped, so after the first run this is a single query. A failure
# must never stop the API starting.
if [ "${REPROCESS_IMAGES_ON_START:-true}" != "false" ]; then
  node apps/api/dist/scripts/reprocess-images.js --legacy-only || echo "Image reprocessing skipped: it failed, the API starts anyway."
fi

echo "Starting API..."
exec node apps/api/dist/server.js
