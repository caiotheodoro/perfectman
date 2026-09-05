# ADR-0015: The Decision Owns `needsLLM`

**Status**: Accepted (LOCKED, 2026-09-05) — rationale and rejected alternatives inline in this ADR (decisions **D-50..D-54**).

**Numbering note**: written against ADRs 0001..0014; in-tree decision high-water mark **D-49** (ADR-0014). The D-50..D-54 range is this ADR's.

## Context

On a real 32-pulse, 4-agent `hoc_fatia_que_nao_existe` run one agent made an LLM call and posted on every pulse (33 of 68 events), re-announcing the scene's opening line at pulses 7, 10, 12, 18 and 28, while the other three agents made 9–12 calls. Five mechanisms combined, all verified in code:

1. `scoreAttention` set `needsLLM` on any high/critical-salience new event *including the agent's own* (`score-attention.ts`). A high-arousal persona stamps `high` salience on her own messages (`deriveSalience` in the resolver), so speaking forced the next call.
2. `runEngineStep` re-raised `needsLLM` from attention onto any decision that was not `no_op`/`memory_only` — a `delay` still produced an LLM call, and the scheduler gates the call on `needsLLM` alone.
3. `hasNewEvents` is structurally true in any room with more than one agent (own events re-enter the cursor), so a cooldown keyed on "nothing new" never armed.
4. `cold_start_bootstrap` is decay-exempt, regrows at `growthRate × energy` and re-crossed its 0.30 threshold every ~5–6 pulses for the whole run — the observed re-announcement cadence.
5. Pressures are recomputed statelessly from emotional baselines; a `high urge_to_provoke` existed every pulse with zero events, and no inhibition available to the persona outranked it (`STRENGTH_RANK` tops at 3, `INTENSITY_RANK` at 4).

Three components each believed they owned the LLM gate. Constraint carried in: the engine stays pure and deterministic; the scheduler must not become a second owner of cognition (a per-pulse LLM cap would hide the model instead of fixing it).

## Decision

1. **The decision is the single owner of `needsLLM` (D-50).** `resolveDecision` takes a `DecisionContext` (`hasNewEvents`, `addressed`, `salientForeignEvent`, `initiativeProceed`, `pulseIndex`, `initiativeCandidates`, `justActed`); `needsLLM` is exactly `outcome === "act"`; the re-raise in `runEngineStep` is deleted. Attention's own `needsLLM` stays as an operator-facing read and now excludes the agent's own events.
2. **Every act passes one gate (D-51).** Cooldown: `justActed && !addressed && urge < overwhelming → delay`. Floor: a `low` top urge with nothing addressed, nothing salient from others and no initiative → `no_op`. The empty-pressure initiative path and the initiative-override path go through the same gate.
3. **Being addressed lifts a cooldown and a delay-favoring inhibition, never a no-op-favoring one (D-52).** "Notices a mention and replies" stays a V1 target; "fear of rejection" stays a reason not to.
4. **A `delay` produces a `noOpRecord` (D-53).** Cooldowns become visible to operators and to the `silence_cascade` attractor instead of vanishing.
5. **Cold start fires once (D-54).** `cold_start_bootstrap` is retired to 0 once `lastActionAt !== null`; post-first-act silence is the boredom accumulator's job. Pressure and inhibition ids are derived (`${agentId}:${type}`) so the step's determinism test can compare whole results.

## Rationale

- Ownership over thresholds: making attention's cooldown stronger could not work — the salience clause bypassed `dueScore` entirely. Routing attention's verdicts *into* the decision is the layering the pipeline doc describes (`attention → … → decision`).
- The gate uses only information the step already has; no new state, no new constants (`overwhelming` is the existing exemption, `low` the existing bottom rank).
- Retiring cold start needs no constant either: "never acted" is already a state (`lastActionAt === null`).
- Property tests (fast-check, already an engine devDependency) pin the invariant "an unaddressed agent never acts on two consecutive pulses" across generated pressure/inhibition mixes — a stricter generator than production, since accumulators are not relieved in it.

## Rejected Alternatives

- **Scheduler-side cap on consecutive LLM calls** — a second, non-cognitive owner of the gate, exactly the class of defect being removed (D-50).
- **Stronger attention cooldown** — only affects `dueScore`, which the salience clause bypassed (D-50).
- **Cooldown keyed on `!hasNewEvents`** — never true in a multi-agent room (D-51).
- **Making `INITIATIVE_COOLDOWN_PULSES` longer for cold start** — still re-fires; the source is semantically one-shot (D-54).

## Consequences

- Fewer LLM calls per pulse for hot personas; a `delay` now really skips the call. Turn share is measured by the eval's `act-share-max` probe and the experiment protocol's decision rule.
- Existing engine tests that built a `resolveDecision` call positionally migrate to the context object; the initiative relief seam test still sees `cold_start_bootstrap` fall after an act (to 0, by retirement).
- Pressure discharge (the stateless-baseline mechanism, item 5) is a separate decision — this ADR removes the ownership defects; without discharge a hot persona can still alternate act/skip.
- Emotion-magnitude baselines and the rank asymmetry stay as #119 items.

## Cross-links

- ADR-0014 (motive events; the observability that made the monopoly measurable).
- Issue #119 (fix map), #124 (`lastActionAt` relief), #129 (conversation-quality audit this feeds).
- Code: `packages/engine/src/decision/resolve-decision.ts`, `packages/engine/src/step/run-engine-step.ts`, `packages/engine/src/attention/score-attention.ts`, `packages/engine/src/initiative/update-initiative-accumulators.ts`, `packages/shared/src/decision/decision.types.ts`.
- Tests: `decision-gates.test.ts`, `decision.property.test.ts`, `attention.test.ts`, `engine-step.test.ts`.
