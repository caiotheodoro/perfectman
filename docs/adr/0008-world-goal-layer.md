# ADR-0008: World Goal Layer

**Status**: Accepted (LOCKED, 2026-08-25) — rationale and rejected alternatives inline below; the `.claude/_output/pipeline/decision-log.md` archive is a secondary pointer only and is never the home of this decision's rationale.

## Context

The simulation has no explicit, principled way to end. Runs stop only by operator command or resource limits, so the run drifts or loops. The user's position is a set of hard constraints:

1. **No pre-defined objective.** The simulation must not start with an objective; the objective is created while the simulation runs. Nothing pre-defined, totally creative, out of the box.
2. **The end is a world-level judgment**, not an agent's assertion.
3. **The deluded-achiever case is canonical, not an edge bug** — a person can believe they reached their objective while the world judges it was never reached, and the simulation keeps going. This is 1 of N emergent phenomena the layer must support.
4. **Mimic humans** — the mechanism must be grounded in psychology, not invented.

Research established (full trail in [docs/research/goal-layer/](../research/goal-layer/README.md), fetched 2026-08-25): goals are real only if they recur and are owned (Emmons; Deci & Ryan); "reached" is a convergence signal (Zeigarnik salience collapse, SDT need-satisfying events, Carroll erotetic closure, Campbell's return leg, Park's meaning-made); self-belief and world-verdict must be allowed to diverge both ways (Gollwitzer self-completion; Zeigarnik); the ending is authored by the world and needn't be a win (Freytag's catastrophe, Propp, Dwarf Fortress); autotelic generator + critic with a world-fact verifier is the operating shape for emergent goals (Colas; Schmidhuber Goldilocks); delusion is a two-factor spectrum with a derived gap, not a flag (Coltheart; Kunda); ratification is an emergent, breakable consensus (Ridgeway).

## Decision

A **world layer above the agent level** owns the goal lifecycle and the termination gate:

- **Two-verdict independence.** `self_verdict` (agent belief machinery: felt signal, narrative, sociometer, generalized other) and `world_verdict` (objective check + emergent consensus of other agents) are computed by independent machinery. The world verdict never reads the target agent's own claim; termination gates on world-verdict only.
- **Termination gated on world-verdict; the deluded achiever never terminates.** world-verdict = reached + completion beat + meaning-made → offer ending, emit epilogue, terminate. world-verdict = not reached while the agent claims reached → re-goal, never terminate; the mismatch surfaces as a derived `delusion_gap` and may later resolve as a narrated tragic beat (Propp's exposure of the false hero).
- **Goals are never seeded.** The registry starts empty and holds only mid-run proposals: a crystallizer mines the event log for recurrent lacks/failures/high-valence patterns, a critic applies Schmidhuber's Goldilocks rule (reject already-trivial and verifiably-impossible; empowerment tie-break), and the agent accepts or declines — autonomy is required for goal ownership (SDT).
- **End = offered + world-verified + earned + meaning made.** Ending requires the target world-state verified, the archetypal completion beat (task → recognition → exposure → transformation → return-with-elixir with cost + return), and the agent's narrative converging with the event log. A plateau with no critic-surviving next goal closes as a "story is over" ending (Dwarf-Fortress-flavored); the world-history record is always written so any run has a narrative terminus.
- **The gap is derived, never stored as a flag.** `delusion_gap` = divergence(belief, event-log, world-verdict, others' beliefs) over time, driven by per-agent weights (`w_signal`, `w_social`, `w_identity`, `revision_threshold`).
- **I/O boundaries.** The engine layer is pure (no LLM calls, no I/O); zod lives in `@perfectman/shared`; pulse-loop wiring, `SimulationLifecycle` stop path, config surface, LLM narration/verdict seams, and observability-stream integration are deferred to later slices.

## Rationale

- **Two-verdict independence is the whole point** (R2): "The first question is, what brought the delusional idea to mind in the first place? The second question is, why is this idea accepted as true and adopted as a belief when the belief is typically bizarre and when so much evidence against its truth is available to the patient?" (Coltheart, Langdon & McKay 2011). A verdict derived from a single agent-oracle is not a world verdict; termination on self-verdict alone implements the flagship case backwards. Sources: [source-map.md](../research/goal-layer/source-map.md) rows for Coltheart 2011, Kunda 1990, Leary 1995, Ridgeway & Correll 2006.
- **Never-seeded, crystallized goals** follow the autotelic pipeline: "intrinsically motivated learning agents that can learn to represent, generate, select and solve their own problems" (Colas et al., arXiv:2012.09830); Sims 3 lifetime wishes crystallize from event history and are accepted or declined. Forced goals are not owned — "the autonomy of personal goals predicted goal attainment" (Sheldon & Elliot 1998). Sources: source-map rows for arXiv:2012.09830, arXiv:1708.02190, Schmidhuber 2010, sims.fandom.com Lifetime wish, ck2.paradoxwikis Ambition.
- **Reached is a convergence signal, not a single check** (R1): Zeigarnik's quasi-need discharge, SDT need satisfaction, Carroll's answered macro-questions, Campbell's return-with-elixir, Park's meaning-made. "This model distinguishes between the constructs of global and situational meaning and between 'meaning-making efforts' and 'meaning made'" (Park 2010). Sources: source-map rows for MacLeod 2020, Gollwitzer 2009, JLS 2016, *Heroism Science* 2019, Park 2010.
- **World-gated termination with re-goal on mismatch** mirrors the adaptive self-regulation literature: "goal disengagement and goal reengagement can be associated with ratings of high subjective well-being" (Wrosch et al. 2003) — the sim that hard-ends on unattainability models psychopathology, not meaning. NetHack's ascension check is the game-form precedent: the imitation amulet yields disgrace, not victory. Sources: source-map rows for Wrosch 2003, nethackwiki Ascension, rimworldwiki Ending.
- **Endings may be non-wins**: "The end of the piece follows this catastrophe immediately, the situation where the restoration of peace and quiet after strife becomes apparent" (Freytag 1863); "There is no internal end point, single goal, final Easter egg or 'You Win!' announcement in Dwarf Fortress" (dwarffortresswiki.org). The plateau/"story is over" ending encodes this.

## Rejected Alternatives

- **Trust the agent's self-report for termination** (self-verdict-gated ending). Rejected: Gollwitzer's self-completion shows social acknowledgment can prematurely close a loop without attainment; it implements the premature-closer and deluded-achiever cases backwards. It remains a visible second opinion, never the gate.
- **Preset startup objectives / seeded goal registry.** Rejected: violates hard constraint 1; the Sims-3 "completed wish blocks a new wish" design also shows a permanently-satisfied goal dead-ends the layer — re-aim after fulfillment (CK2 ambitions) is required.
- **Delusion as a stored boolean flag on the agent.** Rejected: R2 establishes a spectrum (Kunda's plausibility bound vs Coltheart Factor-2 failure) that a flag cannot represent; the gap must be derived over time and computed from divergence against log, world verdict, and others' beliefs.
- **A single omniscient world judge (oracle) producing the verdict.** Rejected: R2/R3 — the world speaks socially (Leary sociometer, Berger sanctions), and ratification is an emergent, breakable consensus (Ridgeway & Correll 2006, "slight challenges … broke the validating consensus"); an oracle cannot represent the world-briefly-wrong possibility.
- **Hard-terminate on unattainability** ("goal failed → sim ends"). Rejected: models psychopathology instead of meaning (Wrosch); the deluded achiever is a legitimacy-preserving re-goal arc, and mismatch may become a narrated tragic beat.
- **Placing the layer inside a single agent's mind** (agent-local goal judgment). Rejected: the layer reads the canonical event log + agent states and produces judgments no single agent produces (world-level by definition); the verifier must stay architecturally independent of the agent to prevent critic-capture (rubber-stamping the agent's delusion).
- **Gating the ending on the LLM/narrative layer.** Rejected as V1: the engine stays pure and testable; LLM narration/verdict seams are a later slice (deferred in the spec), keeping the termination gate deterministic.

## Consequences

- The simulation gains a principled, world-judged terminus: runs end by earned offer, re-goal out of the deluded-achiever arc, or close as "the story is over" — no run is stuck looping without a narrative terminus.
- The goal layer ships as shared types + zod schema and six pure engine functions; nothing is wired into the pulse loop, `SimulationLifecycle`, `SimulationSettings`, or the observability stream yet (deferred by the user; "tests at the end" — no unit/mutation tests this run).
- The engine stays I/O-free: any future LLM critic/narrator lives in the server layer; zod stays in `@perfectman/shared` (already a dependency).
- The docs pack, concept page, and this ADR carry the full external-source trail inline (R4 repair): rationale and rejected alternatives survive `.claude/_output` archiving by construction.
- Future slices must add: pulse-loop wiring + `simulation_stopped` end-reason emission, `goalLayer` config surface, LLM seams, observability-stream verdict emission, and the deferred test suite for the six functions.

## Cross-links

- Runtime wiring: [ADR-0009: Goal-Layer Runtime Wiring](./0009-goal-layer-runtime-wiring.md) — executed this ADR's deferred pulse-loop/lifecycle/config items (2026-08-25); its Decision/Consequences supersede the "deferred" bullets below for those items.
- Concept: [docs/concepts/goal-layer.md](../concepts/goal-layer.md) — the layer, lifecycle, two-verdict architecture, N possibilities.
- Research: [docs/research/goal-layer/source-map.md](../research/goal-layer/source-map.md) — every source, fetch date 2026-08-25, verification status.
- Code: `packages/shared/src/goal/` (types + zod schema), `packages/engine/src/goal/` (six pure functions), exported from both package indexes.