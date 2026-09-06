# M3: packet rebuilt from runaway responses (#184), compared with M2

Same three scenes, seed 42, 32 pulses, canonical variant, same jury and generator. Arm: `fix/agent-truncated-json-repair` (`49d14c5`, #184 on #183) = M2 + the parser rebuilding a packet from a response whose JSON never closed, recorded as `llm_retry_recovered` (`truncated_json`). One bench per scene, `hoc-m3-t-49d14c5-*`, 33 min.

## Grades

| scene | M2 E | M3 T | on M3 |
| --- | --- | --- | --- |
| `hoc_fatia_que_nao_existe` | F (4.02, 88%) | **B** (3.93, 75%) | 3 runaway turns repaired, 1 fallback (0.02, under the gate); creativity 3; private channel opened but unused; no chosen silence this seed |
| `hoc_heranca_do_sitio` | A- (4.13, 86%) | **A-** (3.96, 86%) | 0 fallbacks; only Rafa's chosen silence missing |
| `hoc_banda_no_festival` | A- (3.87, 89%) | **A-** (4.13, 89%) | 1 fallback; only Kai's chosen silence missing |
| round | F | **B** | first round above F |

All three verdicts have 3 jurors. Round grade is the worst scene, so Fatia's creativity 3 and missing silence hold it at B.

## What #184 changed

- The `fallback-rate` gate no longer decides a grade: Fatia went from 4 fallbacks (0.09) to 1 (0.02) with 3 turns repaired — messages the model had finished writing before it ran away, kept instead of discarded.
- Nothing else in the engine or prompt changed between M2 and M3. Private channels: Fatia 0→1 opened (3 private lines), Sítio 3→2, Banda 3→5, 15–16 private lines — the ADR-0017 drive holds. Chosen silence: 1 (M2 Fatia) → 0; one voiced silence in twelve runs says the consult fires rarely (salient event + no act last pulse + refractory) and the model mostly breaks the hold when consulted.
- `memory_written` is 0 in every read to date; the seven-field `memoryWrites` contract is never filled by DeepSeek.

## Where the ladder sits after seven reads (seed 42)

| read | Fatia | Sítio | Banda |
| --- | --- | --- | --- |
| M0 baseline (pre-engine) | F | A- | F |
| M0 main | B | F | A- |
| M1 prompt round 1 | F | F | F |
| M2 voiced hold + cap | F | A- | A- |
| M3 runaway repair | B | A- | A- |

Every remaining miss is now a thesis signal or a single axis, not a gate: chosen silence (3 scenes), creativity on Fatia, memory writes (all). Next levers, in order: a `memoryWrites` shape the model will fill; a wider voiced-hold trigger if the M2 milestone still shows silence at 0–1; golden labels for the three scenes drafted from these transcripts for human review; then the 3-seed milestone.
