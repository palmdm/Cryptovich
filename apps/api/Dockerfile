FROM node:20-alpine AS base
WORKDIR /repo
# Nothing in a build or a run reports to a third party: Next's and
# Prisma's telemetry and update checks are off.
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
# Alpine's node image has no `openssl` CLI at all — only the raw
# libssl.so.3 shared library. Prisma's own OpenSSL-version probe shells
# out to that CLI, so without it here it can't tell it's talking to
# OpenSSL 3.x and silently defaults its query-engine binary to an
# OpenSSL 1.1.x build, which then fails to load (`libssl.so.1.1: No such
# file or directory`) since Alpine doesn't have that version at all.
RUN apk add --no-cache openssl
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @platform/db generate
RUN pnpm --filter @platform/api build

FROM node:20-alpine
WORKDIR /repo
# Nothing in a build or a run reports to a third party: Next's and
# Prisma's telemetry and update checks are off.
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
RUN apk add --no-cache openssl
RUN corepack enable
COPY --from=base /repo /repo
# The version and the release notes (see CHANGELOG.md). Copied late so that
# editing it rebuilds only this layer, never the dependency install.
COPY CHANGELOG.md /repo/CHANGELOG.md
ENV NODE_ENV=production
EXPOSE 4000
# Migrations run here rather than in a separate deploy step so the
# schema can never lag the code that assumes it.
COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
CMD ["/usr/local/bin/entrypoint.sh"]
