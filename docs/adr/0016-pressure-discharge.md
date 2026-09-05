# ADR-0016: Pressure Discharge

**Status**: Accepted (LOCKED, 2026-09-05) — rationale and rejected alternatives inline in this ADR (decisions **D-55..D-58**).

**Numbering note**: written against ADRs 0001..0015; in-tree decision high-water mark **D-54** (ADR-0015). The D-55..D-58 range is this ADR's.

## Context

`computePressures` recomputes every urge from the agent's emotional state each pulse, with no memory of having acted on it. `computeActionEmotions` carries large baseline terms that do not depend on events: for the goulart calibration (arousal 0.65, stability 0.35) `impulsiveProvocation ≈ 0.49`, which times its pressure weight is a `high urge_to_provoke` on every pulse of every run, with nothing said. No inhibition available to that persona outranks `high`. ADR-0015 removed the ownership defects around `needsLLM`; without a memory of acting, a hot persona still alternates act / cooldown / act.

Issue #119 lists "targeted per-motive accumulator relief — discharge only the accumulator(s) whose source drove the committed action; needs motive→action attribution threaded to the resolver first" as unspecified. Constraint carried in: the engine stays pure and reads persisted state only; the scheduler is the single writer after commit (the `lastActionAt` precedent, #124); no speculative constants without a tuning owner.

## Decision

1. **`AgentState.pressureDischargedAt?: Partial<Record<PressureType, number>>` (D-55)** — the pulse index of the last committed outward act that expressed each urge. Optional: absent means never discharged, so the forty-odd fixtures that build the literal keep compiling and existing rows read back unchanged.
2. **Discharge is subtractive with linear refill, overwhelming exempt (D-56).** `effective = raw ≥ 0.85 ? raw : max(0, raw − PRESSURE_DISCHARGE · max(0, (PRESSURE_REFRACTORY_PULSES − pulsesSince + 1) / PRESSURE_REFRACTORY_PULSES))`, applied per `ACTION_PRESSURE_MAP` entry and to the private-channel drive before the intensity label; an urge that discharges below `PRESSURE_THRESHOLD` is removed, not clamped. `PRESSURE_DISCHARGE = 0.40`, `PRESSURE_REFRACTORY_PULSES = 6` (`shared/src/constants/pressure-refractory.ts`), provisional, owner #129.
3. **The scheduler stamps every salient pressure after a committed outward act (D-57)** at the `lastActionAt` site, under the same condition. Not only the top one: the goulart calibration feels provoke, dominate and show-off together, and discharging one would hand the turn to the next.
4. **Persistence rides the agent-state row (D-58)**: a nullable JSON column `pressure_discharged_at`, added with a guarded `ALTER TABLE` for databases created before it; the in-memory repository needs nothing.

## Rationale

- Follows the `lastActionAt` precedent exactly: engine reads persisted state, scheduler writes once after commit, `persistAndSnapshot` is the single write point, pulse-index based so sim-time deterministic.
- Delivers #119's "targeted per-motive relief" without the motive→action attribution prerequisite: the discharged set is "what was felt when the act was chosen", which `stepResult.pressures` already is.
- Subtractive rather than multiplicative so the emotion's shape survives: a `0.73` provoke drops to `0.33` (silent unless addressed) the pulse after, `0.40` at +2, back to `0.73` at +7 — roughly one act per 2–3 pulses for the hottest persona instead of every pulse. The residual `medium` at +2 is the event-independent baseline, a #119 emotion-magnitude item, out of scope here.
- Overwhelming urges are exempt at read time so ADR-0015's "overwhelming can never be inhibited" stays true.

## Rejected Alternatives

- **Per-pressure decay state inside `Pressure`** — pressures are recomputed, not persisted (D-55).
- **Stronger attention-side cooldown** — already exists and is bypassed by the salience clause (ADR-0015).
- **Scheduler LLM cap** — hides the model instead of fixing it (ADR-0015).
- **Discharging only the top pressure** — hands the turn to the next urge of the same persona (D-57).
- **A required field** — forty fixtures to touch for identical runtime semantics (D-55).

## Consequences

- Turn cadence for hot personas drops; the eval's `act-share-max` probe and the experiment protocol's decision rule measure it.
- The 40-pulse two-agent run gains the invariant "no agent commits messages on more than 2 consecutive pulses without being mentioned".
- The constants are the first tuning knob for #129; `sweep-*` harnesses in the eval package are the place to move them.

## Cross-links

- ADR-0015 (decision owns `needsLLM`), ADR-0013 (scheduler-private state mutation precedent), issue #119 / #124 / #129.
- Code: `packages/engine/src/pressure/compute-pressures.ts`, `packages/server/src/simulation/pulse-scheduler.ts`, `packages/shared/src/agent/agent.types.ts`, `packages/shared/src/constants/pressure-refractory.ts`, `packages/server/src/persistence/sqlite/{schema,database,agent-state-repository}.ts`.
- Tests: `compute-pressures.test.ts`, `pulse-scheduler.test.ts` (discharge stamping), `initiative-two-agent-run.test.ts`, shared `schemas.test.ts`.
