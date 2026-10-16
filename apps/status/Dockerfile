FROM node:20-alpine AS base
WORKDIR /repo
# Nothing in a build or a run reports to a third party: Next's and
# Prisma's telemetry and update checks are off.
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/status ./apps/status
RUN pnpm install --frozen-lockfile --filter @platform/status...
RUN pnpm --filter @platform/status build

FROM node:20-alpine
WORKDIR /repo
# Nothing in a build or a run reports to a third party: Next's and
# Prisma's telemetry and update checks are off.
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --from=base /repo /repo
# The version (see CHANGELOG.md), for the error reports' release. Copied
# late so that editing it rebuilds only this layer.
COPY CHANGELOG.md /repo/CHANGELOG.md
ENV NODE_ENV=production
ENV STATUS_DATA_DIR=/data
EXPOSE 3005
CMD ["node", "apps/status/dist/index.js"]
