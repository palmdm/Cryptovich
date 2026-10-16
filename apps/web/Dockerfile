FROM node:20-alpine AS base
WORKDIR /repo
# Nothing in a build or a run reports to a third party: Next's and
# Prisma's telemetry and update checks are off.
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
# The browser calls /api on the site's own origin and the web server
# forwards it here. Next fixes rewrite targets at build time, so this has
# to be set for the build, not only at runtime.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
# Empty: in a deployment /status is the gate's (deploy/gate), not this server's.
ARG STATUS_INTERNAL_URL=
ENV STATUS_INTERNAL_URL=$STATUS_INTERNAL_URL
RUN pnpm --filter @platform/web build

FROM node:20-alpine
WORKDIR /repo/apps/web
# Nothing in a build or a run reports to a third party: Next's and
# Prisma's telemetry and update checks are off.
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --from=base /repo /repo
# The version and the release notes (see CHANGELOG.md), and the usage
# policy (policy.md) if the operator has written one — `policy.m[d]` is a
# pattern so a missing file is skipped rather than failing the build.
# Copied late so that editing either rebuilds only this layer, never the
# dependency install.
COPY CHANGELOG.md policy.m[d] /repo/
ARG API_INTERNAL_URL=http://api:4000
ENV NODE_ENV=production
# Also at runtime, not only for the build: the profile page asks the API
# server-side whether an author is federated, to advertise their actor.
ENV API_INTERNAL_URL=$API_INTERNAL_URL
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
