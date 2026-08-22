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
# so per-axis samples stay meaningful.
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

Every PR also runs this harness in CI (`.github/workflows/pr-gate.yml`):
typecheck, unit tests, then a mock+rule-judge bench over the golden scenario
subset with a hard 100%-signals assertion (`scripts/ci/check-bench-gate.mjs`)
— free, deterministic, no model needed.

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
