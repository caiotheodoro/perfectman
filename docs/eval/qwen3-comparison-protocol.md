# Controlled qwen3 model comparison protocol

A re-run recipe for the `qwen3:8b` vs `qwen3:1.7b` question. The first
comparison (8b 5–6× slower, no clear quality win) carried three confounds
this protocol removes.

## Confounds being controlled

| Confound | Control |
| --- | --- |
| Retry logic landed after the comparison; 8b's retry-token cost was folded into its baseline | Both arms run on current main (repetition guard + policy knobs included); wire-call counts recorded per run via the bench report so retry cost is visible separately from generation cost |
| Per-scenario timing escalated within a single run (306s → 567s → 672s), suggesting thermal/context compounding | Interleave models per scenario (A/B/A/B) instead of back-to-back runs; discard the first scenario of each arm as warm-up; cap each session to one scenario before restarting the server (`ollama stop` / relaunch) to reset KV and thermal state |
| Unpinned sampling made quality deltas unattributable | Sampling is pinned by default in local-mode benchmarks (seed 42, see docs/eval README); keep `PERFECTMAN_LLM_SEED` identical across arms |

## Recipe

1. **Slice**: use a named slice so both arms see identical scenarios:

   ```sh
   pnpm --filter @perfectman/eval bench --slice edges --out out/qwen-arm-<model>-edges.json
   ```

2. **Arms**: one process per model, everything else identical:

   ```sh
   PERFECTMAN_LLM_BASE_URL=http://localhost:11434/v1 \
   PERFECTMAN_LLM_MODEL=qwen3:1.7b \
   pnpm --filter @perfectman/eval bench --mode local --judge rule --slice canary \
     --out out/qwen-1.7b-canary.json

   PERFECTMAN_LLM_MODEL=qwen3:8b \
   pnpm --filter @perfectman/eval bench --mode local --judge rule --slice canary \
     --out out/qwen-8b-canary.json
   ```

3. **Read-out** (per arm, then diff):
   - judge axis means vs targets (quality),
   - `providerCalls` vs turn counts (retry pressure by model),
   - wall-clock `latencyMs` per scenario (cost) — compare interleaved pairs,
     not totals,
   - signal pass rate must be 100% in both arms or the run is invalid
     (structural regressions trump quality deltas).

4. **Decision rule**: prefer 1.7b unless 8b wins ≥ two quality axes by a
   full point AND costs ≤ 2× latency with comparable retry pressure.
   Anything narrower is noise at n=4 scenarios.

## What stays manual

Steps involving a live Ollama server are maintainer-run by design — the
repo's CI and offline gates never start local models. Everything up to the
`bench` invocations is reproducible offline via `--slice` dry-runs against
the persona-aware mock.
