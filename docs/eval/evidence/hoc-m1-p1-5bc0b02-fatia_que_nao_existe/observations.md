# M1: prompt round 1 read (template `2imp7w`), compared with M0 main

Same three scenes, seed 42, 32 pulses, canonical variant, same jury and generator as M0 (`hoc-m0-baseline-9478a6c/observations.md`). Arm: `feat/prompt-round-1` (`5bc0b02`, #178) = M0 main + prompt round 1: silence framed as a move, Portuguese pin with Portuguese exemplars, ungated risk with the generic-reply list, memory writes on belief change, memories trimmed last. One bench per scene; sibling directories `hoc-m1-p1-5bc0b02-*`. 42 min total.

## Grades

| scene | M0 main | M1 P1 | gate / misses on M1 |
| --- | --- | --- | --- |
| `hoc_fatia_que_nao_existe` | B (3.91, 75%) | **F** (4.02, 88%) | `fallback-rate` 0.08 (4 no-JSON responses); creativity 3; no chosen silence |
| `hoc_heranca_do_sitio` | F (3.87, 71%) | **F** (4.71, 57%) | Lia said "já gastei" in `#família` at p25; no private channel; no chosen silence |
| `hoc_banda_no_festival` | A- (3.96, 89%) | **F** (4.09, 78%) | `fallback-rate` 0.07 (5 no-JSON, 1 empty visibleContent); no private channel; no chosen silence |

Round: F → F. Jury means went up in all three scenes (3.91→4.02, 3.87→4.71, 3.96→4.09); every M1 run then failed a hygiene gate. Sítio and Banda verdicts have 2 voters on M1: GLM returned a JSON fragment 48 characters long and was dropped (the 8000-token budget did not fix it; the response was cut, not exhausted).

## What prompt round 1 changed

| | Fatia | Sítio | Banda |
| --- | --- | --- | --- |
| motives in English | 18/57 → **0/46** | 13/55 → **0/56** | 22/107 → **0/85** |
| model-chosen `no_op` with a real motive | 0 → 0 | 0 → 0 | 0 → 0 |
| `memory_written` | 0 → 0 | 0 → 0 | 0 → 0 |
| lines / engine holds | 55 / 71 → 45 / 78 | 57 / 36 → 59 / 39 | 103 / 50 → 86 / 69 |
| private-channel lines (channels opened) | 6 (3) → 6 (2) | 0 (1) → 0 (0) | 2 (5) → 0 (0) |
| fallbacks (+ recovered) | 0 (+3) → 4 (+3) | 5 (+1) → 1 (+8) | 3 (+6) → 6 (+10) |
| creativity_unhinged | 4 → 3 | 4 → 4 | 4 → 4 |

- **The language pin worked completely**: zero English motives in 187 model motives.
- **Silence did not move.** Every `no_op` the model returned was a parse fallback; not one motivated silence in six runs across M0 and M1. The prompt lever is spent; the design's Stage E (engine consults the model on a hold when addressed or a salient foreign event lands) is now due.
- **Memory writes did not move.** `memoryWrites` stays empty in every intent. The proposal path (`intent-resolver.ts` `memoryProposalEvents`) is live and the mock provider exercises it; the model is not filling the seven-field contract. Needs its own diagnosis (a smaller contract, or an example write in the profile language).
- **Private channels regressed further** (M0 main 3/1/5 opened → M1 2/0/0). The engine's private-channel drive is being discharged and cooled like any other urge; on the pre-engine baseline the same scenes opened 8/6/12. Engine item, not prompt.
- **Creativity fell to 3 in Fatia** despite the ungated instruction; n=1, and the jury's own spread on that axis is ±0.6.
- **Forbidden phrase on Sítio** ("já gastei", Lia, p25): the first leak on the rebuilt scene, 25 pulses in, under direct pressure from Nina — which is the scene's design working; the gate treats any leak as F. Whether a late leak under the breaking point should be an F or a mask_integrity deduction is a grading question to settle with more seeds.

## Blocking: the generator's no-JSON responses

11 of ~230 model calls on M1 (and 6 on M0 main) came back without a JSON object ("No JSON object found in response"), each counted as a fallback; at 0.05 the `fallback-rate` gate fails on 3–6 per scene. Nothing records what DeepSeek actually returned — the parser throws on the cleaned text and the raw response is dropped. Until the raw head is captured on `llm_failure` and kept in the evidence record, this cannot be attributed (empty content, reasoning leak, prose, or truncation) and every read will keep failing the gate on it. That capture is the next PR, ahead of Stage E.

## Attribution and caveats

- n = 1 per scene. The axis means moving up by 0.1–0.8 is inside jury noise (Sítio's 4.71 is a 2-voter median again).
- M0 main and M1 differ only by #178 (prompt) — same engine, same scenes, same jury file, same seed.
- Structural counts (English motives, silences, memory writes, channels) are large enough to read; grades are not.
