# Deploying

The two halves host differently, because only one of them is a static asset.

## Why the run server is not serverless

A run is minutes of awaited work that keeps going after the request that
started it returns. The controller holds its state and SSE backlog in process
memory, and the stream is a separate request that has to reach that same
process. A function gets none of those: it is billed and bounded per
invocation, has no shared memory between them, and its filesystem is read-only.

So the server wants one long-lived instance. Cloud Run with `--max-instances=1`
and CPU always allocated is the smallest thing that qualifies.

## The run server, on Cloud Run

```bash
gcloud run deploy perfectman-server \
  --source . --region=us-central1 \
  --allow-unauthenticated \
  --port=8080 --cpu=4 --memory=2Gi \
  --min-instances=0 --max-instances=1 \
  --no-cpu-throttling --timeout=3600 \
  --set-env-vars=PERFECTMAN_RUNS_DIR=/tmp/runs
```

Each flag is load-bearing:

| Flag | Why |
|---|---|
| `--max-instances=1` | One run at a time, held in memory. A second instance would answer `/stream` for a run it has never heard of. |
| `--no-cpu-throttling` | The pulse loop runs between requests. Throttled CPU stalls it the moment the POST response is sent. |
| `--timeout=3600` | The SSE stream stays open for the length of the run. |
| `--min-instances=0` | Scales to zero when idle. A cold start adds a few seconds; set it to 1 to avoid that and pay for the idle instance. |
| `--cpu=4` | Measured, not guessed — see below. |
| `PERFECTMAN_RUNS_DIR=/tmp/runs` | Cloud Run's filesystem is read-only apart from `/tmp`, which does not outlive the instance. Artifacts are readable while it is up and gone afterwards. |

### On the CPU count

One vCPU looks like plenty for a service that spends its time waiting on a
model, and it is not. Measured on the same scene, model and key within minutes
of each other:

| Where | One pulse |
|---|---|
| Cloud Run, 1 vCPU | 483s |
| Laptop | 80s |
| Cloud Run, 4 vCPU | 61s |

A pulse is not one request and a wait. It builds a prompt per agent, opens
three TLS connections, and parses three large JSON replies, and all of that is
CPU on a single-threaded runtime. A `mock` run hides it completely — ten pulses
in under five seconds on the starved instance — because mock skips every part
that costs anything.

The failure mode is worth recognising because it does not look like slowness:
`stop` cannot interrupt a pulse already in flight, so a starved instance sits
in `stopping` for minutes and reads as a hang.

## The interface, on Vercel

Built against the server's URL, because a static host has nothing to inject it
at runtime:

```bash
cd packages/web
VITE_API_BASE=https://<your-cloud-run-url> pnpm build
npx vercel deploy --prebuilt --prod
```

`--prebuilt` matters. Vercel's own build runs `npm install`, which cannot
resolve `@perfectman/shared` from a pnpm workspace; building here and shipping
the output sidesteps it. The Build Output API config lives in
`.vercel/output/config.json` and only needs single-page rewrites.

Git-connected deploys build from the repo root and look for a top-level `dist`.
The root `vercel.json` builds `@perfectman/web` and copies `packages/web/dist`
there so that lookup succeeds.

Unset `VITE_API_BASE` and every request goes back to being relative, which is
what the local `pnpm web` path wants — one process serving both.

## What is exposed

Both halves are public and unauthenticated, which is what makes the link
shareable and also means anyone holding it can start a run. The runs cost
container time, not model credits: a key is pasted per run in the browser,
becomes an environment variable for that run's lifetime, and never reaches the
stored config. `mock` needs no key at all.

To close it off, drop `--allow-unauthenticated` and put an identity-aware proxy
in front, or re-enable Vercel's deployment protection on the interface.
