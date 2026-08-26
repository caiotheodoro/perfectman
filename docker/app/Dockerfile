# Multi-stage build of the Perfectman runtime.
#
# Stage 1 (build) reproduces the CI gate order on the same base image:
# pnpm install --frozen-lockfile -> pnpm -r build.
# Stage 2 (runtime) installs only the production dependency graph of
# @perfectman/server (plus its workspace dependencies) and copies the compiled
# dist trees, so no source, dev dependencies, or build toolchain ship in the
# final image. The entrypoint is the same CLI that
# `pnpm --filter @perfectman/server simulation` runs locally; config discovery
# (config/index.json, .env) walks up from the working directory exactly as in
# a native checkout.

FROM node:22-bookworm AS build

WORKDIR /work

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/eval/package.json packages/eval/

RUN pnpm install --frozen-lockfile

COPY . .

# Composite tsc projects treat a pre-existing valid tsconfig.tsbuildinfo as
# "already built" and skip emitting dist entirely, which breaks cross-package
# resolution. Drop any build state riding along in the context.
RUN rm -rf packages/*/dist packages/*/*.tsbuildinfo

RUN pnpm -r build

FROM node:22-bookworm AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /work/package.json /work/pnpm-lock.yaml /work/pnpm-workspace.yaml ./
COPY --from=build /work/packages/shared/package.json packages/shared/
COPY --from=build /work/packages/engine/package.json packages/engine/
COPY --from=build /work/packages/server/package.json packages/server/
COPY --from=build /work/packages/eval/package.json packages/eval/

RUN npm install -g pnpm@10 \
  && pnpm install --frozen-lockfile --prod --filter "@perfectman/server..."

COPY --from=build /work/packages/shared/dist packages/shared/dist
COPY --from=build /work/packages/engine/dist packages/engine/dist
COPY --from=build /work/packages/server/dist packages/server/dist

ENTRYPOINT ["node", "packages/server/dist/cli/run-simulation.js"]
