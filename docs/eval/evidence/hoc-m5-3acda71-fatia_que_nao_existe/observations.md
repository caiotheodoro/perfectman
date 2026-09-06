# M5: full stack read — json_object for deepseek-v4, wider voiced-hold trigger, Fatia cast heat

Arm: `feat/hoc-fatia-heat` (`3acda71`, #194 on #193 on #192 …); graded with the act-share gate at monopoly level (#195). Seed 42, 32 pulses, canonical variant, jury GLM / Qwen / DeepSeek, one bench per scene. `hoc-jo-86a56d4-heranca_do_sitio` is the one-scene confirmation of #192 that preceded it.

## Grades

| scene | grade | mean | signals | jurors | miss |
| --- | --- | --- | --- | --- | --- |
| `hoc_fatia_que_nao_existe` | **A-** | 4.36 | 88% | 3 | no private-channel message this seed |
| `hoc_heranca_do_sitio` | **A-** | 4.54 | 86% | 2 (GLM empty) | no private-channel message; act-share 0.57 recorded, under the gate |
| `hoc_banda_no_festival` | **A** | 4.34 | 100% | 3 | — |
| round (worst scene) | **A-** | | | | |

First round above B; first A on any scene. Fallbacks 0, runaway turns 0, target-resolution retries 0 in all three.

## What moved, and why

| | Fatia | Sítio | Banda |
| --- | --- | --- | --- |
| creativity_unhinged | 3 → **4** | 4 | 4 |
| memory writes | 0 → **32** | 0 → **17** | 0 → **48** |
| hold consults (voiced / total) | 0 → **6 / 8** | 0 → **5 / 5** | 1 → **8 / 10** |
| model-chosen silences | 0 → **9** | 0 → 9 | 1 → 11 |
| mask / objective | 4 / 4 → **5 / 5** | 5 / 5 | 4 / 5 |

- `json_object` instead of `json_schema` (#192) removed every runaway turn and every parse fallback, and let the model fill `memoryWrites` — 17–48 per scene, judged `memory_continuity` 4–5.
- The widened consult (#193, D-62) fires 5–10 times per scene and the model voices the hold most of the time (19 of 23); chosen silence now passes everywhere.
- Fatia's creativity moved 3 → 4 with the cast heat (#194), with mask and objective at 5 — seed 42 only; the M4 spread on that axis was zero, so one read is a real signal but not a settled one.
- The remaining miss is the private channel in Fatia and Sítio this seed (Banda used both rooms). Sítio's act share (Lia 21 of 37 lines, Rafa 9 voiced silences) is what the #195 gate change is for.

## Caveats

n = 1 per scene. GLM dropped on Sítio (2-voter median). Memory summaries repeat within a run (Lia p2/p4 in the confirmation read); #157's reinforcement may absorb this, otherwise a proposal dedupe is the next small fix. Golden labels (#190) remain pending the maintainer's review.
