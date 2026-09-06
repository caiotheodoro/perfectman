# The run server, for a host that lets a process stay alive.
#
# Not a serverless target: a run is minutes of awaited work that continues after
# the request that started it returns, the controller keeps its state and SSE
# backlog in memory, and the stream is a separate request that has to reach the
# same process. Cloud Run with one instance and CPU always allocated satisfies
# all three; a function does not.
#
# Debian rather than Alpine because better-sqlite3 ships prebuilt binaries for
# glibc and would otherwise be compiled from source on every build.
FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Pinned to what the repo installs with. Corepack otherwise fetches the newest
# pnpm, which refuses a lockfile whose build-script approvals it does not share.
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# Manifests first, so a dependency layer survives a source-only change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/eval/package.json packages/eval/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY . .
# In order, and only what serves a run: the web bundle is deployed separately
# and the eval CLI has no part here. Sequential because a filter list is not a
# topological sort, and server needs shared's declarations on disk first.
RUN pnpm --filter @perfectman/shared build \
    && pnpm --filter @perfectman/engine build \
    && pnpm --filter @perfectman/server build

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
RUN pnpm install --frozen-lockfile --prod \
      --filter @perfectman/shared --filter @perfectman/engine --filter @perfectman/server \
    && pnpm store prune

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/server/dist packages/server/dist
# Presets are read off disk at request time, not bundled.
COPY --from=build /app/examples/presets examples/presets

# Artifacts are ephemeral here: the container's filesystem does not outlive it,
# and a run's replay is downloadable while the instance is up.
ENV PERFECTMAN_RUNS_DIR=/tmp/runs
ENV PERFECTMAN_PRESETS_DIR=/app/examples/presets
EXPOSE 8080

CMD ["node", "packages/server/dist/http/bootstrap.js"]
