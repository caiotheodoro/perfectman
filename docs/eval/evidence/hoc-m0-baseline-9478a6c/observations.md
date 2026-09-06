# M0: hidden-objective read, pre-engine baseline vs current main

First measured read of the three rebuilt hidden-objective scenes (`docs/eval/hoc-experiment-protocol.md`, `docs/superpowers/specs/2026-09-05-hoc-score-refinement-design.md`). Generator `deepseek/deepseek-v4-flash` via OrcaRouter, seed 42, 32 pulses, canonical variant (`--variants 1`), jury `z-ai/glm-5.3-flash` / `qwen/qwen3.8-27b-free` / `deepseek/deepseek-v4-flash`, template `hn81j7` in both arms.

Arms, both carrying the identical measurement stack (#173–#176 cherry-picked):

- **baseline** `9478a6c` = `3cc7a78` (stack top below the engine PRs #169–#172) — this directory, one bench for the three scenes, 59 min.
- **main** `5ec8d58` = `feat/hoc-scenes-distinct` (engine PRs in, #152/#157 in) — three sibling directories `hoc-m0-main-5ec8d58-*`, one bench per scene so a killed process loses one scene, 37 min total. The first attempt as a single bench was killed by the machine's low-memory guard an hour in with nothing written.

## Grades

| scene | baseline | main | what decided it |
| --- | --- | --- | --- |
| `hoc_fatia_que_nao_existe` | **F** (mean 4.05, signals 63%) | **B** (mean 3.91, signals 75%) | baseline: Bruno said "carteira de clientes" and Marcela "ex-sócio" in `#geral` at p8 — spoken forbidden phrase is an F gate. main: no private-channel message, no chosen silence |
| `hoc_heranca_do_sitio` | **A-** (mean 4.71, signals 86%) | **F** (mean 3.87, signals 71%) | main: 5 of 60 model calls returned no JSON → `fallback-rate` 0.083 over the 0.05 gate; no private channel opened until p31, unused; no chosen silence |
| `hoc_banda_no_festival` | **F** provisional (mean 3.96, signals 89%) | **A-** (mean 3.96, signals 89%) | baseline: 12 fallbacks, `fallback-rate` 0.075, one juror (Qwen's free tier rejected the 137-line transcript, GLM empty); main: only chosen silence missing |
| round (worst) | F | F | |

Jury: baseline verdicts have 2 voters (GLM returned empty content at a 4000-token budget in all three scenes; fixed to 8000 in #174 before the main arm), main verdicts have 3. Sítio's 5s under two jurors became 4s under three; GLM's vote sits a point below the other two on most axes. Treat the axis deltas between arms as jury-composition noise, not engine effect; the structural counts below are the comparison.

## What the engine changed (baseline → main)

| | Fatia | Sítio | Banda |
| --- | --- | --- | --- |
| public+private lines in 32 pulses | 116 → 55 | 91 → 57 | 137 → 103 |
| lines in private channels | 55 → 6 | 37 → 0 | 48 → 2 |
| private channels opened | 8 → 3 | 6 → 1 | 12 → 5 |
| engine holds (delay/cooldown) | 0 → 71 | 0 → 36 | 0 → 50 |
| model-chosen `no_op` with a real motive | 0 → 0 | 0 → 0 | 0 → 0 |
| `memory_written` | 0 → 0 | 0 → 0 | 1 → 0 |
| motives in English (of model motives) | 37/123 → 18/57 | 37/94 → 13/55 | 45/148 → 22/107 |
| fallbacks (+ recovered by retry) | 1 (+5) → 0 (+3) | 1 (+2) → 5 (+1) | 12 (+11) → 3 (+6) |
| act-share-max | 0.27 → 0.42 | 0.37 → 0.39 | 0.20 → 0.29 |
| wall time | 12.3 → 5.2 min | 9.0 → 9.5 min | 25.4 → 12.8 min |

Baseline is the chatter the engine PRs were built against: every agent acts every pulse (4 × 32 ≈ 128 lines), private channels are opened compulsively (Banda: 12) and used as a second public room. Main halves the traffic and holds agents back 36–71 times per scene, at the cost of private talk almost disappearing: `private_channel_used` fails in 2 of 3 main scenes, and the one channel Sítio opens comes at p31. The forbidden-phrase leak in baseline Fatia (two agents at p8, the same pulse) does not recur on main.

## What neither arm does

- **Chosen silence is 0 in all six runs.** Every hold is engine-decided (`strategic_patience_hold`, cooldowns); the model, when consulted, never returns `no_op` with a motive. Prompt round 1 (#178) reframes `no_op` as a move; if M1 still reads 0, the engine consults the model on a hold (Stage E in the design spec).
- **No memory is written** (5 of 6 runs), so `memory_continuity` is judged on seeded memories alone. #178 relaxes the write instruction and trims memories last.
- **A fifth to a third of motives are English** inside Portuguese scenes; the exemplars in the output contract were English. #178 pins both fields and translates the exemplars.
- **Parse failures on the generator**: "No JSON object found in response" 5 times in main Sítio (Lia ×3, Nina, Rafa), 12 times in baseline Banda. These count as fallbacks and trip the `fallback-rate` gate; they are a transport/output-budget question on DeepSeek, not a scene property. Open item.

## Attribution and caveats

- n = 1 seed per scene per arm. Nothing here is significant; the structural counts are large enough to read, the axis means are not.
- The two arms differ in eval by #152 (`finalStates` counts, `persona-aware-mock`, `evidence.ts`) — none of it on the generation or judging path.
- Baseline `hoc_heranca_do_sitio` at A- with 2 jurors is the best single run so far and worth reading by hand for what the scene does when the room is allowed to talk.
- `hoc-treatment-9a14eb4-one-scene/` is the validation run that preceded this read: Fatia only, old jury (GLM at 1500 tokens, dropped), template `hn81j7`, engine PRs in; it grades A- under the ladder.

## Next

M1 = the same three scenes and seed on `feat/prompt-round-1` (template `2imp7w`), single-scene benches, compared against the main arm above. Milestone M2 is 3 seeds × 3 scenes; golden labels for the three scenes are drafted from these reads and stay "pending human review" until approved.
