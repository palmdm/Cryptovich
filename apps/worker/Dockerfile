FROM node:20-alpine AS base
WORKDIR /repo
# Nothing in a build or a run reports to a third party: Next's and
# Prisma's telemetry and update checks are off.
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
# See apps/api/Dockerfile for why this is required — Prisma's OpenSSL
# probe needs the `openssl` CLI, which Alpine's node image doesn't ship.
RUN apk add --no-cache openssl
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @platform/db generate
RUN pnpm --filter @platform/worker build

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
CMD ["node", "apps/worker/dist/index.js"]
