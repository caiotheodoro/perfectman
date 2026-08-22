# Controlled qwen3 model comparison protocol

A re-run recipe for the `qwen3:8b` vs `qwen3:1.7b` question. The first
comparison (8b 5–6× slower, no clear quality win) carried three confounds
this protocol removes.

## Confounds being controlled

| Confound | Control |
| --- | --- |
| Retry logic landed after the comparison; 8b's retry-token cost was folded into its baseline | Both arms run on current main (identical repetition guard + retry code), so the confound is **equalized, not visible**: per-scenario `fallbackCount` in the bench report only counts terminal `llm_failure` events, and a call that succeeds on retry 2 emits nothing — that cost stays folded into `latencyMs`. Wire-call-level accounting now exists in the scenario-runner artifact (`providerCalls`, from the repetition-sweep work) but the bench report does not surface it yet — surfacing it is a small follow-up to `cli/bench.ts`; until then treat retry pressure as equalized-and-proxied |
| Per-scenario timing escalated within a single run (306s → 567s → 672s) | Arms are interleaved **per scenario** (one arm then the other, before moving on) and the Ollama server is restarted between scenarios to reset KV cache and thermal state; since every pair starts on a fresh server, **counterbalance arm order across pairs** (1.7b-first on odd scenarios, 8b-first on even) so a systematic first-server advantage cannot land on one model |
| Unpinned sampling made quality deltas unattributable | Local-mode benchmarks pin sampling by default (seed 42; see docs/eval README). Keep `PERFECTMAN_LLM_SEED` identical across arms; run each arm at **2–3 seeds** when n allows, and record `ollama --version` plus each model's digest in the report — Ollama seed determinism is best-effort and `think:false` handling is version-dependent, so two Ollama versions can fail differentially by model |

## Recipe

One scenario per invocation — that is what makes the interleave and the
restarts possible. Prerequisites: pull both models first
(`ollama pull qwen3:1.7b qwen3:8b`) — a fresh `ollama serve` fails the first
call for whichever tag is missing — and capture `ollama --version` plus the
model digests (`ollama list`) into the report as the environment
fingerprint. Note `--out` is resolved from the package cwd, so
`--filter @perfectman/eval` places outputs under `packages/eval/out/`.

```sh
# repeat for SCENARIO in motive_gossip v1_exclusion_inferred motive_conflict stagnation_resentment_loop
SCENARIO=motive_gossip
# counterbalance: 1.7b-first on odd-numbered scenarios, 8b-first on even.
# (for a two-arm shell loop: switch order every iteration)

# restart between scenarios (clears the in-process KV cache):
# kill the server, wait for the port to free, relaunch fresh
pkill -f "ollama serve" 2>/dev/null || true
until ! lsof -i :11434 >/dev/null 2>&1; do sleep 1; done
ollama serve >/dev/null 2>&1 &

PERFECTMAN_LLM_BASE_URL=http://localhost:11434/v1 \
PERFECTMAN_LLM_MODEL=qwen3:1.7b \
pnpm --filter @perfectman/eval bench --mode local --judge rule \
  --scenarios "$SCENARIO" --out "out/qwen-1.7b-$SCENARIO.json"

PERFECTMAN_LLM_BASE_URL=http://localhost:11434/v1 \
PERFECTMAN_LLM_MODEL=qwen3:8b \
pnpm --filter @perfectman/eval bench --mode local --judge rule \
  --scenarios "$SCENARIO" --out "out/qwen-8b-$SCENARIO.json"
```

Slice identity: these are exactly the `canary` slice's four scenarios
(see `packages/eval/src/bench-slices.ts`) — the quality-focused
iteration set both arms must share.

## Read-out

Per scenario pair:

- **prompt-stack sanity check**: `templateVersions` must be identical in
  both arm reports (a free check that the arms ran the same prompt
  templates); `promptVersions` sets should agree too — if they diverge,
  explain the difference (memory ordering changes versions legitimately),
- judge axis means vs targets (quality — see the instrument caveat below),
- `fallbackCount` per arm (retry pressure proxy; equalized, not visible),
- wall-clock `latencyMs` compared within the pair, never across scenarios,
- signals: track pass rate directionally (live-model runs legitimately
  vary — the offline 100% bar is not the live bar), but any outright
  scenario failure invalidates that pair.

## Decision rule

Prefer 1.7b unless 8b wins ≥ two quality axes by a full point across the
usable pairs AND costs ≤ 2× median paired latency with comparable
fallback pressure. Anything narrower is noise at this n.

**Instrument caveat (why quality axes are provisional here).** The recipe
above runs `--judge rule`, whose axes are structural heuristics that
main's own docs say not to trust as prose-quality measures — a genuine 8b
quality win may be unmeasurable by that instrument, so the defaults
would win by construction. The correct instrument is a cross-family LLM
judge (DeepSeek at temperature 0, sidestepping local-qwen-judges-its-own-
arms bias), but the CLI currently shares one endpoint env
(`PERFECTMAN_LLM_BASE_URL`) between the arena and the judge, so a
separate-endpoint judge is not runnable today without pointing the arena
at DeepSeek too. Until a judge-endpoint override lands (small follow-up:
`PERFECTMAN_JUDGE_BASE_URL` in `judgeConfig()`), treat every quality
conclusion as provisional and lean on the required full-point margin and
multi-seed sweeps to keep noise out of the verdict.

## What stays manual

Steps involving a live Ollama server are maintainer-run by design — the
repo's CI and offline gates never start local models. Everything up to the
`bench` invocations is reproducible offline against the persona-aware mock.
