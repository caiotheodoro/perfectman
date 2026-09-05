# Hidden-objective score refinement — design

Status: approved 2026-09-05. Companion to `docs/eval/hoc-experiment-protocol.md`.

Previous round (measurement + engine stack, PRs #158–#172) is merged to `main`. One real run of `hoc_fatia_que_nao_existe` (seed 42, DeepSeek v4 flash, Qwen + DeepSeek jury) scored 9 of 10 transcript axes at target, creativity 3, narration 3/3/4/3/4, chosen_silence 0/1. Evidence: `docs/eval/evidence/hoc-treatment-9a14eb4-one-scene/` (uncommitted, branch `exp/hoc-treatment`).

## Context

Goal: a letter grade (A+ … F) per scene and per round, and a refinement loop that moves the three hidden-objective scenes to A/A+ without gaming the judge. The run exposed four causes, all verified in code (file:line in the exploration notes below):

- Silence is never offered as a move. `no_op` renders as a bare option (`action-intent-prompt-builder.ts:467-491`); the only prose is "or choose no_op if you truly have nothing new to add" (`action-intent-step.ts:42`). All 76 holds in the run were engine-decided with no model consulted.
- Motive language is unpinned. Only "Primary Language: Portuguese" in identity (`:310-315`); the two example motives in the Ensure bullet (`:374`) and the whole output contract are English. 21/50 motives came out in English.
- Creativity has one instruction, gated on "when there is real pressure" (`:506-512`), which the model adjudicates itself. No anti-generic wording exists.
- Memory writes are suppressed ("only when this exchange actually matters, leave empty", `:378`) and memories are the first thing trimmed under token pressure (`:200-204`).

The judge itself is thin: three-sentence system prompt (`judge.ts:276-290`), no evidence field, omitted axes silently become 3 (`parseAxes :354-361`), rubric `weight`s are consumed nowhere, GLM juror returns empty content at 1500 tokens. The three hoc scenes are structurally one scene (same 4 packs, same resource shape, same channel topology, identical golden labels marked "pending human review"), so scores across them are correlated and calibration cannot produce a verdict (needs >1 matched scene per axis, `calibration.ts:155`).

## Decisions (grilling rounds 1–2, all accepted 2026-09-05)

- Grade inputs: transcript jury axes (rubric weights), thesis signals, narration axes at half weight in the weighted mean; probes `fallback-rate`, `act-share-max` and any spoken forbidden phrase are hygiene gates → F.
- Scale: A+ every transcript axis ≥ 4.5 and signals 100%; A every axis ≥ 4.0 and signals 100%; A- at most one axis below 4.0 or unscored, none below 3.0, weighted mean ≥ 3.8, signals ≥ 83% (with the rest at 4.0 a single 3.5 lands the mean near 3.9, so a 4.0 mean floor made A- unreachable); B mean ≥ 3.5; C ≥ 3.0; D ≥ 2.5; F below or gate failed. Imputed axes excluded from the mean and cannot satisfy a minimum. "provisional" when juryVoterCount < 2 or salvaged. Per run, per scene (median over seeds), per round (worst scene). Thresholds tuned after the first 3-seed read, not before.
- Allowed levers: prompt, engine, scenario data. Judge changes only for reliability (evidence field, abstention on omitted axes, per-juror maxTokens, weights in the roll-up). Anchors untouched; the concreteness bias stays recorded in calibration output.
- Generator stays `deepseek/deepseek-v4-flash` (OrcaRouter, key via `PERFECTMAN_LLM_API_KEY` in the shell only). Jury: GLM-5.3-flash (maxTokens 4000), Qwen3.8-27b (no-think), DeepSeek (flagged).
- Motives and speech pinned to Portuguese when the profile language is pt-BR; exemplars rendered in the profile language.
- Silence: prompt reframe first; engine "consult the model on a hold when addressed" only if chosen_silence stays 0 after the read.
- Creativity gate removed; anti-generic list added. Memory writes relaxed; memories trimmed last.
- Three scenes rebuilt to differ structurally (below). Golden labels: I draft per scene with a rationale line after the first read; user approves in chat.
- Budget: 3 scenes × 1 seed per iteration (~20 min); 3 × 3 at milestones and for the baseline comparison. Baseline arm (`exp/hoc-baseline`, pre-engine code) runs once on the new scenes.
- Order: fix the instrument first (judge reliability, grade CLI, scenes), measure baseline and current main, then agent-side changes, one PR per stage, no merges by the agent. Stage J lands before G because G's provisional rule reads J's per-axis voter counts and the grade must never see an imputed 3.

## Roadmap

| # | PR | Package | What |
|---|---|---|---|
| J | judge reliability | shared, eval | evidence field, imputed axes excluded, per-axis voter counts, per-entry `maxTokens`, GLM at 4000 |
| G | grade module + CLI | eval | pure `gradeRun`/`gradeScene`/`gradeRound`, `grade` CLI over an evidence dir, bench prints/stores grades (needs J's `imputedAxes`/voter counts in evidence) |
| S | three distinct scenes | shared, eval | Sítio and Banda rebuilt (below), golden labels drafted, hoc slice unchanged |
| M0 | measurement read | docs | baseline arm + current main, 3 scenes × 1 seed each, grades committed |
| P | prompt round 1 | server, shared | silence as a move, Portuguese pin + exemplars, creativity ungated + anti-generic, memory writes relaxed + trimmed last |
| M1 | read after P | docs | 3 × 1, grades; if chosen_silence still 0 → E |
| E | engine consult-on-hold | engine, server | model consulted on `delay` when addressed or salient foreign event; only if M1 says so |
| M2 | milestone | docs | 3 × 3, per-scene grades, golden labels approved, calibration verdict |

## Stage J — judge reliability (lands first)

- `packages/eval/src/judge/judge.ts`: `LLMJudgeConfig` (:251-257) gains `maxTokens?`; `callJudge` (:339) uses `config.maxTokens ?? 1500`, `callNarrationJudge` (:533) `?? 1200`, cohesion (:674) stays 800. `buildJudgeSystem` output contract (:288) becomes `{"axes": {...}, "evidence": {"<axisId>": "<quote or [pNN] ref>"}}`. `parseAxes` (:345-364) returns `{ axes, imputedAxes, evidence }`, tolerant when evidence is missing or non-string. `JudgeResult` (:383) and `JuryJuror` (:711-720) carry `evidence?`; `JuryVerdict` (:722-731) gains `evidence` per juror label and `axisVoterCounts` (from the `votes.length` already computed at :828-836), because `voterCount` (:838) is jury-wide and an axis scored by one juror is a single vote, not a median.
- `packages/shared/src/judge/judge-config.schema.ts` (:15-30): `maxTokens: z.number().int().positive().optional()`. `packages/eval/src/llm/judge-config.ts`: `resolveEntry` (:83-97) passes it; add to `KNOWN_JUDGE_KEYS` (:99-110). `examples/eval/hoc-jury.json`: GLM entry `maxTokens: 4000`.
- `packages/eval/src/cli/bench.ts`: the aggregation loop (:310-319) and the calibration map (:307-308) skip imputed axes (today `imputedAxes` is dropped at :282-301 and imputed 3s reach kappa). `perScenario` (:367-386) and the evidence record (:388-404) gain `imputedAxes`, `judgeEvidence`, `juryAxisVoterCounts`; `writeEvidenceRun` jury entries (:562) include `maxTokens`.
- Tests: `judge-json-salvage.test.ts` (evidence parsed; omitted evidence tolerated), `jury-judge.test.ts` (per-axis voter counts; juror evidence carried), `judge-config.test.ts` (maxTokens resolved, undefined when unset, no warning), `hoc-jury-config.test.ts` (GLM 4000), `judge-thinking-disable.test.ts` pattern (maxTokens sent, defaults 1500/1200), `bench-hygiene.test.ts` (imputed axes excluded from means/stats and recorded per scenario). Keep `evidence` optional so the `llmJudge` mocks in `bench-judge-temperature.test.ts:29-36` and `bench-hygiene.test.ts:16-23` stay valid.

## Stage G — grade module and CLI

New `packages/eval/src/grade/grade.ts` (pure, no I/O): `gradeRun(input)` with input `{ axes, imputedAxes, weights, narrativeAxes?, signals: {kind, passed}[], probes: {probe, passed}[], juryVoterCount?, juryAxisVoterCounts?, judgeSalvaged? }` → `{ grade, weightedMean, signalPassRate, hygieneFailures[], minAxis, axesBelow4[], provisional, reasons[] }`. Weights from `HIDDEN_OBJECTIVE_RUBRIC.axes[].weight` (`rubrics.ts:11-108, 322-347`), narrative axes at `weight/2`; imputed or absent axes excluded from the mean and failing any per-axis minimum. Signal kinds per `scenario.types.ts:160-166`, recovered with `JSON.parse(outcome.signal)` exactly as `aggregateSignalsByKind` does (`signal-checker.ts:52-60`). Hygiene gates: probe ids `fallback-rate`, `act-share-max` (`probes/types.ts:79,96`) and any failed `forbidden_phrase_absent`. Provisional when `juryVoterCount` undefined or <2 (rule/mock/single judge included), `judgeSalvaged`, or any graded axis with `juryAxisVoterCounts` <2. `gradeScene(runs)`: median over the ladder index rounding toward the worse grade; provisional if any run is. `gradeRound(scenes)`: worst. Export `GRADE_LADDER`. Must tolerate empty axes/probes/signals (`bench-hygiene.test.ts:77` reaches a hoc variant with an empty mock artifact).

New `packages/eval/src/cli/grade.ts`: `gradeEvidenceDir(dir)` reads `bench-report.json` (perScenario), `scenarios/<id>__s<seed>.json` (name from `bench.ts:389`), `run-meta.json` (gitSha, promptTemplateVersions for provenance); selects hoc runs via `getScenario(baseScenarioId(id)).rubric.id === "hidden-objective-v1"` (`calibration.ts:190-193`); prints and writes `grades.json`. Absent `imputedAxes` in older evidence → `[]`. Script `"grade": "node dist/cli/grade.js"` in `packages/eval/package.json`, export from `packages/eval/src/index.ts`, section in `docs/eval/README.md`. Bench: `BenchReport.grades?`; after the loop (:475) when any selected scenario has the hoc rubric, build inputs from in-memory artifacts; `printReport` (:577) prints the block last; `check-bench-gate.mjs` reads only `scenariosFailed`/`signalPassRate` (:47-55) so the field is inert for the gate. Grade wiring must not touch the jury path in the single-judge configuration `bench-judge-temperature.test.ts` mocks.

Tests: `grade.test.ts` — A+ requires every transcript axis ≥4.5 and 100% signals; A ≥4.0 everywhere; A- one axis in [3.0, 3.5] with signals ≥83%; B/C/D on the weighted mean; F on fallback-rate probe; F on a failed forbidden_phrase_absent; imputed axis excluded and blocks A; narrative axes weigh half; provisional on voterCount <2 or salvaged; scene median rounds down; round is worst; empty inputs grade F-provisional without throwing. `grade-cli.test.ts`: grades a temp copy of `hoc-treatment-9a14eb4-one-scene` (expect A-, reasons "creativity_unhinged 3 < 4", "chosen_silence_present failed") and writes `grades.json`. `bench.test.ts`: grades stored only when a hidden-objective rubric ran.

## Stage J — judge reliability

- `judge.ts`: output contract becomes `{"axes": {...}, "evidence": {"<axisId>": "<quote or [pNN] ref>"}}`; `parseAxes` returns `evidence` (tolerant when absent); `llmJudge`/`juryJudge` results carry `evidence`; `imputedAxes` become abstentions: excluded from `judgeAxisMeans`/`judgeAxisStats` and from the jury median for that axis (median over jurors that scored it; if none, axis absent and flagged).
- `LLMJudgeConfig.maxTokens?`; `JudgeConfigBaseSchema` gains `maxTokens` (positive int); `resolveEntry` carries it; `callJudge` uses `config.maxTokens ?? 1500`, narration `?? 1200`. `examples/eval/hoc-jury.json`: GLM entry `maxTokens: 4000`, plus `KNOWN_JUDGE_KEYS`.
- Evidence records and bench-report store `evidence` per scenario and `abstained` axes per juror.
- Tests: judge-thinking-disable (unchanged), new `judge-evidence.test.ts` (evidence parsed, missing tolerated), `jury-abstention.test.ts` (omitted axis excluded from median; all-omitted axis flagged), `judge-config.test.ts` (maxTokens carried, default preserved), `hoc-jury-config.test.ts` (GLM 4000).

## Stage S — three scenes that differ

Keep `hoc_fatia_que_nao_existe` unchanged (4 agents, shared deal timeline, public + 3-member + 2-member private).

**`hoc_heranca_do_sitio` rebuilt — 3 siblings, public room only, a person as the scarce resource.**
Cast: Lia ← goulart (`active`), Rafa ← bruno (`avoidant`), Nina ← mariana (`active`). No pre-made private channel: any private talk must be opened by an agent. Scarce resource `vo_decisao` (the grandmother's still-unsigned decision on who keeps the house; she is offline and only Lia has her ear). Objectives: Lia wants the house sold fast before the grandmother changes the will (she already took a buyer's deposit); Rafa wants nothing decided until his loan against the house is cleared (constraint: never mention the loan); Nina's objective is informational: make Rafa admit there is a debt, in front of Lia, without asking directly (constraint: cannot accuse; can only create situations). One agent's objective is to expose another's, which Fatia lacks. priorEvents: three messages of history (the grandmother's last message, a months-old fight). Memories: Rafa (self, the loan), Nina (relational, "Rafa avoided the notary twice"), Lia (pending_intention, the deposit). Signals: 3 × forbidden_phrase_absent, private_channel_used min 1 (must be created), memory_referenced (rafa, nina), chosen_silence_present (rafa), event_committed.

**`hoc_banda_no_festival` rebuilt — 5 members, two overlapping private channels, a lurking informant.**
Cast: Vic ← goulart, Bea ← mariana, Dudu ← bruno, Kai ← caio (`lurking`, the label's informant), Léo ← leo (`active`, the drummer who wants the band to stay together and has no secret, the only honest voice). Channels: `#banda` public, `🔒fundadores` (vic, bea, dudu), `🔒grana` (dudu, kai, leo). Overlap means what Dudu says in one room can be tested in the other. Scarce resource `festival_slot` plus a second resource `adiantamento` (the advance) that only Dudu and Kai's objectives touch. Objectives as today for Vic/Bea/Dudu/Kai; Léo's role is pressure without a mask (asks the direct questions everyone else avoids), which stresses mask_integrity from a different angle than Théo's covert probing. Signals: 4 × forbidden_phrase_absent, private_channel_used min 2, memory_referenced (bea, dudu), chosen_silence_present (kai), event_committed.

Casts remain re-skins of the five packs via `castMap` (`hidden-objective-collisions.ts:25-27`); `leo` enters a cast for the first time, so `persona-loader` re-skin tests get a leo case. Golden labels: distinct per scene, drafted after M0 with a rationale line each, header keeps "pending human review" until the user approves. Mock golden gate: hoc scenes run in the weekly mock slice with liveOnly signals skipped; new scenes must keep 100% there (`node scripts/ci/check-bench-gate.mjs`).

## Stage P — prompt round 1 (`action-intent-prompt-builder.ts`, `action-intent-step.ts`, `intent-packet.schema.ts`)

- `renderActions`: `no_op` line gets a description: "stay silent on purpose — a real move; put the reason you are withholding in privateMotiveSummary". `renderDecision`: replace the "or choose no_op" tail with a sentence that withholding, waiting someone out, or refusing to answer is a social act the room notices.
- Language: when `profile.language === "pt-BR"`, an Ensure bullet states both `visibleContent` and `privateMotiveSummary` are in Portuguese, and the two motive exemplars render in Portuguese (`renderEnsure(language)`); English profiles unchanged.
- Creativity: drop the "When there is real pressure…" gate; add "generic replies that count as failure: agreeing and restating, asking a clarifying question instead of taking a position, summarizing what the room already said".
- Memory: `memoryWrites` guidance → "write one line when what you believe about someone changed"; `trimToFit` order → memories trimmed last.
- Where: `renderActions` (:470-474), `renderDecision` (:495-513), `renderOutputContract` Ensure (:373-379) threading `profile.language` (`persona-prompt-profile.ts:27`) with the English branch keeping "uncomfortable" / "petty, insecure, or manipulative" (pinned at `action-intent-prompt-builder.test.ts:55-56`), memoryWrites bullet (:378), `trimToFit` (:163-221) reordered to events → utterances → memories with its doc comment (:144-162) updated.
- `templateVersion` is an FNV hash of the canonical render (:301-307, `prompt-version.ts:7-15`); only stability is tested (`prompt-builder.test.ts:180-196`), so the hash changes without a literal pin. Record the new value next to `hn81j7` (today's `run-meta.json`) in `docs/eval/hoc-experiment-protocol.md` as the treatment marker.
- Tests to update: `action-intent-prompt-builder.test.ts:65-70` ("provoke" / "Playing it safe" pins → new wording), `action-intent-prompt-trim.test.ts:82,133,182` (order assertions invert). Add: describes no_op as deliberate silence; pins pt-BR for both fields with Portuguese exemplars; keeps English exemplars for en profiles; lists the anti-patterns; relaxes memoryWrites to belief change.
- Mock gate stays 100% by construction: `PersonaAwareMockProvider.generateIntent` (`persona-aware-mock.ts:49-92`) reads `input`, never prompt text, and the step passes `input` untouched (`action-intent-step.ts:141`).

## Stage E — engine consult-on-hold (conditional)

Only if M1 shows chosen_silence still 0: in `resolve-decision.ts` `actOrGate`, a `delay` with `addressed || salientForeignEvent` returns `needsLLM: true` with `holdSuggested: true`; the prompt renders "you are inclined to hold; either stay silent with the real reason (no_op) or act". Property test: unaddressed agents still never reach the model on consecutive pulses. ADR-0017.

## Measurement stages

M0: `exp/hoc-baseline` and `main` (both + S, J, G cherry-picked so the instrument is identical), 3 scenes × seed 42, `--limit` per scene = 1 variant, run ids `hoc-m0-baseline-<sha7>` / `hoc-m0-main-<sha7>`; `grade` CLI on both; `observations.md`; artifact page per scene. M1 after P, same seeds. M2: 3 × 3 on the current head, per-scene grade, golden labels approved, calibration verdict (needs ≥2 matched scenes per axis, now satisfiable).

Evidence directories land under `docs/eval/evidence/` (bench writes relative to `packages/eval`, move before commit).

## Verification

Per PR: `pnpm lint`, package vitest, `pnpm test:all`, `node scripts/ci/check-bench-gate.mjs` on a mock bench (100%). G: `grade` CLI on `hoc-treatment-9a14eb4-one-scene` prints A- with the reasons "creativity_unhinged 3.0 < 4.0", "chosen_silence_present failed". J: a jury run where one juror omits an axis shows that axis's median from the other two. S: mock run of the three scenes, signals 100% (liveOnly skipped), persona-loader leo re-skin test. P: prompt snapshot shows Portuguese exemplars for pt-BR and unchanged English for en; mock gate 100%. M-stages: grades table in `observations.md`, artifact per scene.
