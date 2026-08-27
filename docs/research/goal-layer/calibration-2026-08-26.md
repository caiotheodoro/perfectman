# Goal Layer Threshold Calibration — 2026-08-26

Calibration record for issue #96: run-scoped RD-4 matrix (20 cells) through the mock-only
goal-layer sweep harness, written from the committed evidence artifact
[evidence/goal-trajectory-sweep-2026-08-26.json](evidence/goal-trajectory-sweep-2026-08-26.json)
(version `goal-layer-sweep-v1`, mode `mock`, pulse cap 120). Freshness-dated per the
source-map convention: this record describes the thresholds as measured on main
@ c025a74 (2026-08-26). **Finalized 2026-08-26 under the Step 3.5 lock (RD-3 = A landed as
"calibrated, values confirmed")**: verdict rows §10 are locked (CONFIRMED/KEPT), the engine
diff stays empty (G4 exception granted-and-unexercised, ADR-0011 D-24), and the meaning-made
0.33 gate routes to follow-up issue #106 (ADR-0011 D-25).

Matrix: 6 scenarios × 3 cells (scaffold defaults / `reviewEveryPulses: 1` / adjusted
weights 0.6·0.3·0.1) + 2 `offerAcceptPulses` probes (2, 8) on the healthy arc = 20 runs,
each bounded to ≤120 pulses. All runs deterministic and zero-wire (see §9).

## 1. Per-scenario behavior at scaffold defaults

Defaults cell = `reviewEveryPulses: 10`, `offerAcceptPulses: 0`, weights 0.4/0.4/0.2/0.5.
Gap samples on the recipe's resolve goal (`crystal-ana-resolve-general`); magnitudes
decompose exactly as `wSignal·divergenceFromLog + wSocial·claimVsWorld + wIdentity·feltBoost`
(compute-delusion-gap.ts:43-49; verified against every measured sample, §4).

| Scenario | Expected arc | Observed (defaults cell) | Verdict |
| --- | --- | --- | --- |
| healthy achiever | reached-based `ending_offered`, low gap, stop | **matches** — `reached` @31 pulses; mag 0.126→0.12 with divergenceFromLog 0.316 (pulse-20 continue review) → 0.300 (pulse-30 flip review; both <0.33 meaning gate), divergenceFromWorld 0; recorder log `continue, end_offered`; 4 goals proposed/accepted, 0 declined (evidence L16-59) | CONFIRMED |
| deluded achiever | re_goal every review, zero end offers, gap mid-to-high, cap (G5) | **matches** — `pulse-cap-stop` @120; 10 samples mag 0.93→0.94 (divergenceFromWorld 1 — claimed reached vs world `not_reached`); recorder log `re_goal` ×10, zero `ending_offered` events; 12 proposed/11 accepted (evidence L60-151) | CONFIRMED |
| premature closer | never terminates, gap ≥0.5 post-challenge | **matches** — `pulse-cap-stop` @120; mag 0.92 flat (social channel maxed: dworld 1 → wSocial contribution 0.4); recorder `re_goal` ×10; zero end offers (evidence L152-243) | CONFIRMED |
| contested consensus | determination `contested` → continue, wSocial divergence 0.5 | **matches** — `pulse-cap-stop` @120; mag 0.72–0.73 flat with divergenceFromWorld exactly 0.5 on every sample (the claimVsWorld `contested` cell × wSocial); recorder `continue` ×10; zero end offers (evidence L244-335) | CONFIRMED |
| hollow completion | world reached, re_goal, zero end offers, cap | **matches** — `pulse-cap-stop` @120; mag 0.36–0.37 **low** (dworld 0 — self in_progress; the re-goal fires on the meaning gate, not the gap); recorder `re_goal` ×10 with `reached` determination; zero end offers (evidence L336-427) | CONFIRMED (behavioral note, §5) |
| world-briefly-wrong | contested sample(s) then reached, spike-then-settle | **matches at cadence 1** — `reached` @5 pulses; samples 0.130 → 0.151 (ratified-contested window, divergenceFromLog 0.376) → 0.123 (settle, 0.307); verdicts p2 `contested`, p3 `contested` (ratified), p4 `reached`; recorder `continue, continue, end_offered` (T103 pins this cell); **attenuated at cadence 10** (§3) | CONFIRMED w/ resolution caveat |

## 2. Delusion-weight sensitivity (defaults vs adjusted 0.6/0.3/0.1)

| Scenario | Default mag | Adjusted mag | Δ |
| --- | --- | --- | --- |
| healthy achiever | 0.12–0.13 | 0.18–0.19 | +0.06 (log channel 0.4→0.6) |
| deluded achiever | 0.93–0.94 | 0.93–0.95 | ~0 (social+identity-dominated, weights rebalance) |
| premature closer | 0.92 | 0.91–0.93 | ~0 |
| contested consensus | 0.72–0.73 | 0.76–0.78 | +0.05 |
| hollow completion | 0.36–0.37 | 0.55–0.56 | +0.18 (largest; purely log-driven) |
| world-briefly-wrong | 0.12–0.13 | 0.19 | +0.06 |

Findings:

- **The weights rescale the observation metric only.** The termination path consumes no
  magnitude: `evaluateEndCondition` gates on world determination × completion beat ×
  `meaningMade` × `nextGoalAvailable` (evaluate-end-condition.ts:49-78), and grep confirms
  `magnitude` is read only inside `computeDelusionGap` itself. Weight changes therefore
  cannot flip any gate — and none did: all 6 reached cells stayed reached, all 12
  cap-stop cells stayed cap-stop under adjusted weights (evidence L3532-3993).
- The adjusted set improves low-band separation (hollow/healthy gap 0.25→0.36) but
  compresses the contested band (contested-vs-deluded gap 0.21→0.16). Marginal, cosmetic.
- Consequence for RD-3: the engine constant `DEFAULT_DELUSION_WEIGHTS` is behavior-inert
  at this calibration's resolution — §8 recommendation.

## 3. Review-cadence effect (10 vs 1)

- **Sampling density**: capped arcs sample 10 gaps over 120 pulses at cadence 10 vs 118 at
  cadence 1 (e.g. deluded L60-151 vs L522-1261); terminating arcs sample 2 (healthy) and
  3 (world-briefly-wrong) regardless — the arc length in *reviews* is what sets the
  sample count.
- **Termination latency**: identical in reviews, scaling in pulses — healthy `reached`
  @31 pulses (cadence 10) vs @4 (cadence 1); world-briefly-wrong @41 vs @5. `offered` →
  next review accepts (N+1 acceptance timing, ADR-0009 D-11), so a run always ends one
  review after its flip review.
- **Resolution**: the world-briefly-wrong contest window (one review wide) is visible as
  a spike only at cadence 1 (0.151 vs 0.123 settle). At cadence 10 the same window
  dilutes into a mild divergenceFromLog ramp 0.310→0.324 with flat magnitudes — 
  sub-review-interval dynamics are lost at coarse cadence (evidence L428-477 vs
  L3482-3531).

## 4. offerAcceptPulses probes (healthy arc, cadence 1)

| offerAcceptPulses | Termination | Pulses | Gap samples |
| --- | --- | --- | --- |
| 0 | reached | 4 | 2 (0.10–0.13) |
| 2 | reached | 6 | 2 (0.10–0.13) |
| 8 | reached | 12 | 2 (0.10–0.13) |

Acceptance delay extends latency 1:1 per pulse at cadence 1 (pulses = 4 + offerAcceptPulses,
evidence L3994-4081); gap trajectory and termination reason unaffected. Default 0 gives
the tightest arc; the knob behaves as its name says.

## 5. Crystallizer minima at scaffold values (measured, not swept)

Minima `FAILED_ATTEMPT_MIN=2` / `GAZE_EVENT_MIN=3` are engine module-locals with no
per-run config path — RD-4 records measured behavior only, per the plan's scope:

- Resolve crystallization from blocked signals confirmed: every recipe seeds 3
  `intent_blocked` (min 2 satisfied) and the resolve goal crystallizes at review 1 in
  all 20 cells.
- The witnessed-injection mechanism keeps `nextGoalAvailable` true by crystallizing one
  legacy proposal per review on the four non-terminating arcs — measurable as
  `witnessedLegacyTrajectories` per cell (e.g. 119 on deluded cadence-1, evidence L522;
  11 on deluded defaults L60).
- Legacy goals on dense cells produce hundreds of near-identical scaffold trajectories;
  the committed artifact carries the resolve-goal trajectories plus the legacy counts
  (see evidence `limitations` block; raw unfiltered report available via
  `sweep:goal-layer --full-trajectories`).
- No behavioral anomaly attributable to the 2/3 values surfaced in any cell; nothing
  tunable was measured at other minima values.

## 6. revisionThreshold — measured no-op row (RD-5)

`revisionThreshold` (0.5) is carried in `DEFAULT_DELUSION_WEIGHTS`
(compute-delusion-gap.ts:23) and consumed **nowhere** in runtime code — belief-revision
machinery is deferred. All 20 cells ran with the value present (all cells are
`weights: default|adjusted` — both carry 0.5) and no outcome depends on it. Per RD-5 the
matrix does **not** sweep it; it is recorded as inert. Tuning it requires building the
revision machinery — out of scope for #96 and flagged in gaps.md.

## 7. Crystallizer-minima / sweep limitations (as recorded in the artifact)

- Trajectories sample at review cadence, not per pulse; pulse 0 is review-exempt.
- Self-claims are canned (deterministic `in_progress` or the reached-claim client), so
  arcs exercise the goal-layer machinery, not model behavior.
- The meaning-made gate `divergenceFromLog < 0.33` (world-evaluator.ts:643) is **outside
  the RD-4 matrix** but is the run's tightest threshold: the closest approach to the
  gate on any measured sample is the healthy arc's pre-flip continue review — 0.326 at
  cadence 1 (1.2% margin under the gate) and 0.316 at cadence 10 (4.4%). The flip
  reviews that actually consulted the gate measured wider margins: 0.253 (healthy,
  cadence 1, ~23% under), 0.300 (healthy, cadence 10, 9.1% under), and
  world-briefly-wrong's flip 0.307 (7% under) — the run's tightest gate-decisive
  margin. The contested-window sample (0.376) correctly fails the gate. A follow-up
  calibration should sweep this constant (server-side hardcoded, not configurable
  today) — recorded here because it is the only threshold the run found sitting close
  to a measured arc.

## 8. Evidence-grounded recommendation for the Wave-3 engine default update (RD-3=A)

**Locked verdict (2026-08-26, Step 3.5): adopted — defaults retained; the negative result
IS the calibration outcome (see §10 and ADR-0011 D-24).** The evidence that grounded the
recommendation:

- No cell in the 18 scenario cells flipped its termination under adjusted weights (§2).
- The weights are record-only: no gate consumes the magnitude, so no value set changes
  behavior; the observable differences are cosmetic rescaling, mixed across bands.
- The scaffold set 0.4/0.4/0.2 already separates all six arcs legibly
  (0.12 / 0.13 / 0.37 / 0.72 / 0.92 / 0.93).

Recommendation: **keep 0.4/0.4/0.2 (defaults retained — the negative result IS the
calibration outcome)**; direct Wave-3's actionable attention at the `0.33` meaning-made
constant (§7) — the only measured near-threshold in the system — as the candidate for
elevation to config or a swept dimension, under the Step 3.5 slate's framing. If the
Step 3.5 verdict nevertheless lands engine changes under branch A, this record's finding
is that the change is behavior-neutral today and should be limited to documentation of
the negative result rather than new values.

## 9. Determinism and zero-cost verification (AC-3, T202)

- Zero wire calls: `providerCalls`, `llmCalls`, and `goalCalls` are 0 in all 20 cells
  (no-op agent runtime + deterministic/canned goal legs; the counting budget tracker is
  the lone consumer and the canned client never records usage).
- Determinism: two independent full-matrix runs produce byte-identical artifacts
  (md5 `b1e44cf1648ef81ae0117b7653b86e93`, 130,202 bytes); per-cell resolve trajectories
  verified identical to the raw `--full-trajectories` report (6,044,358 bytes).
- Cap labeling: all 12 cap stops are labeled `pulse-cap-stop` and are separable from the
  8 `reached` terminations (which carry a `goal_end_offered` `simulation_stopped`);
  none of the four non-terminating arcs produced an `ending_offered` event.
- Wall-clock: one full sweep ≈ 13–15 s.

## 10. Verdict rows (LOCKED 2026-08-26 — Step 3.5: RD-3 = A, calibrated, values confirmed)

| Threshold | Scaffold value | Status | Evidence |
| --- | --- | --- | --- |
| DELUSION_WEIGHTS 0.4/0.4/0.2 | engine `DEFAULT_DELUSION_WEIGHTS` | **KEPT (CONFIRMED)** — negative result: no weight change flipped any termination; scaffold set separates all six arcs legibly (ADR-0011 D-24) | §2, §8 |
| revisionThreshold 0.5 | engine, inert | **KEPT (INERT)** — recorded as inert (RD-5): no runtime consumer, revision machinery deferred (ADR-0011 D-24) | §6 |
| Crystallizer minima 2/3 | engine module-locals | **KEPT (MEASURED-ONLY)** — untunable per-run; no anomaly attributable to the values (ADR-0011 D-24) | §5 |
| reviewEveryPulses 10 | server default (world-evaluator.ts:119) | **KEPT (CONFIRMED)** — no change indicated; cadence is capture resolution, review-domain outcomes identical (ADR-0011 D-24) | §3 |
| offerAcceptPulses 0 | server default (world-evaluator.ts:123) | **KEPT (CONFIRMED)** — behavior matches the knob's name; default 0 gives the tightest arc (ADR-0011 D-24) | §4 |
| meaning-made 0.33 | server constant (world-evaluator.ts:643) | **NOT TUNED — routed to follow-up issue #106** — outside the RD-4 matrix; tuning without evidence rejected (ADR-0011 D-25) | §7 |

Finalized under the Step 3.5 lock: every verdict row above is locked (CONFIRMED/KEPT per this
slate); the G4 exception is granted-and-unexercised (engine diff empty — no numeric change
warranted); the durable decision record is [ADR-0011](../../adr/0011-goal-layer-threshold-calibration.md)
(D-24..D-25).

## 11. Issue #106 — meaning-made gate dedicated sweep (2026-08-27)

Freshness-dated addendum: measured on branch `feat/goal-layer-meaning-made-gate-106` @
b7a540e (a stack on this record's calibration branch), through the same mock-only harness
(version `goal-layer-sweep-v1`, mode `mock`, pulse cap 120). The gate's ceiling now
travels through `goalLayer` config (`ending.meaningMadeMaxDivergence`, default 0.33 —
[ADR-0012](../../adr/0012-goal-layer-meaning-made-gate.md) D-29). The dedicated grid is
5 ceilings (0.25/0.30/0.33/0.36/0.40) × 3 gate-relevant arcs (healthy-achiever /
world-briefly-wrong / hollow-completion) × 2 cadences (1/10) = 30 cells, appended to the
#96 grid in the same CLI (50 cells total). Committed artifact:
[evidence/meaning-made-gate-sweep-2026-08-27.json](evidence/meaning-made-gate-sweep-2026-08-27.json)
— zero wire calls in 50/50 cells, byte-identical re-run (md5 `b3b74ad9ea02…`), and the 20
#96 cells field-identical to §9's artifact: the grid append perturbs nothing.

### 11.1 Termination matrix (the decisive grid)

| Arc | Cadence | 0.25 | 0.30 | 0.33 | 0.36 | 0.40 |
| --- | --- | --- | --- | --- | --- | --- |
| healthy-achiever | 1 | continue @6 | reached @4 | reached @4 | reached @4 | reached @4 |
| healthy-achiever | 10 | continue @51 | continue @51 | reached @31 | reached @31 | reached @31 |
| world-briefly-wrong | 1 | continue @6 | continue @6 | reached @5 | reached @5 | reached @5 |
| world-briefly-wrong | 10 | continue @51 | continue @51 | reached @41 | reached @41 | reached @41 |
| hollow-completion | 1 | cap @120 | cap @120 | cap @120 | cap @120 | cap @120 |
| hollow-completion | 10 | cap @120 | cap @120 | cap @120 | cap @120 | cap @120 |

`reached` = the earned `goal_end_offered`; `continue` = the arc never receives an ending
(the gate rejected its flip; the reached-but-unearned verdict re-goals and the run stops
early without an offer — `evaluateEndCondition`'s "world verdict reached but completion is
un-earned" branch); `cap` = pulse-cap-stop at 120.

### 11.2 Gate consultations at 0.33 (flip margins)

| Arc | Cadence | Flip divergence (gate-consulted) | Margin under 0.33 | Pre-flip reviews (not gate-passing) |
| --- | --- | --- | --- | --- |
| healthy-achiever | 1 | 0.252874 | 23.4% | 0.326087 (continue) |
| healthy-achiever | 10 | 0.300000 | 9.1% | 0.315603 (continue) |
| world-briefly-wrong | 1 | 0.307087 | 6.9% | 0.326087, 0.376471 (ratified-contested window) |
| world-briefly-wrong | 10 | 0.309883 | **6.1% (tightest)** | 0.315603, 0.324201 |

### 11.3 Findings

- **False-reject is the gate's real failure mode.** 0.25 rejects all four terminating
  cells; 0.30 rejects three of four — world-briefly-wrong at both cadences (flips
  0.307087/0.309883) and healthy-achiever at cadence 10, whose flip (0.300000) sits
  exactly at the ceiling and the comparison is strict `<`. A rejected flip does not
  delay the ending — it deletes it: the arc stops at 6/51 pulses with termination
  `continue` and no `ending_offered` ever emitted.
- **0.33 is the minimum calibrated-safe ceiling.** Every terminating cell reaches at the
  calibrated pulse counts (healthy 4/31, wbw 5/41); tightest gate-decisive margin 6.1%
  (the §7 headline "7%" was the cadence-1 flip; the dedicated grid measured the
  cadence-10 flip tighter).
- **Zero false-accept measured.** 0.36/0.40 cells are identical to 0.33 in every field
  except the cell label. Structural reason: `deriveMeaningMade` requires
  `determination === "reached"` before the divergence comparison, so the
  ratified-contested-window samples (0.376471 at cadence 1, 0.324201 at cadence 10)
  consult and fail the gate on the determination clause regardless of ceiling;
  hollow-completion's divergenceFromLog (0.660→0.961 at cadence 1, 0.909→0.926 at
  cadence 10) sits far above every tested ceiling.
- **The measured class separation is wide.** Genuine-completion flips top out at
  0.309883; the hollow band starts at 0.660377 — 0.33 sits inside that dead zone, and
  any value in (0.31, 0.66) behaves identically on this grid.
- **Verdict (D-29): 0.33 confirmed — negative result is the outcome.** No evidence
  warrant to move the value; the scaffold value carries a 6.1% margin floor on the tight
  side and maximal measured distance from the hollow band. Recorded in
  [ADR-0012](../../adr/0012-goal-layer-meaning-made-gate.md).