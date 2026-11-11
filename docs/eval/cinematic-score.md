# Cinematic score

A 0-100 score of how much a run looks like a scene from a film, in five groups, each explainable down to the number that produced it. It exists so every change to the revamp is measured before and after. Script-likeness measures play-likeness of the dialogue only and nothing measured the rest.

**Uncalibrated.** No human has graded a run against it. The bands are priors (conventions written down in code, not measured on a corpus), the dialogue group still reads norms from 45 public-domain plays, and the engagement judge has never been compared with a person. A low score is a reason to read the run; a high one is not evidence that it is good. The calibration procedure is below and nothing in it has been run on real grades.

Code: `packages/eval/src/cinematic/` (`bundle`, `arc`, `dialogue`, `embodiment`, `camera`, `engagement`, `score`, `norms`, `calibration`), CLI `packages/eval/src/cli/cinematic.ts`, the independent reader `scripts/run-metrics.mjs`. Baseline: [cinematic-baseline.md](cinematic-baseline.md).

## Running it

```sh
pnpm --filter @perfectman/eval build

# one run: the four measured groups, no network
pnpm --filter @perfectman/eval cinematic --run <run dir> [--json] [--require-climax] [--write-replay]

# the engagement judge (a stronger model than the actors; Anthropic is off)
export CINE_JUDGE_MODEL=<model id> CINE_JUDGE_API_KEY=...     # or OPENROUTER_API_KEY
pnpm --filter @perfectman/eval cinematic --run <run dir> --judge llm

# a list of runs, as a table and as JSON
pnpm --filter @perfectman/eval cinematic --baseline <runs root> --runs 55-63 --out-json out.json --markdown

# the independent second reader (plain Node, no imports from the packages)
node scripts/run-metrics.mjs <run dir> [--json] [--no-cinematic]
```

A run directory is what the recorder leaves: `events.jsonl`, `frames.jsonl`, `director-track.jsonl`, `replay.json`. **Acts live in `frames.jsonl`** (`act_started`, `act_beat`, `act_reaction`, `act_done`), not in `events.jsonl`; camera cues live in `director-track.jsonl`. A group whose file is missing is left out and the overall says so.

`--write-replay` adds `cinematic_score` to `replay.json` (the way `script_likeness` is) and keeps every other key. The run does not write it itself yet; the type is `ReplayManifest.cinematic_score` in `packages/hotel/src/run/artifacts.ts`.

Exit codes: 0 ok; 1 `--require-climax` and the run has no physical climax by 4:00, a calibration that did not freeze, or an error; 2 usage or configuration.

## The score

```
cinematic = arc 0.30 + dialogue 0.15 + embodiment 0.20 + camera 0.10 + engagement 0.25
```

The overall is the weight-normalised mean of the groups that exist. Without the judge it is the mean of the other four, renormalised (`partial: true`, `missing: ["engagement"]`); `deterministic` is always that four-group number, so two runs compare without a judge call. A group's score is the weight-normalised mean of its readings. A reading is a value scored 0-100 against a **band**: 100 inside `[lo, hi]`, linear to 0 at `floor` below and `ceil` above. A thing the run failed to do at all (no incident, no climax) is a reading of 0 with no value, not a missing one.

Two caps, both in the style of the script-likeness score (a part that fails cannot be carried by the ones that pass):

- **Climax invariant.** No physical climax by 4:00 caps the overall at 59 (`CLIMAX_CAP`), however well the rest scores. `invariants.climaxByDeadline` reports pass/fail on its own.
- **Embodiment core.** The embodiment group never scores more than its weakest of `actsPerMin` and `ladderSpan` plus 40, so a scene with one act cannot be carried by faces, walks and entrances.

### Arc (0.30): does the scene go somewhere

Beats are acts (by ladder rung: glare 1, insult 2, shove 3, slap 4, punch 5, kill 6, softer verbs less) and lines by the move they make (threat 3, accusation 2.5, reveal 2, proposal 1; `movesOf` of script-likeness). An act that did not play out (aborted, declined, timeout) is not a beat.

| Reading | Weight | Measures | Band (lo-hi, 0 at) |
|---|---|---|---|
| `timeToIncitingS` | .15 | first beat of weight 2 or more | up to 45 s, 0 at 120 s; none = 0 |
| `reversals` | .15 | initiative swaps (the target of a hostile act hits back) + rises after a lull, per 4 minutes | 1-4, 0 at 0 and 8 |
| `escalationShape` | .15 | share of (earlier, later) 10 s buckets up to the peak where tension did not fall | at least 0.8, 0 at 0.4 |
| `peakIntensity` | .10 | weight of the strongest beat | at least 4 (slap), 0 at 1 |
| `timeToClimaxS` | .25 | first physical act within 80% of the strongest physical act | up to 210 s, 0 at 300 s; none = 0 |
| `aftermathShare` | .10 | share of the scene's activity after the peak; needs 2 lines after it | 8-30%, 0 at 0 and 60% |
| `stakesChange` | .10 | rise of the peak over the opening, memory intensity first to last third, change of emotional tone | at least 0.5, 0 at 0.1 |

**Physical climax** = shove, slap, punch, kill, die, faint, restrain, hug or kiss that reached the screen. The invariant passes when it comes at or before 240 s. Reported with the verb and the time.

### Dialogue (0.15): does it sound like a scene

| Reading | Weight | Measures |
|---|---|---|
| `scriptLikeness` | .35 | the existing benchmark, 0-100 as it is (length, novelty, loops, tics, echo, fillers, question debt) |
| `interruptionShare` | .15 | PROXY: cut-off lines ("--") and staged overlaps over lines; the engine speaks one line at a time |
| `deadAirShare` | .10 | silence beyond 10 s between lines, over the run |
| `pauseBeatsPerMin` | .10 | 2-10 s silences with something in them (an act, a face, a walk) |
| `subtext` | .10 | WEAK PROXY: a question met with a question or a sidestep, figures of speech and trailing off, a line that does not say its private motive |
| `replyAdherence` | .20 | a line shares a topic word with the one before, or answers its question |
| `staleReplyShare` | 0 | replies that answer a line more than 3 back (reported, not weighted yet) |

Script-likeness reads the same turns the script-likeness CLI reads and is capped at 25 for almost every run today, so this group barely separates them until the norms are replaced.

### Embodiment (0.20): do the bodies act

`actsPerMin` .20 (1-6 a minute), `distinctVerbs` .10 (4 or more), `ladderSpan` .10 (rung span of 3), `topVerbShare` .05 (one verb over half the acts is spam), `distinctFaces` .08 (4 or more; neutral counts as a face), `distinctGestures` .05 (2 or more; stop and stand are not gestures), `reactionIntegrity` .15 (owed reactions not missed, absent when none were owed), `walksPerActorMin` .05, `distinctTilesPerActor` .05, `proximityChanges` .07 (a pair crossing touching / talking / across the room), `entranceShare` .05 (actors who walked in on an `:enter` plan), `exits` .05 (mid-scene, not the stop command clearing the stage in the last 20 s).

### Camera (0.10): is it shot like a film

`distinctShots` .25, `topShotShare` .10, `shotsPerMin` .20 (4-14), `shortShotShare` .10 (under 1.8 s), `shotOnSpeaker` .20 (the director scorecard's definition, re-implemented here: framed by a cue that had finished easing, same room, no cut since), `staleDropRate` .15 (cues dropped as `stale` or `unstageable` over everything queued; a drop for `stopped` is the run ending and does not count). Run 63 lost 32 cues against 88 shown, 26.7% of the 120 queued (36% of the 88). The camera group is near its ceiling on every baseline run, so it moves the score by the stale-drop rate and little else.

### Engagement (0.25): the LLM judge

A model stronger than the actors reads a script-style digest of the run (speech, acts with outcome and reactions, exits, room cuts, faces that change, `[m:ss]` timestamps) and grades six axes 1-5: `tension`, `surprise`, `payoff`, `distinctiveness`, `rewatchability`, `entertaining`. The group is `(mean - 1) / 4 * 100`. The rubric with the 1, 3 and 5 anchors is `ENGAGEMENT_RUBRIC` in `engagement.ts`.

- The digest is data, not instructions. It carries none of this scorer's numbers, so the judge cannot echo them. One scene per call, temperature 0.
- Every score needs evidence that cites a `[m:ss]` timestamp. One retry with a stricter system message, then `EngagementReplyError`: a bad reply never becomes a made-up score.
- The judge model may not be any model the actors ran on (read from `replay.json`, or `CINE_ACTOR_MODELS`).
- Transport is the drama judge's, so any OpenAI-compatible endpoint works: OpenRouter by default, OpenCode with `CINE_JUDGE_BASE_URL=https://opencode.ai/zen/go/v1 CINE_JUDGE_SESSION_HEADER=x-opencode-session`. Settings are read from `CINE_JUDGE_*` first, `DRAMA_JUDGE_*` second (`MODEL`, `API_KEY`, `BASE_URL`, `HEADERS`, `SESSION_HEADER`, `TIMEOUT_MS`, `MAX_TOKENS`).
- **Cost cap: `CINE_JUDGE_MAX_USD`, default $0.30 a process, which is one scene.** The digest is capped at 18,000 characters (about 4,500 tokens) and the reply at 2,500 tokens: at $3 / $15 per million tokens, the price an unknown model is assumed to have, one call is under $0.06 and the meter refuses any call that could cross the cap, before the request is sent. `--judge llm` prints the spend.
- `--judge mock` returns a fixed 3 on every axis with no network. It exists for tests; its engagement number measures nothing and the report says so.

## Norms: the interface and how E1's file replaces the priors

Every band comes from a `CinemaNorms` (`norms.ts`): 31 named metrics (`METRIC_IDS`), each a band, plus the script-likeness norms. `loadCinemaNorms()` takes `--norms <file>`, else `CINEMA_NORMS_FILE`, else the first of `docs/eval/cinema-norms.json`, `packages/shared/src/cinema-norms.json`, `packages/kb/cinema-norms.json` that exists, else the fallback. A named file that is missing or not valid JSON is an error (a typo must not silently score against priors).

Today: no cinema norms exist, so the **fallback** applies. All 31 bands are priors (`source: "prior"`: 45 s to the first incident, 4 to 14 camera cues a minute, a slap-or-above peak and so on), and the script-likeness sub-score reads `SCRIPT_NORMS` (plays, THEATRE; the report prints "no cinema block yet"). The report counts how many metrics came from which source.

To swap E1's reference distributions in, with no code change:

1. Write `docs/eval/cinema-norms.json` (numbers only; the same file may carry more than the scorer reads):

   ```json
   {
     "version": 1,
     "note": "n = 300 scenes, built 2026-11-20",
     "metrics": {
       "timeToIncitingS": { "lo": 0, "hi": 60, "floor": 0, "ceil": 180 },
       "shotsPerMin":     { "ladder": [0.5, 1, 1.5, 2, 3, 4, 6, 8, 11, 14, 17, 19, 22, 24, 30] },
       "actsPerMin":      { "lo": 1.5, "hi": null, "floor": 0, "ceil": null }
     }
   }
   ```

   An entry is a band (`hi` / `ceil` may be `null` when more is never worse) or a percentile ladder: an array of 15 numbers at the script-norms percentiles (0, 0.5, 1, 2.5, 5, 10, 25, 50, 75, 90, 95, 97.5, 99, 99.5, 100), or any other length spread evenly over 0-100. A ladder becomes `lo` = p10, `hi` = p90, `floor` = p0, `ceil` = p100 (so a ladder implies a two-sided band; give `hi: null` explicitly as a band when more is never worse). Unknown metric ids are ignored and listed; a file that names none of the known ones is rejected as probably another format.
2. If E1's metric names differ from `METRIC_IDS`, map them in the file (rename the keys) or add the missing ones to `METRIC_IDS` and a prior to `FALLBACK_NORMS`; a unit test fails if a metric has no prior.
3. If E1 also produces a CINEMA block of script norms, put it in `SCRIPT_NORMS` (`packages/shared`, `export-norms`); the dialogue group already asks for the CINEMA medium and falls back to THEATRE with a note.
4. Re-run the baseline (`--baseline ... --out-json docs/eval/cinematic-baseline.json`) so before and after use the same norms, and say in the commit which norms each baseline used (`norms` in the JSON).

## Calibration against human grades

`calibration.ts` is scaffolding. It has never been run on a real grade, and the committed `docs/eval/cinematic-thresholds.json` says `status: "uncalibrated"` with `thresholds: null`.

**Import** (agent E3's grading page): one JSON per clip, or an array, `{ "grades": [...] }`, or `.jsonl`:

```json
{ "clipId": "run62-a", "grader": "owner", "run": 62, "fromS": 0, "toS": 240,
  "scores": { "tension": 4, "surprise": 3, "payoff": 4, "distinctiveness": 3, "rewatchability": 3, "entertainment": 4 },
  "grade": "B" }
```

Scores are integers 1-5 or `{ "score": n, "note": "..." }`; `null` is not graded. Axis names go through `AXIS_ALIASES` (`entertainment`, `fun` and `entertaining` are one axis; `character_distinctiveness` is `distinctiveness`); an axis the judge does not score is kept in `otherAxes` and not compared. `run` says which run the clip was cut from (a number under `--runs-root`, or a path) and `fromS` / `toS` which part of it: the judge and the deterministic groups then read only that window. **If E3's page writes other field names, change `parseHumanGrade` and `AXIS_ALIASES` only.**

**Run**:

```sh
pnpm --filter @perfectman/eval cinematic --calibrate --grades <file|dir> --runs-root <runs dir> \
  --judge llm --model <judge model> --freeze docs/eval/cinematic-thresholds.json
```

It judges every graded clip, then reports Cohen's and quadratic-weighted kappa per axis (the weighted kappa is the hotel calibration's, so numbers compare), exact and within-one agreement, the judge's bias, and the Spearman correlation of the cinematic score with the human `entertaining` grade.

**Freeze rules**: `status: "frozen"` only when at least 12 clips were graded by both, the weighted kappa on `entertaining` is 0.6 or more AND the mean over axes is 0.6 or more, neither side gave every clip the same score, and each cut (B or better = `entertaining` 4 or more; C or better = 3 or more) has at least 3 clips on each side. The cut is the score that maximises Youden's J. Otherwise `unfrozen` with the reasons, and the thresholds, if computed, are for information and not a gate. Recalibrate whenever the judge model, the rubric, the norms or the actor model family changes.

## What is uncalibrated or weak

- Every band outside script-likeness is a prior. The baseline compares runs; it does not say what a good score is.
- Script-likeness is play-likeness and sits at its cap of 25 on 8 of 9 baseline runs.
- Subtext, interruption and pause beats are proxies. The engine speaks one line at a time, so interruption is near 0 by construction until the beat sheet writes overlaps.
- The climax is the first physical act within 80% of the strongest. Hugs and kisses count as physical.
- Arc windows are the whole run: a 45-minute run is scored as one scene (reversals are normalised per 4 minutes; the aftermath share is not).
- The engagement judge reads a text digest, not the video. Faces, camera and sprite quality are invisible to it. No judge has been run for the baseline (no key was available) and no kappa exists.
- Camera is at its ceiling on every run so far and separates little.
