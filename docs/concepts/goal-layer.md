# Goal Layer

The world-level layer that gives the simulation a principled ending: goals crystallize from the run's own history, the world judges them independently of the agents who pursue them, and termination is offered, world-verified, and earned — never forced and never seeded.

## Position: a World Layer above the agent level

```text
[ Agent Mind ]   existing: persona, emotion, motivation, perception, intent, memory
[ World Layer ]  NEW: goal registry, goal crystallizer, goal critic, world-fact verifier,
                     world verdict (objective + consensus), ending evaluator, delusion-gap
[ Spectator ]    existing: narrative projection (story layer feeds/reads from world verdicts)
```

The world layer reads the canonical event log and agent states — exactly what `WorldSignals`/`EngineSnapshot` already carry — and produces judgments no single agent produces. It is pure and deterministic (matching the engine's pure-function pattern); LLM narration/verdicts are a later seam, not a V1 dependency.

**Runtime wiring — IMPLEMENTED (2026-08-25, issue #93).** The layer now runs inside the simulation: an end-of-pulse world review on the configurable `goalLayer.reviewEveryPulses` cadence (after the agent loop), agent-visible `goal_proposed`/`goal_accepted`/`goal_declined` events, per-review `world_verdict` + `delusion_gap_sampled` events, and an earned end offer that terminates the run through the runtime's stop path — `simulation_stopped` carries `endReason: "goal_end_offered"` and the epilogue. The engine stays pure (only type re-exports); the runtime machinery lives in `packages/server/src/simulation/world/` (registry, evaluator, deterministic synthesizer, auto acceptance gate), all gated by the optional `goalLayer` config section — absent or disabled ⇒ zero behavior change. See [ADR-0009](../adr/0009-goal-layer-runtime-wiring.md).

**LLM slice — IMPLEMENTED (2026-08-26, issue #94, [ADR-0010](../adr/0010-goal-layer-llm-slice.md)).** All three deferred modes are wired and build: `synthesizer.mode: "llm"` (an LLM `GoalSynthesizer` whose `GoalLayerLLMClient` renders the shared `goal-synthesis` prompt surface, budget-gates through the shared `llmBudget` (`callType: "goal"`), and dispatches on the agent's configured `LLMConfig` — mock/ollama/openai-compatible; the mock provider is a deterministic canned stand-in that records usage like a real call), `acceptance.mode: "agent"` (the `AgentAcceptanceGate` resolves accept/decline from the target agent's post-proposal behavior in the goal's channel — SDT autonomy as engagement), and LLM self-verdicts (the combined interval call returns proposals + self-verdicts; the registry's stored-first junction feeds `computeDelusionGap` unchanged). Cost gate: at most one combined call per agent per `intervalPulses` review — never per pulse, never per goal — inputs capped (`maxCandidatesPerReview`, `maxSelfVerdictsPerReview` default 3), every call blocked-or-recorded by the budget. Fallbacks (budget-blocked, failed, or malformed response) degrade honestly to deterministic proposals with provenance `"deterministic"` and transient, never-stored structural V1 verdicts, emitting `llm_failure`/`llm_budget_exceeded` operator events. Termination stays world-verdict-only: a deluded achiever claiming "reached" re-goals and never terminates.

## The goal lifecycle (emergent, not pre-defined)

1. **Crystallize** — a miner scans the event log for recurrent lacks/failures/high-valence patterns from an agent's own history (Propp's "lack"; Sims-3-style triggers: repeated gaze, failed attempts, sharp relational change, witnessed events) → candidate goal proposals. The goal registry starts empty; goals are **never seeded**.
2. **Critique** — the critic rates each proposal with Schmidhuber's Goldilocks rule: *previously unknown but learnable* (reject already-trivial and verifiably-impossible), with empowerment as the tie-break. The **agent accepts or declines** — a forced goal is not owned (autonomy).
3. **Pursue** — the goal becomes active; the agent's self-narrative and the world state both track it.
4. **Judge (every milestone)** — two independent verdicts:
   - *Self*: from the agent's belief machinery (felt signal, confabulated narrative, sociometer, internalized generalized-other).
   - *World*: (a) objective — state-space distance to the target predicate verified against the event log; (b) consensus — other agents' ratification/deference (Ridgeway: breakable). The world verdict never reads the target agent's own claim.
5. **End or re-goal** — see ending semantics below.

## Two-verdict architecture and the delusion gap

`self_verdict` (agent belief) and `world_verdict` (objective check + emergent consensus) are computed by independent machinery and may diverge in both directions: public acknowledgment can prematurely close a loop without attainment (Gollwitzer self-completion), and factually-closed arcs can stay tension-loaded (Zeigarnik).

The `delusion_gap` is a **derived** quantity — divergence(belief, event-log, world-verdict, others' beliefs) tracked over time, never stored as a flag. It is driven by per-agent weights (`w_signal`, `w_social`, `w_identity`, `revision_threshold`) encoding Coltheart's two-factor theory plus Kunda's motivated-reasoning bounds, producing a spectrum from healthy rationalization (plausibility-bounded) to clinical delusion (Factor-2 reality-check failure). The agent's narrative stays separate from the event log so confabulation is visible as narrate-vs-log divergence.

## Ending semantics

Termination is **offered, world-verified, and earned**:

- world-verdict = reached AND completion beat present (task → recognition → exposure → transformation → return-with-elixir, with cost + return) AND meaning-made gate (agent narrative converges with the log) → offer the ending; emit epilogue; terminate.
- world-verdict = not reached but agent claims reached → **do not terminate**: the canonical deluded-achiever arc; surface the gap, let the agent disengage-and-re-engage (Wrosch) into a new crystallized goal, or let the mismatch resolve as a narrated tragic beat (Propp's "exposure of the false hero") if the arc plateaus irreconcilably.
- plateau with no compelling next goal surviving the critic → ending offered as "the story is over" (Dwarf-Fortress-flavored); the world-history record is always written so any run has a narrative terminus.

## The N possibilities this unlocks

1. **Deluded achiever** — world says never reached, agent insists (flagship).
2. **Premature closer** — goal announced/publicly acknowledged lowers attainment energy; world sees no attainment.
3. **Unmade meaning** — agent narrates meaning endlessly; world facts refute the reconciliation; the sim continues while the discrepancy persists.
4. **Contested consensus** — in-group ratifies, wider collective rejects; world-verdict is "contested".
5. **Satisfied-then-hollow** — an extrinsic, un-owned goal is reached; it does not discharge into closure — the sim re-goals instead of ending.
6. **The world is briefly wrong** — consensus ratifies a false claim; a single credible challenger "breaks the validating consensus" and flips the verdict.

## Sources / Related decisions

- Research pack: [docs/research/goal-layer/](../research/goal-layer/README.md) (source map, notes, gaps).
- Decisions: [ADR-0008: World Goal Layer](../adr/0008-world-goal-layer.md) (semantics) and [ADR-0009: Goal-Layer Runtime Wiring](../adr/0009-goal-layer-runtime-wiring.md) (pulse hook, ending gate, config, seams — 2026-08-25).
- Registry: [concept-map.md](concept-map.md) Concept 42.