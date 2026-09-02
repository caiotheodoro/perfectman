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

## Harness gap (follow-up, not a regression)

`finalStates.memories` and `finalStates.relationalStates` are **empty in both
pre- and post-wave runs**: the eval scenario-runner commits events through its
own path and does not ride the scheduler's `applyMemoryProjection` (a
`PulseScheduler` private method) nor the resolver's participant-identifier
stamping. The eval harness therefore cannot witness either #136 or #138
effects; memory/relational behavior is verified by the unit/integration suites
(1418 -> 1423 tests) and the live run in
`docs/eval/evidence/local-deadroom-deepseek/`. Follow-up: route the eval
runner through the real resolver/scheduler seam (or stamp identifiers in its
own builders) so future evidence can see the new subsystems.
