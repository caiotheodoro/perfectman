# ADR-0011: Goal-Layer Threshold Calibration

**Status**: Accepted (LOCKED, 2026-08-26) — rationale and rejected alternatives inline in this ADR (decisions D-24..D-25).

## Context

Issue #96 asked to calibrate the goal-layer thresholds against mock-run evidence: run ≥6 scenario trajectories through a mock-only harness, capture per-run goals crystallized/accepted, delusion-gap trajectories, termination reasons, and pulse counts, then either update the scaffold defaults from evidence or keep them with the negative result documented. The thresholds named in the issue and their homes:

| Threshold | Scaffold value | Home |
| --- | --- | --- |
| `DEFAULT_DELUSION_WEIGHTS` (wSignal/wSocial/wIdentity) | 0.4/0.4/0.2 | engine `compute-delusion-gap.ts:19-24` (G4-guarded) |
| `revisionThreshold` | 0.5 | engine, carried in the weights default — consumed nowhere in runtime code (inert) |
| Crystallizer minima (failed-attempt / gaze-event) | 2 / 3 | engine `crystallize-goal-proposals.ts:28-29`, module-local, no per-run config path |
| `reviewEveryPulses` | 10 | server default `world-evaluator.ts:119` |
| `offerAcceptPulses` | 0 | server default `world-evaluator.ts:123` |
| Meaning-made gate (`divergenceFromLog < 0.33`) | 0.33 | server constant `world-evaluator.ts:643` |

The calibration ran a 20-cell matrix (6 scenarios × 3 weight/cadence cells + 2 `offerAcceptPulses` probes) through the mock-only sweep harness; trajectories are committed in [evidence/goal-trajectory-sweep-2026-08-26.json](../research/goal-layer/evidence/goal-trajectory-sweep-2026-08-26.json) (zero provider/LLM calls in every cell, byte-identical re-runs) and the full per-scenario findings are in [calibration-2026-08-26.md](../research/goal-layer/calibration-2026-08-26.md). Engine purity (G4, ADR-0009) collides with the AC-2 default-update option by design; the Step 3.5 user decision locked **RD-3 = A, landed as "calibrated, values confirmed"**: the evidence recommends no numeric change, the negative result IS the outcome, and the G4 exception is recorded as granted-and-unexercised.

## Decision

**1. Calibration outcome: defaults confirmed by evidence — negative result (D-24).** No numeric change is made to any engine or server default. Per the record's §10 slate, locked verdicts: delusion weights 0.4/0.4/0.2 **kept (confirmed)**; `revisionThreshold` 0.5 **kept, inert** (no runtime consumer — belief-revision machinery deferred, measured as a no-op row, RD-5); crystallizer minima 2/3 **kept (measured-only)** — module-local, untunable per-run, no behavior attributable to the values; `reviewEveryPulses` 10 **kept (confirmed)** — cadence is capture resolution, arc outcomes identical in reviews; `offerAcceptPulses` 0 **kept (confirmed)** — the knob behaves as named. The **G4 exception is granted-and-unexercised**: the Step 3.5 slate authorized the engine-edit path for this calibration, the evidence produced no warrant for any value change, and the exception therefore stands recorded but unused — it is not a license to edit engine constants, and any future threshold change must earn its own exception.

**2. The meaning-made 0.33 gate is not tuned by this run (D-25).** The gate sits outside the RD-4 matrix (weights × cadence × offerAccept), and tuning it without evidence is rejected — the run measured the tightest margin in the system there (closest approach 1.2% under the gate on a healthy-arc pre-flip continue review at cadence 1; tightest flip-review margin 7%, world-briefly-wrong — record §7) but a value change needs its own sweep. Routed to follow-up issue #106 (created 2026-08-26) with the evidence summary, the margin numbers, and the sweep outline; the constant stays at 0.33 until that calibration lands.

## Rationale

- **Negative result over value churn (D-24):** no termination flipped in any of the 18 scenario cells under the adjusted weight set (0.6/0.3/0.1, record §2), and grep-verified the weights are record-only — `magnitude` is read solely inside `computeDelusionGap`, no end-condition gate consumes it. A value change would therefore be behavior-neutral churn executed under a G4 exception: the exception's own test (evidence justifies the edit) fails by definition. AC-2 explicitly allows "kept with documented negative result", so keeping IS the fulfilled requirement.
- **Scaffold values already separate the arcs legibly (D-24):** measured magnitudes 0.12 / 0.13 / 0.37 / 0.72 / 0.92 / 0.93 across the six scenarios; the "better" adjusted set trades a wider low band for a compressed contested band (record §2) — cosmetic, mixed-direction.
- **Cadence and offerAccept need no change (D-24):** cadence scales sampling density and pulse-domain latency but not review-domain outcomes; the probes extend acceptance latency exactly 1:1 per pulse as configured.
- **Route the only near-threshold, don't guess it (D-25):** the 0.33 gate is server-side and hardcoded; the calibration could only measure its margin, not justify a replacement value. A dedicated issue with the evidence attached preserves the measured truth without an out-of-matrix edit.

## Rejected Alternatives

- **Changing `DEFAULT_DELUSION_WEIGHTS` to the adjusted set (RD-3 branch A executed).** Rejected: zero termination flips across the scenario cells; observable differences are cosmetic rescaling, mixed across bands; an exercised G4 exception for behavior-neutral churn cannot be justified by the evidence.
- **Config elevation of a global `delusionWeights` fallback (RD-3 branch B).** Rejected: no measured warrant for a new config surface when the underlying constant is behavior-inert — elevation would move a knob that cannot flip any gate.
- **Tuning the 0.33 meaning-made gate inside this run.** Rejected: outside the RD-4 matrix, no evidence grid to set a value; the follow-up issue owns the sweep (D-25).
- **Building belief-revision machinery to make `revisionThreshold` tunable.** Rejected: out of scope for #96; the inert value is recorded as a measured no-op and deferred with the machinery.

## Consequences

- The thresholds stand as scaffold-calibrated values with a durable evidence home: [calibration-2026-08-26.md](../research/goal-layer/calibration-2026-08-26.md) + committed artifact; [gaps.md](../research/goal-layer/gaps.md) no longer claims the weights are "expected to be tuned" — the row is marked measured/confirmed 2026-08-26 and cross-links this ADR.
- AC-2 is fulfilled as the kept-with-negative-result outcome; AC-1/AC-3 are met by the committed artifact (6 scenarios, zero wire calls, deterministic re-runs, record §9).
- G4 is preserved: `git diff packages/engine/src/goal/` is empty at wave end; the granted exception is recorded here as unexercised and is not a standing license (D-24).
- `revisionThreshold` stays inert and documented; tuning it requires the deferred revision machinery (record §6, gaps.md).
- The 0.33 gate is tracked by issue #106 with its measured margins until a dedicated sweep calibrates it (D-25).

## Cross-links

- Foundation: [ADR-0008: World Goal Layer](./0008-world-goal-layer.md) (semantics), [ADR-0009: Goal-Layer Runtime Wiring](./0009-goal-layer-runtime-wiring.md) (G4 guard the exception stands unexercised against; carries this calibration's consequence note), [ADR-0010: Goal-Layer LLM Slice](./0010-goal-layer-llm-slice.md) (D-17..D-23; this ADR continues numbering at D-24).
- Calibration: [calibration-2026-08-26.md](../research/goal-layer/calibration-2026-08-26.md) — per-scenario findings, verdict slate that D-24 locks; [evidence/goal-trajectory-sweep-2026-08-26.json](../research/goal-layer/evidence/goal-trajectory-sweep-2026-08-26.json) — the committed trajectories.
- Follow-up: [issue #106](https://github.com/caiotheodoro/perfectman/issues/106) — meaning-made 0.33 gate calibration (D-25).
- Code: `packages/engine/src/goal/compute-delusion-gap.ts` (weights), `packages/engine/src/goal/crystallize-goal-proposals.ts` (minima), `packages/server/src/simulation/world/world-evaluator.ts:119,123,643` (cadence / offerAccept / 0.33 gate).