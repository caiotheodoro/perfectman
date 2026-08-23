# Perfectman Roleplay Benchmark (packages/eval)

The benchmark that measures whether Perfectman agents *roleplay* — not just
whether the pipeline stays within structural invariants.

## Why it exists

The V1 target behaviors (casual chat, mention → reply, deliberate no-op,
private-channel motives, exclusion inference, late replies, emoji reactions,
biased memory, recaps) were never measured. The engine's own tests assert
bounds and event shapes; nothing asserted whether the agent *behaved like a
person*. This package closes that gap:

- **Deterministic behavioral probes** over the event stream (no LLM) —
  latency, lurking, interruption, silence-misreading, alliance density,
  private-channel density, no-op meaningfulness, AI-leak, emoji reaction,
  memory writes, LLM fallback rate.
- **Expected-signal checks** — each scenario declares deterministic signals
  (emotion rises/persists, events committed, LLM call ranges, no failures).
- **Judge harness** — rubric-axis scoring (in-character, voice, motive
  authenticity, interpretation, creativity/chaos, memory continuity,
  no-AI-leak) via an offline rule judge or an LLM judge, with calibration
  against golden labels (kappa/alpha gate) and canonical-JSON caching.
- **Scenario library** — 39 hand-authored scenes across 5 categories
  (V1 behaviors, 17 private-channel motives, 6 stagnation attractors,
  edge/chaos tier, calibration) expanded by deterministic rotation to
  123 tasks (S2 lesson: <100 tasks is noise).

## Running

```sh
# offline mock baseline (persona-aware mock provider + rule judge)
pnpm --filter @perfectman/eval bench --out out/bench-report.json

# real local model (Ollama-compatible, e.g. Qwen3-class uncensored)
PERFECTMAN_LLM_BASE_URL=http://localhost:11434/v1 \
PERFECTMAN_LLM_MODEL=qwen3:8b \
pnpm --filter @perfectman/eval bench --mode local --judge llm --out out/bench-local.json

# heuristic LLM-as-judge with per-turn narrative-cohesion scoring.
# The judge defaults to HIGH temperature (PERFECTMAN_JUDGE_TEMPERATURE) —
# varied, creative reads expose cohesion/voice failures a strict low-temp
# judge misses. Set it to 0 for deterministic calibration runs.
PERFECTMAN_LLM_PROVIDER=deepseek \
PERFECTMAN_JUDGE_TEMPERATURE=1.0 \
pnpm --filter @perfectman/eval bench --mode local --judge llm --per-turn --limit 6

# slices
pnpm --filter @perfectman/eval bench --category edge_chaos
pnpm --filter @perfectman/eval bench --scenarios v1_mention_reply,motive_gossip --limit 6

# named slices — curated id sets (edges / golden / canary), see
# packages/eval/src/bench-slices.ts. Prefer these over hand-typed lists
# so per-axis samples stay meaningful. --slice is mutually exclusive with
# both --scenarios and --category; --limit truncates AFTER variant
# expansion, so a limit below the slice's expanded run count drops whole
# scenarios off the end.
pnpm --filter @perfectman/eval bench --slice edges
```

Local-mode benchmark runs pin LLM sampling to a fixed seed (`42` by default,
overridable via `PERFECTMAN_LLM_SEED`) so two runs of the same scenarios are
comparable instead of confounded by sampling variance. Normal simulation runs
(`pnpm --filter @perfectman/server simulation`) are unaffected and stay free
to be nondeterministic.

The report (`bench-report-v1`) contains per-scenario signal/probe/judge
results, probe averages, per-signal-kind pass rates with failing examples
(`signalsByKind`), judge axis means vs targets, category splits, and
the judge calibration report. Failing reports are committed, never hidden.
The `narrative_cohesion` axis lives on the `roleplay-v1` rubric (anchored for
turn-to-turn thread, callbacks, escalation, shifted meaning). By default the
LLM judge scores it from the whole transcript; `--per-turn` (LLM judge only)
replaces that with the mean of per-turn scores — each sampled content-bearing
turn is scored against the turn before it (see `packages/eval/src/judge/judge.ts`).

## Offline sweeps (policy knobs, no live models)

Two grid harnesses sweep the repetition guard and the temperature axis fully
offline (persona-aware mock + rule judge), and each commits its evidence
matrix to `docs/eval/evidence/`:

- `pnpm --filter @perfectman/eval sweep:repetition --out out/repetition-sweep.json`
  — `threshold × maxRetries` over 3 scenarios. The output embeds
  `probeThreshold` (the content-repetition yardstick is always measured at the
  probe's fixed 0.7, never at the cell's runtime threshold) and a `limitations`
  field (mock repeats sit at ≈1.0 Jaccard, so threshold cells are
  indistinguishable by construction — only `providerCalls`/`guardBlocks` vary
  across that axis).
- `pnpm --filter @perfectman/eval sweep:temperature --out out/temperature-sweep.json`
  — temperature grid over the `canary` slice; cells below the mock's only
  temperature read (the ≥0.9 charged-react gate) are identical by
  construction, which the `limitations` field says.

Both reports carry no wall-clock/timestamp fields so `cmp` against the
committed evidence is a literal check — a fresh run MUST be byte-identical.
The `guardBlocks` metric in both sweeps matches the exported
`REPETITION_GUARD_MARKER` prefix from `@perfectman/server`; rewording that
sentence upstream turns the sweep tests red, never a silent zero.

Calibration note: `docs/eval/evidence/calibration-mock-full.json` commits
`kappa 0.129 / alpha −0.104` against `targetKappa 0.7, passed: false` — the
judge calibration report is the ground truth even when it fails, and 5 of 10
rubric axes have zero variance across the 39 golden labels (`voice_match`=4,
`no_ai_leak`=5), which caps per-axis kappa at 0 for those axes until the
golden set gains spread.

Every PR also runs this harness in CI (`.github/workflows/pr-gate.yml`):
typecheck, unit tests, then a mock+rule-judge bench over the golden scenario
subset with a hard 100%-signals assertion (`scripts/ci/check-bench-gate.mjs`)
— free, deterministic, no model needed. The subset carries all four
`edge_chaos` scenarios (not just `edge_public_mock`), so axes like
`believability_under_pressure` get more than a single n=1 sample per run.

A second, weekly workflow (`.github/workflows/benchmark.yml`) runs the same
gate over the *full* 123-task suite (Mondays 03:00 UTC, or on demand via
`workflow_dispatch`) and uploads the report as a run artifact for trend
tracking. Its `judge=llm` dispatch input is an opt-in deep run for
self-hosted runners with model servers configured; hosted CI stays on the
offline rule judge by default.

A controlled 1.7b-vs-8b re-run recipe (interleaved arms, pinned
sampling, retry-cost visibility) lives in
[qwen3-comparison-protocol.md](qwen3-comparison-protocol.md).

## Judge self-preference: cross-family comparison + jury

Same-family judge/generator pairing risks self-preference bias. The judge
module supports a **jury**: `juryJudge(scenario, events, configs[])` runs
the same transcript through independently-sourced judges (different model
family and/or endpoint per config) and returns the per-axis median plus
every judge's raw scores. Spread across `perJudge` IS the bias evidence —
if a differently-sourced judge disagrees with the same-family judge by a
full point or more on an axis, don't trust that axis from either alone.
Note: median outlier-resistance needs ≥ 3 surviving jurors — with 2 the
median is just the mean. Salvaged jurors are reported but never voted.
Give every juror an explicit, source-naming `label` — default `judge-N`
labels make two byte-identical configs look like two sources.

Maintainer-run protocol (needs live models): score the same saved
transcripts once with the same-family judge, once with a different family,
diff axis means. If they diverge, report both and switch to the jury for
go-forward comparisons — a median verdict is **not comparable** to any
single-judge number in `docs/eval/evidence/` or the calibration baselines.

`juryJudge` is a library entry point of `@perfectman/eval` (no CLI script
yet — invoke it from a node one-liner). It fans every config out
concurrently via `Promise.allSettled`, so keep the judge list small and
point it at one local Ollama host at a time.

### The judge as a config section

The judge is resolved like every other LLM surface in the project — the
config file describes the experiment, the `.env` holds the secrets:

1. `--judge-config <path>` — an explicit standalone judge config file;
2. otherwise the `judge` section of the walk-up `config/index.json`;
3. otherwise the environment (`PERFECTMAN_JUDGE_BASE_URL` / `_MODEL` /
   `_TEMPERATURE`, `PERFECTMAN_LLM_*`, `PERFECTMAN_LLM_PROVIDER=deepseek`
   shortcut) — the env layer stays exactly as documented above;
4. otherwise defaults (local qwen3:8b endpoint; bench temperature 1.0,
   calibration 0).

`providerType` is `"openai-compatible" | "rule" | "mock"` — DeepSeek is
not a type, it is an openai-compatible endpoint in a file. Secrets are
referenced by NAME through `apiKeyEnv`; never inline a key. The `jury`
array is the first-class cross-family jury — the same loader instantiates
every member, so `bench --judge llm` with a jury in the file runs the
median verdict instead of one judge.

```jsonc
// config/index.json (or the file given to --judge-config)
{
  "judge": {
    "providerType": "openai-compatible",
    "baseUrl": "https://api.deepseek.com/v1",
    "modelName": "deepseek-chat",
    "apiKeyEnv": "DEEPSEEK_API_KEY",
    "temperature": 0,
    "timeoutMs": 90000,
    "jury": [
      { "providerType": "openai-compatible", "baseUrl": "http://localhost:11434/v1",
        "modelName": "qwen3:8b", "temperature": 0, "label": "local-qwen" },
      { "providerType": "openai-compatible", "baseUrl": "https://api.deepseek.com/v1",
        "modelName": "deepseek-chat", "apiKeyEnv": "DEEPSEEK_API_KEY",
        "temperature": 0, "label": "deepseek" }
    ]
  }
}
```

The `--judge rule|llm` CLI flag survives as a shorthand that overrides
`judge.providerType` only when passed explicitly; with no file and no
flag, every CLI keeps its offline rule-judge default.


## Current baseline (mock, 123 tasks)

- Signal pass rate: **100%** (all expected signals across all rotated scenes)
- Probe pass rate: **90%** — the remaining misses are band-calibration items,
  not defects (see below)
- Judge axis means vs targets: in_character 3.2 (target 4) LOW,
  voice_match 2.1 (3.8) LOW — the *rule judge* is a proxy; calibrate with the
  LLM judge (or real human labels) before trusting these numbers.

## Calibration-pending (honest list)

1. **Probe bands** are v1 seeds from the substrate research room; perfectman's
   multi-agent pulse scheduler shifts the meaning of interruption/lurking.
   Human-calibrated bands (research S1 discipline) replace them next.
2. **Judge calibration fails against the authored golden labels** — the first
   real LLM-judge calibration run measured kappa = −0.116 (target ≥ 0.7,
   n=8 overlapping scenes; see #24). A known confound: that run scored
   transcripts truncated at 8 pulses while the golden labels assume each
   scenario's full pulse count. The rule judge is v0 and the golden set
   still needs human review (Phase 2.4); the LLM judge must clear the
   kappa gate before its scores gate changes.
3. **Real local-model data now exists.** The run-preventing blockers — Qwen3
   `<think>` blocks eating the JSON response and judge parse failures — are
   fixed (#19), plus silently dropped Ollama sampling params (#21), and
   benchmark sweeps have been run against local models repeatedly (PRs
   #19–#22). Highlights from the PR #22 post-fix sweep: zero literal
   duplicate messages committed (previously agents repeated verbatim for
   5–10 straight pulses), `narrative_cohesion` mean 3.00 → 3.80,
   `memory_continuity` 2.93 → 3.67, aggregate signal pass rate 70.8%
   (from a 67.7% baseline) across the 16-scenario slice — with no
   per-signal-kind breakdown yet (#42). Committed offline evidence lives in
   `docs/eval/evidence/` (mock + deepseek-chat runs). These numbers come
   from single local runs without a pinned sampling seed (#45) and the same
   model family acting as both generator and judge (#28), so treat them as
   directional until both gaps close.

## Iteration loop

Every change to personas, prompts, scenarios, or the engine is a micro-patch:
run the bench, diff against the baseline, keep only changes that hold signals
at 100% and push probe/judge metrics up. No-regression first, improvement
second — the two-gate discipline from the research repo's micro-adapter loop.

## Spikes

- [LoRA per-persona fine-tuning feasibility spike](lora-feasibility-spike.md) — documented experiment, not implemented.
