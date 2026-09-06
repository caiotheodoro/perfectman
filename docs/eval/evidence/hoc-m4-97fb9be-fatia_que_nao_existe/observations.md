# M4 milestone: three scenes × seeds 42/43/44 on the short-memory + consult-instrumented head

Arm: `feat/hold-consult-instrumentation` (`97fb9be`, #188 on #187 on #184 …). Generator `deepseek/deepseek-v4-flash`, jury GLM / Qwen / DeepSeek, 32 pulses, canonical variant, one bench per scene with `--seeds 42,43,44`; 109 min total. Sibling directories `hoc-m4-97fb9be-*`; each holds one scene × three seeds, so its `grades.json` scene grade is the median over seeds.

## Grades

| scene | s42 | s43 | s44 | scene (median) | what held it |
| --- | --- | --- | --- | --- | --- |
| `hoc_fatia_que_nao_existe` | B | B | B | **B** | creativity 3 on every seed; no chosen silence on 2 of 3 |
| `hoc_heranca_do_sitio` | B | A- | F | **B** | s44: Rafa said "empréstimo" in `#família` at p7; s42 no private channel |
| `hoc_banda_no_festival` | A- | F | A- | **A-** | s43: Dudu said "o dono da casa" in `#banda` at p14 |
| round (worst scene) | | | | **B** | |

Fallbacks are 0 in all nine runs (2–12 runaway turns per run repaired, #184). Two leaks in nine runs, both mid-scene under direct pressure; the F rule stands as decided.

## Axis means over three seeds (jury median per run)

| axis | Fatia | Sítio | Banda |
| --- | --- | --- | --- |
| in_character | 4.00 ± 0 | 4.33 ± 0.58 | 4.00 ± 0 |
| motive_authenticity | 4.00 ± 0 | 4.67 ± 0.58 | 4.33 ± 0.58 |
| creativity_unhinged | **3.00 ± 0** | 4.00 ± 0 | 4.00 ± 0 |
| memory_continuity | 4.00 ± 0 | 4.67 ± 0.58 | 4.00 ± 0 |
| mask_integrity | 4.00 ± 0 | 4.67 ± 0.58 | 4.00 ± 0 |
| objective_pursuit | 4.00 ± 0 | 4.67 ± 0.58 | 4.00 ± 0 |
| narrative_cohesion | 3.67 ± 0.58 | 4.00 ± 0 | 4.00 ± 0 |

Creativity on Fatia is 3 on all three seeds with zero spread: a scene property, not jury noise (decision recorded for N5 below). GLM failed on 4 of 9 runs (Fatia s42/s43, Sítio s42/s44), leaving 2-voter medians there.

## Calibration against the drafted golden labels (#190)

Jury medians (median over seeds per scene) against the hand-read entries: **kappa 0.63, alpha 0.77, 3 scenes, 9 axis pairs — FAIL against 0.7**, but the first real verdict these scenes have had (single-scene runs report `no_data` by construction; computed across the three directories with the same `calibrateJudge`). The gap is the hand read scoring Sítio's mask/objective/motive at 5 where the jury sits at 4.67, and Banda's in_character/mask at 3 where the jury gives 4. Labels stay pending human review.

## Consults and silences (first read with #188 instrumentation)

| | Fatia | Sítio | Banda |
| --- | --- | --- | --- |
| hold consults (total / voiced / broke) | 0/0/0, 0/0/0, 0/0/0 | 0/0/0 ×3 | 1/1/0, 2/2/0, 0/0/0 |
| chosen silences (model `no_op` with its own motive) | 0, 1, 0 | 0, 0, 0 | 1, 3, 0 |

The consult trigger (salient foreign event, no act on the previous pulse, refractory 4) fired three times in nine runs — and every time the model voiced the hold. Fatia s43's silence (Marcela, p4, leaving Íris's invitation unanswered) came on an ordinary act turn. Decision for N4: widen the trigger — any new event instead of a salient one, refractory 3.

## Memory writes: still zero, and now root-caused

`memoryProposals` is `{accepted: 0, dropped: 0}` in all nine runs: the short contract (#187) produced nothing either. A direct probe of `deepseek/deepseek-v4-flash` through the router with the real field contract and JSON schema explains it: under `response_format: json_schema` the model ran to the token cap (3,732 chars, `finish_reason: length`, unparseable); under `json_object` and under no response format it answered in 538–626 chars with `memoryWrites: [{"summary": "O Rafa desviou de novo quando falei sobre a matrícula.", "about": ["rafa"]}]`. Schema mode is on for the DeepSeek path (`localLLMConfig` never sets `responseFormatJsonSchema: false`), so every intent call has been constrained-decoded — the likely source of the runaway responses as well as the missing proposals. Next PR: `json_object` for deepseek-v4, then a re-read.

## Private channels

Used in 8 of 9 runs (7–29 private lines); the two misses are Fatia s42 and Sítio s42. ADR-0017 D-61 holds across seeds.

## Next

1. `responseFormatJsonSchema: false` for deepseek-v4 (json_object mode); one-scene confirmation read for memory writes and runaway count.
2. N4: voiced-hold trigger widened (`hasNewEvents`, refractory 3), ADR-0017 amended.
3. N5: Fatia creativity is a scene property — tune the cast heat (moods, intros, a live deadline for Bruno's rival) in scene data, then re-read.
4. Golden labels: maintainer review of #190; the kappa 0.63 read is the baseline for that review.
