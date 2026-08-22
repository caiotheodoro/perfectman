# Controlled qwen3 model comparison protocol

A re-run recipe for the `qwen3:8b` vs `qwen3:1.7b` question. The first
comparison (8b 5–6× slower, no clear quality win) carried three confounds
this protocol removes.

## Confounds being controlled

| Confound | Control |
| --- | --- |
| Retry logic landed after the comparison; 8b's retry-token cost was folded into its baseline | Both arms run on current main (repetition guard included); `fallbackCount` and per-scenario turn counts come from the bench report. Wire-call-level retry accounting lands with the repetition-sweep work — until then, treat fallbackCount as the retry-pressure proxy |
| Per-scenario timing escalated within a single run (306s → 567s → 672s) | Arms are interleaved **per scenario** (1.7b then 8b on the same scenario before moving on), the first pair is discarded as warm-up, and the Ollama server is restarted between scenarios to reset KV cache and thermal state |
| Unpinned sampling made quality deltas unattributable | Local-mode benchmarks pin sampling by default (seed 42; see docs/eval README). Keep `PERFECTMAN_LLM_SEED` identical across arms |

## Recipe

One scenario per invocation — that is what makes the interleave and the
restarts possible:

```sh
# repeat for SCENARIO in motive_gossip v1_exclusion_inferred motive_conflict stagnation_resentment_loop
SCENARIO=motive_gossip

# restart between scenarios (resets KV + thermal state)
ollama stop 2>/dev/null; ollama serve &

PERFECTMAN_LLM_BASE_URL=http://localhost:11434/v1 \
PERFECTMAN_LLM_MODEL=qwen3:1.7b \
pnpm --filter @perfectman/eval bench --mode local --judge rule \
  --scenarios "$SCENARIO" --out "out/qwen-1.7b-$SCENARIO.json"

PERFECTMAN_LLM_BASE_URL=http://localhost:11434/v1 \
PERFECTMAN_LLM_MODEL=qwen3:8b \
pnpm --filter @perfectman/eval bench --mode local --judge rule \
  --scenarios "$SCENARIO" --out "out/qwen-8b-$SCENARIO.json"
```

Slice identity: use the same four scenarios as the `edges` slice (see
`packages/eval/src/bench-slices.ts`) so the pressure axes get a sample.

## Read-out

Per scenario pair (discard the first pair as warm-up):

- judge axis means vs targets (quality),
- `fallbackCount` per arm (retry pressure proxy),
- wall-clock `latencyMs` compared within the pair, never across scenarios,
- signals: track pass rate directionally (live-model runs legitimately
  vary — the offline 100% bar is not the live bar), but any outright
  scenario failure invalidates that pair.

## Decision rule

Prefer 1.7b unless 8b wins ≥ two quality axes by a full point across the
usable pairs AND costs ≤ 2× median paired latency with comparable
fallback pressure. Anything narrower is noise at this n.

## What stays manual

Steps involving a live Ollama server are maintainer-run by design — the
repo's CI and offline gates never start local models. Everything up to the
`bench` invocations is reproducible offline against the persona-aware mock.
