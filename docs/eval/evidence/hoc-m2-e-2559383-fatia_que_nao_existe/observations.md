# M2: voiced hold + private drive (ADR-0017) + DeepSeek runaway cap, compared with M1

Same three scenes, seed 42, 32 pulses, canonical variant, same jury and generator as M0/M1. Arm: `feat/engine-voiced-hold` (`2559383`, #183 on top of #182 and #181) = M1 prompt round 1 + the voiced-hold consult, the private-channel drive spent only by `create_channel`, forensics on `llm_failure`, and deepseek-v4 capped at 2500 output tokens with a 0.6 frequency-penalty floor. One bench per scene; sibling directories `hoc-m2-e-2559383-*`. 33 min total.

The three forensic single-scene reads that led here are committed alongside: `hoc-f0-b3d4559-fatia_que_nao_existe` (raw head only), `hoc-f1-6bb9f0e-heranca_do_sitio` (raw head, three failures of 26–27k chars), `hoc-f2-4e58e16-heranca_do_sitio` (on the cap: A-, two failures of 5.6–7.3k chars with the loop visible in `rawTail`).

## Grades

| scene | M1 P1 | M2 E | what decided it on M2 |
| --- | --- | --- | --- |
| `hoc_fatia_que_nao_existe` | F (4.02, 88%) | **F** (4.02, 88%) | `fallback-rate` 0.09 (4 runaway responses of 4.6–6.4k chars); creativity 3; no private channel |
| `hoc_heranca_do_sitio` | F (4.71, 57%) | **A-** (4.13, 86%) | only Rafa's chosen silence missing |
| `hoc_banda_no_festival` | F (4.09, 78%) | **A-** (3.87, 89%) | only Kai's chosen silence missing |

Round F → F (worst scene). Two scenes at A- is the best read so far. All three verdicts have 3 voters.

## What ADR-0017 changed

| | Fatia | Sítio | Banda |
| --- | --- | --- | --- |
| private-channel lines (channels opened) | 6 (2) → 0 (0) | 0 (0) → **4 (3)** | 0 (0) → **16 (3)** |
| model-chosen silence with a real motive | 0 → **1** | 0 → 0 | 0 → 0 |
| engine holds | 78 → 84 | 39 → 40 | 69 → 62 |
| lines | 45 → 40 | 59 → 55 | 86 → 95 |
| LLM calls | 50 → 44 | 57 → 56 | 87 → 98 |
| fallbacks (+ recovered) | 4 (+3) → 4 (+5) | 1 (+8) → 1 (+4) | 6 (+10) → 0 (+14) |
| `memory_written` | 0 → 0 | 0 → 0 | 0 → 0 |

- **The private drive is back** where the scene has a reason for it: Sítio (no pre-made room) now opens three channels, all Rafa's, and uses them; Banda's overlapping rooms carry 16 lines. Fatia opened none this seed.
- **The first voiced silence** in ten reads: Marcela, p4, "Deixar a pergunta do Íris no ar. Ele quer que eu peça o PDF pra provar que não estou escondendo nada — mas se eu peço…". The consult fired on other held pulses too, and the model broke the hold rather than voice it — call counts barely moved (44/56/98 vs 50/57/87), so the refractory and the salient-event gate are holding the cost down as intended, at the price of few consults.
- **Runaway responses are cheaper but not gone**: 4.6–7.3k chars instead of 25–27k, still 4 in Fatia. The loop is the model appending sign-offs, emoji runs or numbered "edit" lines after a complete message and never closing the string. #184 rebuilds the packet from the closed fields and records the turn as a recovery; the M3 read on it follows.
- **Memory writes are still 0.** Unchanged across every read; the `memoryWrites` contract is never filled. Own item.
- Jury: Sítio dropped from 5s to 4s between M1 and M2 — M1's Sítio verdict was a 2-voter median (GLM dropped); the 3-voter reads sit at 4.

## Attribution and caveats

- n = 1 per scene. Structural counts (private lines, channels, silences, fallbacks) are readable; axis means are not.
- M2 differs from M1 by #181 (forensics, no behavior), #182 (cap and penalty) and #183 (ADR-0017); the private-channel and silence movement is #183, the shorter runaways are #182.
