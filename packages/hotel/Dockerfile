# The Tilehouse sidecar (docs/plans/hotel-package.md 16).
#
# Build from the repository root:
#   docker build -f packages/hotel/Dockerfile -t perfectman-hotel .
#
# One Node process that dials out to the hotel's Director listener and serves
# the authoring listener (PERFECTMAN_AUTHORING_BIND, default 127.0.0.1:9101,
# 0.0.0.0:9101 in the compose snippet) on the compose network. No port is
# published and none is EXPOSEd. The root Dockerfile and fly.toml are unchanged.
#
# Debian rather than Alpine for the same reason as the root image: the
# workspace installs native modules that ship glibc prebuilds.
FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# Manifests first, so a dependency layer survives a source-only change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/hotel/package.json packages/hotel/
COPY packages/eval/package.json packages/eval/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY . .
# In order, and only what a hotel run needs: a filter list is not a topological sort.
RUN pnpm --filter @perfectman/shared build \
    && pnpm --filter @perfectman/engine build \
    && pnpm --filter @perfectman/server build \
    && pnpm --filter @perfectman/hotel build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/engine/package.json packages/engine/
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/hotel/package.json packages/hotel/
RUN pnpm install --frozen-lockfile --prod \
      --filter @perfectman/shared --filter @perfectman/engine --filter @perfectman/server --filter @perfectman/hotel \
    && pnpm store prune

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/hotel/dist packages/hotel/dist
# Read at runtime: its SHA-256 goes in hello_ack so the hotel can warn on schema drift.
COPY --from=build /app/packages/hotel/schema packages/hotel/schema
# Starter scenarios for the authoring `presets` routes.
COPY --from=build /app/examples/presets examples/presets

# Run artifacts go to a volume shared with the hotel container (same uid or a
# group-writable directory; see deploy/compose.sidecar.yaml).
ENV PERFECTMAN_DATA_DIR=/data/perfectman
ENV PERFECTMAN_PRESETS_DIR=/app/examples/presets
RUN mkdir -p /data/perfectman && chown -R node:node /data/perfectman
USER node

STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PERFECTMAN_HEALTH_PORT||9100)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/hotel/dist/main.js"]
