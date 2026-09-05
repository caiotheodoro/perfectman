# Canary 136-138: post-#136/#138 eval shift, attributed

`pnpm --filter @perfectman/eval` evidence + bench canary run on
`feat/138-relational-accretion` (mock mode, deterministic), with a
pre-wave control run at `7e25ce0` + the #148 merge repair for attribution.

## Before/after (same 4 scenarios, same CLI)

| scenario | pre-wave signals | post-wave signals | Δ llmCalls (per agent) |
| --- | --- | --- | --- |
| motive_gossip | P P | P P | caio 12 → 24 |
| v1_exclusion_inferred | P P P | P **F** P | bruno 8 → 13 |
| motive_conflict | P P | P P | — |
| stagnation_resentment_loop | P P P | **F F** P | — |

Failing signals, all resentment floors: `v1_exclusion_inferred`
`bruno.resentment = 0.116 (min 0.12)`; `stagnation_resentment_loop`
`bruno.resentment = 0.468 (floor 0.5)`, `caio.resentment = 0.272 (floor 0.3)`.

## Attribution

The shift is caused by #138's relational accretion (not by the older merged
stack, not by the #148 repair): pre-wave passes every signal, post-wave misses
exactly the resentment floors. The new `message_sent` relational rule adds
non-hostile relational motion (co-presence bumps, reply/message deltas), which
dilutes the resentment trajectories the stale floors were calibrated against.
The floors are tuning artifacts of the no-relational-accretion dynamics;
recalibration belongs to #129. The `bench-mock-baseline.json` (2026-08-08)
predates the entire #113-#146 stack and is not a valid comparator.

The LLM-call deltas confirm the predicted sustained-attention shift from
dormant-path activation (every canned agent attentive every pulse), e.g.
`caio` in motive_gossip 12 → 24.

## Harness gap — resolved (#152)

The original diagnosis above was wrong about the cause: the eval scenario
runner already drives the real pipeline (`buildConfiguredSimulation` →
`SimulationRuntime.runPulse` → `PulseScheduler.executePulse`), which calls
`applyMemoryProjection` and passes `agentNames` into `IntentResolver.resolve`
exactly as the live path does — confirmed by re-running `v1_biased_memory` in
mock mode straight off `ScenarioRunner.run`, which returned populated
`agentState.memories` and `agentState.relationalStates` for both agents. The
actual gap was in the evidence CLI: `buildFinalStates()`
(`packages/eval/src/cli/evidence.ts`) only ever read `coreMood` and
`socialEmotions` off the agent state, so the memory/relational counts were
never serialized into evidence JSON — the harness wasn't blind, its report
writer was silent. Fixed by adding `memories` (count) and `relationalStates`
(count) to each agent's `finalStates` entry. The evidence dir below was
regenerated with the fix; every scenario now shows non-zero
`relationalStates` for all agents and non-zero `memories` for at least one
agent per scenario. No change was needed in `scenario-runner.ts`,
`pulse-scheduler.ts`, or `intent-resolver.ts`, so ADR-0013 D-37 (scheduler-
private `applyMemoryProjection`, not a projection class) stands unmodified.

Regenerating also picked up the resentment-floor recalibration merged after
this canary was first captured, so the before/after signal counts in the
table above no longer match a fresh run (all four scenarios now pass every
signal); the table is left as the historical record of the #136/#138
attribution investigation, not a live status.

## Recalibration (follow-up commit)

The three floors were recalibrated in the same PR from the measured post-wave
values with ~10-14% margin: `stagnation-attractors.ts` bruno 0.5 -> 0.42,
caio 0.3 -> 0.24; `v1-behaviors.ts` bruno 0.12 -> 0.10. The full
`GOLDEN_SCENARIOS` bench gate passes at 100% signal rate post-recalibration
(35 runs, 0 failed). Floor re-tuning against the activated relational dynamics
remains a #129 decision; these values only restore the gate while preserving
the documented shift.
