# ADR-0012: Meaning-Made Gate Calibration and Config Elevation

**Status**: Proposed (2026-08-27) — decision D-29; becomes Accepted on PR merge (issue #106).

## Context

Issue #106 asked to calibrate the hardcoded meaning-made gate `divergenceFromLog < 0.33`
(server-side constant at `world-evaluator.ts:643` scaffold), routed by ADR-0011 D-28.
The #96 calibration measured the tightest margins in the goal layer at this gate — the
healthy arc's closest approach was 1.2% under the gate (0.326 at cadence 1) and the
tightest flip-review margin ~7% (world-briefly-wrong, 0.307) — but could not tune it: the
gate sat outside the RD-4 matrix and had **no config path**. The D-28 routing named the
follow-up outline: elevate the constant into the `goalLayer` config section (optional
field, default 0.33) and sweep a grid over the gate-relevant arcs.

This ADR lands both halves of that outline — the config elevation (the instrument that
makes the sweep executable) and the dedicated 30-cell grid — and records the verdict the
sweep produced.

## Decision (D-29)

**1. The gate moves to config as the calibration instrument.** The constant becomes
`goalLayer.ending.meaningMadeMaxDivergence` (zod 0..1, optional;
`goal-layer-config.schema.ts`), resolved with default 0.33 in `resolveGoalLayerConfig`
(`world-evaluator.ts`). `deriveMeaningMade` is the single derivation, exported through the
server eval surface (`packages/server/src/index.ts`); the eval harness consumes the
ceiling from the resolved config instead of the duplicated local constant
(`MEANING_MADE_DIVERGENCE_MAX` + local `deriveMeaningMade` copy in
`goal-scenario-runner.ts` — a second source of truth — removed).

**2. The 0.33 default is confirmed by its own dedicated sweep — negative result.** The
30-cell grid (below) shows 0.33 is the minimum calibrated-safe ceiling: every value below
it false-rejects the terminating arcs, every value above it is behavior-neutral with zero
measured false-accept. The negative result is the outcome; the default stays 0.33.

## Why the config elevation is prescribed here (the D-27 contrast)

ADR-0011 D-27 rejected config elevation of a global `delusionWeights` fallback: the
weights are record-only (no gate consumes `magnitude`), so elevation would move a knob
that **cannot flip any gate**. The meaning-made gate is the opposite case: it is decisive
— together with the completion beat it is the only path to an earned ending
(`evaluateEndCondition`, `evaluate-end-condition.ts`: reached + beat + meaning-made, or
nothing). Moving the same knob pattern from an inert threshold to a decisive one converts
an unjustified config surface into the prescribed calibration instrument. The D-28 outline
named this elevation explicitly.

## Sweep evidence

30 cells: 5 ceilings (0.25 / 0.30 / 0.33 / 0.36 / 0.40) × 3 gate-relevant arcs
(healthy-achiever / world-briefly-wrong / hollow-completion) × 2 cadences (1 / 10),
appended to the #96 grid in the same CLI (50 cells total), through the mock-only harness
(version `goal-layer-sweep-v1`, mode `mock`, pulse cap 120). Committed artifact:
[evidence/meaning-made-gate-sweep-2026-08-27.json](../research/goal-layer/evidence/meaning-made-gate-sweep-2026-08-27.json).
Verification: zero wire calls in 50/50 cells; byte-identical re-run (md5
`b3b74ad9ea02…`); the 20 #96 cells are field-identical to the committed #96 artifact —
the grid append perturbs nothing.

### Termination matrix

| Arc | Cadence | 0.25 | 0.30 | 0.33 | 0.36 | 0.40 |
| --- | --- | --- | --- | --- | --- | --- |
| healthy-achiever | 1 | continue @6 | reached @4 | reached @4 | reached @4 | reached @4 |
| healthy-achiever | 10 | continue @51 | continue @51 | reached @31 | reached @31 | reached @31 |
| world-briefly-wrong | 1 | continue @6 | continue @6 | reached @5 | reached @5 | reached @5 |
| world-briefly-wrong | 10 | continue @51 | continue @51 | reached @41 | reached @41 | reached @41 |
| hollow-completion | 1 | cap @120 | cap @120 | cap @120 | cap @120 | cap @120 |
| hollow-completion | 10 | cap @120 | cap @120 | cap @120 | cap @120 | cap @120 |

`reached` = the earned `goal_end_offered`; `continue` = the arc never receives an ending;
`cap` = pulse-cap-stop.

### Findings

- **False-reject is the gate's real failure mode.** 0.25 rejects all four terminating
  cells; 0.30 rejects three of four — world-briefly-wrong at both cadences (flips
  0.307087 / 0.309883) and healthy-achiever at cadence 10, whose flip (0.300000) sits
  exactly at the ceiling and the comparison is strict `<`. A rejected flip does not delay
  the ending — it deletes it: a reached-but-unearned verdict falls to the re-goal branch
  of `evaluateEndCondition`, and the run stops at 6/51 pulses with no `ending_offered`
  ever emitted for the resolve goal.
- **Gate consultations at 0.33 (flip margins):** healthy 23.4% (cadence 1) / 9.1%
  (cadence 10); world-briefly-wrong 6.9% (cadence 1) / **6.1% (cadence 10, tightest
  gate-decisive margin)** — the §7 "7%" headline was the cadence-1 flip; the dedicated
  grid measured the cadence-10 flip tighter.
- **Zero false-accept measured.** The 0.36/0.40 cells are identical to 0.33 in every
  field except the cell label. Structural reason: `deriveMeaningMade` requires
  `determination === "reached"` before the divergence comparison, so the
  ratified-contested-window samples (0.376471 at cadence 1, 0.324201 at cadence 10)
  consult and fail the gate on the determination clause regardless of ceiling;
  hollow-completion's divergenceFromLog (0.660→0.961 at cadence 1, 0.909→0.926 at
  cadence 10) sits far above every tested ceiling.
- **The measured class separation is wide.** Genuine-completion flips top out at
  0.309883; the hollow band starts at 0.660377 — 0.33 sits inside that dead zone, and any
  value in (0.31, 0.66) behaves identically on this grid.

## Rationale

- **Negative result over value churn (D-27 precedent).** The value could move anywhere
  in the measured dead zone without flipping a cell; there is no evidence warrant for a
  change, so the scaffold value stays — now with a margin floor (6.1%) on the tight side
  and maximal measured distance from the hollow band, both on record.
- **Elevation is the calibration instrument, not scope.** The sweep cannot move the
  ceiling per cell without a config path; the optional field with the default preserved
  is the minimal surface that enables it (schema-validated, additive, no behavior change
  for existing configs).
- **Single derivation.** Removing the harness's local copy of the predicate and constant
  closes the second-source-of-truth drift; the gate's behavior is test-pinned at the
  measured margins (`meaning-made-gate.test.ts`).

## Rejected Alternatives

- **Sweep without elevation** (patch the constant per cell, revert after). Rejected:
  leaves no durable config path for the value the sweep justifies; the D-28 outline
  names elevation as the primary option.
- **Keeping the constant hardcoded and documenting only.** Rejected: D-28 routed the
  gate to a sweep *because* it was untunable; a doc-only close leaves the gate no better
  instrumented than before, and the harness would keep its duplicate predicate.
- **Moving the default into the dead zone's interior** (e.g. 0.45, the geometric middle
  of (0.31, 0.66)). Rejected: behavior-identical on this grid, so it is churn; and it
  would trade margin against the hollow band for margin the flips do not need — the
  observed failure mode is false-reject, already impossible at 0.33.

## Consequences

- `goalLayer.ending.meaningMadeMaxDivergence` is a new optional config field (default
  0.33) — additive; existing configs behave exactly as before.
- The eval harness and the server share the single `deriveMeaningMade`; the gate's
  behavior is test-pinned at the measured margins (0.326 / 0.33 / 0.376 / 0.307 and the
  resolver default).
- [calibration-2026-08-26.md](../research/goal-layer/calibration-2026-08-26.md) §11
  records the grid; [gaps.md](../research/goal-layer/gaps.md) drops the "stays untuned"
  row for the gate.
- Future ceiling changes have a durable instrument: add a ceiling to the grid, run the
  sweep, compare against the margins on record.

## Cross-links

- Foundation: [ADR-0011](./0011-goal-layer-threshold-calibration.md) (D-28 routes this
  gate here; D-27 supplies the negative-result precedent and the inert-vs-decisive
  contrast), [ADR-0008](./0008-world-goal-layer.md),
  [ADR-0009](./0009-goal-layer-runtime-wiring.md),
  [ADR-0010](./0010-goal-layer-llm-slice.md).
- Calibration: [calibration-2026-08-26.md](../research/goal-layer/calibration-2026-08-26.md)
  §7 (the reference margins) and §11 (the dedicated grid record);
  [evidence/meaning-made-gate-sweep-2026-08-27.json](../research/goal-layer/evidence/meaning-made-gate-sweep-2026-08-27.json).
- Code: `packages/shared/src/goal/goal-layer-config.schema.ts`,
  `packages/server/src/simulation/world/world-evaluator.ts`,
  `packages/engine/src/goal/evaluate-end-condition.ts`,
  `packages/eval/src/goal-layer/goal-scenario-runner.ts`,
  `packages/eval/src/cli/sweep-goal-layer.ts`.
- Issue: [#106](https://github.com/caiotheodoro/perfectman/issues/106).
