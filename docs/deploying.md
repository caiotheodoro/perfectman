# Deploying

Three pieces, each deployed by hand. Nothing deploys on push to `main`: the only
workflows are `pr-gate.yml`, `benchmark.yml` and `docker-release.yml` (publishes an
image to GHCR on `v*` tags, and does not touch Fly or the Habbo server).

| Piece | Where | How |
|---|---|---|
| Run server | Fly.io app `perfectman-server`, region `iad`, one machine | `fly deploy` |
| Web interface | Vercel | see [The interface](#the-interface-on-vercel) |
| Hotel sidecar | Habbo server, one container | rsync, then build there |

## Why the run server is not serverless

A run is minutes of awaited work that keeps going after the request that started
it returns. The controller holds its state and SSE backlog in process memory, and
the stream is a separate request that has to reach that same process. A function
gets none of those. So the server wants one long-lived machine, and exactly one:
a second machine would answer `/stream` for a run it has never heard of.

## The run server, on Fly.io

`fly.toml` at the repo root builds the root `Dockerfile` as one `shared-cpu-2x`
machine with 2gb in `iad`. It stops when no connection is open and starts on the
next request (`auto_stop_machines = "stop"`, `min_machines_running = 0`), so a
`stopped` machine in `fly status` is normal. A run holds its stream open, so it is
not stopped while someone watches.

Deploy from a clean checkout of `main`:

```bash
git switch main && git pull --ff-only && git status   # must be clean
fly deploy -a perfectman-server --strategy rolling
```

Then check:

| Request | Expect |
|---|---|
| `GET /api/health` | 200 |
| `GET /api/presets` | 200 |
| `GET /` | 404, on purpose: the image has no built UI, so the server has nothing to serve there |

Notes:

- The container listens on `PORT` (`fly.toml` sets `8080`, matching `internal_port`).
  `PERFECTMAN_WEB_PORT` wins over it if both are set.
- `PERFECTMAN_RUNS_DIR=/tmp/runs`: artifacts do not outlive the machine.
- Presets are read from disk in the image, so adding a preset needs a server redeploy.
- The Fly health check is `GET /api/runs/current` every 30s.
- Keep it at one machine: `fly scale count 1`.
- Read-only inspection: `fly status -a perfectman-server`, `fly releases -a perfectman-server`, `fly logs -a perfectman-server`.

### On the CPU size

One vCPU looks like plenty for a service that waits on a model, and it is not.
Measured on the same scene, model and key (on a 1 vCPU host before the move to Fly):

| Where | One pulse |
|---|---|
| 1 vCPU | 483s |
| Laptop | 80s |
| 4 vCPU | 61s |

A pulse builds a prompt per agent, opens three TLS connections and parses three
large JSON replies: CPU on a single-threaded runtime. A `mock` run hides it. The
failure does not look like slowness: `stop` cannot interrupt a pulse in flight, so
a starved machine sits in `stopping` for minutes and reads as a hang.

`shared-cpu-2x` is what the Fly org was limited to when this was set up (see the
comment in `fly.toml`). Measure a real run and move to a `performance` size once
that is possible.

## The interface, on Vercel

The root `vercel.json` is what a Git-connected Vercel project reads:

- `buildCommand`: builds `@perfectman/web`, then copies `packages/web/dist` to a
  top-level `dist`, which is the `outputDirectory`.
- `build.env.VITE_API_BASE` is `https://perfectman-server.fly.dev`, so the built
  bundle calls the Fly server. Unset, requests are relative, which is what the
  local `pnpm web` path wants.
- Rewrites send everything except `api/`, `assets/`, `audio/` and `favicon*` to
  `/index.html` (single-page app); `/assets/*` is cached for a year, immutable.

A manual deploy is also possible:

```bash
cd packages/web
VITE_API_BASE=https://perfectman-server.fly.dev pnpm build
npx vercel deploy --prebuilt --prod
```

`--prebuilt` because Vercel's own install cannot resolve `@perfectman/shared` from
a pnpm workspace. The `.vercel/` directory is gitignored.

Not verifiable from the repo: which of the two paths the live project uses, whether
Git integration is on, the production branch, and the project's dashboard settings.
Check the Vercel project before relying on a push to deploy the interface.

## The Habbo hotel sidecar

`packages/hotel` is a second container, built from `packages/hotel/Dockerfile`
(repo-root context), that dials the hotel's Director listener. It publishes no port.
It runs on the Habbo server next to the hotel, wired by the habbo repo's compose
files (`packages/hotel/deploy/compose.sidecar.yaml` here is only the snippet shape).

It is built on the Habbo server from `/opt/cmb/perfectman`. The habbo repo's
`deploy/deploy.sh` does not update that tree, so push it first, from a clean
checkout of `main`:

```bash
EXCLUDES=(--exclude node_modules --exclude .git --exclude dist --exclude out \
  --exclude tmp --exclude .worktrees --exclude .env --exclude .deployed-sha \
  --exclude packages/kb/corpus --exclude packages/kb/index)

# dry run first; read the file list before going on
rsync -az --delete --checksum -n -i "${EXCLUDES[@]}" ./ <habbo-server>:/opt/cmb/perfectman/

rsync -az --delete --checksum "${EXCLUDES[@]}" ./ <habbo-server>:/opt/cmb/perfectman/
ssh <habbo-server> "echo $(git rev-parse HEAD) > /opt/cmb/perfectman/.deployed-sha"
```

Then build and restart the sidecar the way the habbo repo's deploy docs say. Host
address, user and key are in those docs, not here.

`.deployed-sha` is excluded from the sync so `--delete` does not remove it; it
records which commit the tree on the server came from.
Check it before deploying habbo, since `deploy.sh` will build whatever tree is there.

### Optional: the reference-scenes file (slim KB)

Scene writing can read a small file of reference scenes (`packages/kb/README.md`,
"Slim artifact"): the draft prompt gets two or three, and an authored beat's actor
gets two short style lines while the beat is near. It is optional. With
`PERFECTMAN_KB_SLIM` unset, or pointing at a file that is missing or not a slim
file, the sidecar builds exactly the prompts it always did (a bad file is logged
once, `the reference KB is off`).

**Where it is built.** On the owner's machine, from the full index, which exists
only there (`packages/kb/corpus` and `packages/kb/index` are never synced):

```bash
pnpm --filter "@perfectman/kb..." build      # kb and what it imports (shared)
cd packages/kb
node dist/cli.js export-slim --out slim/kb-slim.json --built "$(date +%F)"
# in a checkout without the index: add --index <path to kb.sqlite>
```

About 1.4 MB, open text only (public domain and CC BY-SA), every excerpt with its
work, author and licence, the notice in the file's own header. It is deterministic:
the same index gives the same bytes, so a rebuilt file that `cmp`s equal needs no
deploy. `packages/kb/slim/` is gitignored, so the file never dirties the checkout.

**How it is rsynced.** It travels with the tree, as `packages/kb/slim/kb-slim.json`.
The `EXCLUDES` list above does not cover it on purpose. Put the file in the checkout
you sync from before the dry run (the file list should show it); a checkout without
it makes `--delete` remove the copy on the server, which is how to switch the
feature off.

**How the container sees it.** The image copies only the packages' `dist`, so the
file is not in the image: mount the synced directory read-only and name the file.
In the sidecar service of the habbo repo's compose file (the snippet in
`packages/hotel/deploy/compose.sidecar.yaml` has the lines, commented out):

```yaml
environment:
  PERFECTMAN_KB_SLIM: /kb/kb-slim.json
volumes:
  - /opt/cmb/perfectman/packages/kb/slim:/kb:ro
```

An environment change needs the container recreated (`up -d`), not restarted.
To roll back, remove the variable (or the file and the sync) and recreate. Nothing
in the file needs an embedding model or an ONNX runtime. Do not publish the file
anywhere without its notice. This section describes the procedure; nothing here
was deployed.

Not verifiable from this repo: the habbo-side compose and `deploy.sh`, and the
rsync flags above beyond `--checksum -n` and the exclude list, which are the
documented procedure rather than something a file here proves.

## What is exposed

The run server and the interface are public and unauthenticated, which makes the
link shareable and means anyone holding it can start a run. Runs cost machine time,
not model credits: a key is pasted per run in the browser, becomes an environment
variable for that run's lifetime, and never reaches the stored config. `mock` needs
no key. To close it off, put an auth proxy in front of the Fly app or turn on
Vercel's deployment protection.
