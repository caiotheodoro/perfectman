# Cinematic score

A 0-100 score of how much a run looks like a scene from a film, in five groups, each explainable down to the number that produced it. It exists so every change to the revamp is measured before and after. Script-likeness measures play-likeness of the dialogue only and nothing measured the rest.

**Uncalibrated.** No human has graded a run against it. Ten of the 36 bands are measured on E1's cinema corpus (films, series, subtitles, plays); 25 are still priors (conventions written down in code) and one, the physical climax by 4:00, is the owner's product requirement. The dialogue group's script-likeness sub-score still reads norms from 45 public-domain plays, and the engagement judge has never been compared with a person. A low score is a reason to read the run; a high one is not evidence that it is good. The calibration procedure is below and nothing in it has been run on real grades.

Code: `packages/eval/src/cinematic/` (`bundle`, `measure`, `arc`, `dialogue`, `embodiment`, `camera`, `engagement`, `score`, `norms`, `corpus-norms`, `humanlike-hook`, `calibration`), CLI `packages/eval/src/cli/cinematic.ts`, the independent reader `scripts/run-metrics.mjs`. Baseline: [cinematic-baseline.md](cinematic-baseline.md).

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

# norms: the corpus's by default; every band a prior (the scorer before E1's norms); soap-opera structure; a file of your own
pnpm --filter @perfectman/eval cinematic --run <run dir> --priors
pnpm --filter @perfectman/eval cinematic --run <run dir> --genre melodrama      # drama | melodrama | thriller | comedy
pnpm --filter @perfectman/eval cinematic --run <run dir> --norms my-norms.json

# agent B5's human-likeness report as an input to embodiment (off without it)
pnpm --filter @perfectman/eval cinematic --run <run dir> --humanlike report.json

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

| Reading | Weight | Measures | Band | Source |
|---|---|---|---|---|
| `incitingPos` | .10 | the inciting beat as a share of the scene, by the corpus's reader (`measureScene`) | strong-arc p25-p75, film + series (0.15-0.60) | measured |
| `reversals` | .15 | turning points of the intensity curve, by the corpus's reader, against the band for the scene's size | size-stratified p50-p90, at least 1 (2-6 over all sizes) | measured |
| `escalationShape` | .10 | share of (earlier, later) 10 s buckets up to the peak where tension did not fall | at least 0.8, 0 at 0.4 | prior |
| `peakIntensity` | .10 | weight of the strongest beat | at least 4 (slap), 0 at 1 | prior |
| `timeToClimaxS` | .25 | first physical act within 80% of the strongest physical act | up to 210 s, 0 at 300 s; none = 0 | product |
| `climaxPos` | .10 | the peak of the intensity curve as a share of the scene | strong-arc p25-p75 (0.29-0.85) | measured |
| `aftermathShare` | .10 | scene time after intensity last holds 70% of its rise | strong-arc p25-p75 (0.10-0.59) | measured |
| `stakesChange` | .10 | rise of the peak over the opening, memory intensity first to last third, change of emotional tone | at least 0.5, 0 at 0.1 | prior |

**The four corpus readings are read only where the intensity proxy finds a strong arc** (peak 0.3 or more, rise 0.15 or more over the opening: the gate E1's strong-arc ladders are built on, 16 of 18 plausible in its hand-check). The proxy sees open hostility (hostile words, shouting, cut-off lines) and hard physical acts (AUC 0.85 against violent actions); it is **near-blind to cold, afraid or restrained conflict (AUC 0.56 against hot emotions)**. So a run with no strong arc by the proxy gets those four readings left out of the group, with a note saying so, and is **not** scored as having no arc. The cost: for such a run the arc group is the three prior readings and the climax, and it moves little.

**Physical climax** = shove, slap, punch, kill, die, faint, restrain, hug or kiss that reached the screen. The invariant passes when it comes at or before 240 s. Reported with the verb and the time. **It is the owner's product requirement, not a corpus statistic**: the invariant, the cap of 59 on the overall and the `timeToClimaxS` band read no corpus norm and do not move with `--norms`, `--genre` or `--priors` (a test scores one run under five sets of norms, one with every band thrown open, and checks the same pass/fail and the same cap). For scale: the corpus median climax of a strong-arc scene is at ~0.58 of the scene time, so a 6-minute scene with its climax at 3.5 minutes matches it; the product band is flat up to 3:30 because of that, but it is not derived from it.

### Dialogue (0.15): does it sound like a scene

| Reading | Weight | Measures | Source |
|---|---|---|---|
| `scriptLikeness` | .30 | the existing benchmark, 0-100 as it is (length, novelty, loops, tics, echo, fillers, question debt) | plays (45) |
| `interruptionShare` | .10 | PROXY: cut-off lines ("--") and staged overlaps over lines; the engine speaks one line at a time. Band: screenplays and transcripts p10-p90 (0-0.10): the median real scene has none | measured |
| `deadAirShare` | .05 | silence beyond 10 s between lines, over the run (the corpus's scenes are cut at 12 s of silence, so it cannot see this) | prior |
| `pauseBeatsPerMin` | .05 | 2-10 s silences with something in them (an act, a face, a walk) | prior |
| `subtext` | .10 | WEAK PROXY: a question met with a question or a sidestep, figures of speech and trailing off, a line that does not say its private motive | prior |
| `replyAdherence` | .15 | a line shares a topic word with the one before, or answers its question | prior |
| `turnsPerMin` | .08 | spoken turns per minute between the first line and the last. Band: subtitle buckets film + series p10-p90, scaled by E1's English screenplay-to-subtitle ratio (a cue is not a turn): 7.5-14.5 for pt | measured |
| `silenceShare` | .10 | share of the span with nobody talking, a line taking 0.45 s + words / 2.7 s to say. Band: subtitle buckets p10-p90 (0.11-0.46) | measured |
| `shortReplyShare` | .07 | lines of 5 words or fewer. Band: subtitle buckets p10-p90 shifted by `calibration.ptAdjusted` for the cue-length bias (0.21-0.64 for pt) | measured |
| `staleReplyShare` | 0 | replies that answer a line more than 3 back (reported, not weighted yet) | prior |

Script-likeness reads the same turns the script-likeness CLI reads and is capped at 25 for almost every run today, so this group barely separates them until the norms are replaced.

### Embodiment (0.20): do the bodies act

`actsPerMin` .16 (film screenplays p25-p90: 0.96-3.46 body acts a minute; measured), `hardActs` .06 (hard physical acts in the scene, by the corpus's reader, at least 1 for a scene of any size; measured), `distinctVerbs` .10 (4 or more), `ladderSpan` .10 (rung span of 3), `topVerbShare` .05 (one verb over half the acts is spam), `distinctFaces` .08 (4 or more; neutral counts as a face), `distinctGestures` .05 (2 or more; stop and stand are not gestures), `reactionIntegrity` .15 (owed reactions not missed, absent when none were owed), `walksPerActorMin` .05, `distinctTilesPerActor` .05, `proximityChanges` .07 (a pair crossing touching / talking / across the room), `entranceShare` .05 (actors who walked in on an `:enter` plan), `exits` .05 (mid-scene, not the stop command clearing the stage in the last 20 s). Everything but the first two is a prior: the corpus has no body vocabulary. The weights are relative; `humanLike`, when present, adds .20 to them.

`actsPerMin` divides by the run's length (as `scripts/run-metrics.mjs` does, which a test holds to the same figure); the corpus's reader divides by first-to-last event, under 10% apart on the baseline runs. Action lines come from film screenplays only: TV transcripts mostly leave them out, so their median of 0 describes the format.

**Human-likeness hook (off by default).** Agent B5 builds `packages/eval/src/humanlike/` (does the avatar move like a person). It is not merged, nothing here imports it, and the contract is one shape in `humanlike-hook.ts`:

```ts
type HumanLikeReport = { score0to100: number; components: Record<string, number> };
```

`scoreBundle(bundle, { humanlike })` or `cinematic --run <dir> --humanlike report.json` adds one embodiment reading, `humanLike`, with the report's score as it is (it is already 0-100), weight .20, and puts the report in `groups.embodiment.detail.humanLike`. Without it there is no reading and `detail.humanLike` is `"off"`; the score is what it was. `parseHumanLikeReport` validates a file and clamps the score. The baseline does not use it.

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

## Norms: what is measured, what is a prior, and what is a product requirement

Every band comes from a `CinemaNorms` (`norms.ts`): 36 named metrics (`METRIC_IDS`), each a band `[lo, hi]` with zero marks at `floor` / `ceil`, plus the script-likeness norms. A band has a source, `cinema-norms` (measured on E1's corpus), `prior` (a convention written down in code) or `product` (the owner's requirement); the report counts them (`norms.fromCinemaNorms`, `priors`, `product`) and the baseline JSON carries them per run.

**Default: `corpusNorms({ lang, genre? })` (`corpus-norms.ts`).** It reads `CINEMA_NORMS` from `@perfectman/shared` (E1's `cinema-norms.json`, numbers only) and builds the 10 measured bands below; the rest stay as `FALLBACK_NORMS`. `--priors` (or `fallbackNorms()`) is all priors, for before-and-after comparisons with the scorer as it was; `--norms file` / `CINEMA_NORMS_FILE` overrides any metric from a JSON file (below). A band is full marks over a percentile range of the ladder and falls to 0 at twice as far from the range as the ladder's p5 / p95 are, kept inside the metric's natural range.

Buckets: **rhythm** from `${lang}/film/subtitle` and `${lang}/series/subtitle` pooled (the only sources with real cue times; the mean of the two ladders' percentile points); **structure** from `en/film/screenplay` and `en/series/transcript` pooled, and with `--genre melodrama` from `en/series/transcript/melodrama` (pt-BR structure is borrowed from English, there is no Portuguese text with action lines at scale and no telenovela text); **action** from `en/film/screenplay` only.

| Our metric | Status | Norm id (bucket and feature) | Band |
|---|---|---|---|
| `incitingPos` | measured | structure `strongArc.tInciting` | p25-p75 |
| `climaxPos` | measured | structure `strongArc.tClimax` | p25-p75 |
| `aftermathShare` | measured | structure `strongArc.aftermathShare` | p25-p75 |
| `reversals` | measured | structure `bySize.reversals` (size-stratified; `strongArc.reversals` when the size is unknown) | p50-p90, at least 1 |
| `interruptionShare` | measured | structure `interruptShare` | p10-p90 |
| `turnsPerMin` | measured | rhythm `turnsPerMin`, scaled by English screenplay / subtitle median | p10-p90 |
| `silenceShare` | measured | rhythm `silenceShare` | p10-p90 |
| `shortReplyShare` | measured | rhythm `shortShare`, shifted by `calibration.ptAdjusted.<medium>.shortShare` (pt only) | p10-p90 |
| `actsPerMin` | measured | action `actsPerMin` | p25-p90 |
| `hardActs` | measured | action `bySize.hardActs` | p50-p95, at least 1 |
| `timeToClimaxS` | **product** | none: the owner's requirement, a physical climax by 4:00 | up to 210 s, 0 at 300 s |
| `escalationShape`, `peakIntensity`, `stakesChange` | prior | the corpus has the curve (`curves.shape`; the fit is reported in `groups.arc.detail.corpus.shapeFit`) but no scalar, its peak is a 0-1 text proxy on another scale, no memories | |
| `deadAirShare`, `pauseBeatsPerMin` | prior | subtitle scenes are cut at 12 s of silence; a pause "with business in it" exists in no corpus | |
| `subtext`, `replyAdherence`, `staleReplyShare` | prior | no corpus counterpart | |
| `distinctVerbs`, `ladderSpan`, `topVerbShare`, `distinctFaces`, `distinctGestures`, `reactionIntegrity`, `walksPerActorMin`, `distinctTilesPerActor`, `proximityChanges`, `entranceShare`, `exits` | prior | the engine's own body vocabulary and contracts | |
| `distinctShots`, `topShotShare`, `shotsPerMin`, `shortShotShare`, `shotOnSpeaker`, `staleDropRate` | prior | no camera in any corpus | |

The map is data (`NORM_MAP` in `corpus-norms.ts`, one entry per metric with its `why`) and a test checks it covers every metric and that each status matches the band's source.

How a run is measured, so it is read the way the corpus was (`measure.ts`): the chat lines become `speech` events and the acts that reached the screen become `direction` events, each with its clock time (`timeSource: "clock"`), and `measureScene` from `@perfectman/shared` reads them. An act is rendered as one short phrase per verb that lands in the class the verb belongs to (`ACT_TEXT`: shove, slap, punch, kill, die, faint, grab are hard acts; hug and kiss are tenderness, a physical beat that is not conflict; glare, insult, cry, recoil ... are small body movement); the phrases carry no names. A line takes 0.45 s + words / 2.7 s to say (the corpus's reading-rate model), so silence is the time between where a line is estimated to end and the next one starts.

Things to know before trusting it:

- **The intensity proxy is near-blind to cold or afraid conflict** (AUC 0.56), sees open hostility and hard acts (0.85). The arc positions and reversals are therefore read only on a strong arc (see the Arc section), and a run without one is not scored as having no arc.
- **E1's arc detection is plausible in 60% of scenes overall and in 16 of 18 strong-arc scenes** (one reader, the builder). Positions are wide: the middle half of strong-arc climaxes spans 0.29-0.85 of the scene, so the band separates "at the first line" or "at the last" from the rest and little else.
- **Subtitle cues are shorter than spoken turns**: short replies are shifted by E1's `ptAdjusted`; turns per minute has no such entry, so it is scaled by the same-medium ratio of E1's English screenplay to subtitle medians (0.60 film, 0.63 series). That correction is this scorer's, not E1's. Without it every baseline run scores 0 on `turnsPerMin`.
- **A run is one scene.** The corpus's scenes are a minute to eight; a 45-minute run is read as one scene, which makes its position readings and its reversals count (13 against a band of 3.5-9.5) mean less.
- **Pt-BR structure is English.** Rhythm is Portuguese subtitles of mostly foreign works (the `/native` buckets agree closely).
- `interruptionShare` has a band that starts at 0: the median real scene has no cut-off lines, so it gives full marks to a run with none. It only penalises a lot of them.

### A norms file

A file still overrides any metric, with no code change (`--norms`, `CINEMA_NORMS_FILE`, or `docs/eval/cinema-norms.json` when it exists):

```json
{
  "version": 1,
  "note": "n = 300 scenes, built 2026-11-20",
  "metrics": {
    "climaxPos":   { "lo": 0.3, "hi": 0.8, "floor": 0, "ceil": 1 },
    "shotsPerMin": { "ladder": [0.5, 1, 1.5, 2, 3, 4, 6, 8, 11, 14, 17, 19, 22, 24, 30] },
    "actsPerMin":  { "lo": 1.5, "hi": null, "floor": 0, "ceil": null }
  }
}
```

An entry is a band (`hi` / `ceil` may be `null` when more is never worse) or a percentile ladder: an array of 15 numbers at the script-norms percentiles (0, 0.5, 1, 2.5, 5, 10, 25, 50, 75, 90, 95, 97.5, 99, 99.5, 100), or any other length spread evenly over 0-100. A ladder becomes `lo` = p10, `hi` = p90, `floor` = p0, `ceil` = p100. Unknown metric ids are ignored and listed; a file naming none of the known ones is rejected as probably another format. A file replaces the corpus norms entirely (metrics it does not name are priors, not corpus), and a named file that is missing or not valid JSON is an error. Re-run the baseline (`--baseline ... --out-json docs/eval/cinematic-baseline.json`) after any change, and say in the commit which norms it used (`norms` in the JSON).

If E1 produces a CINEMA block of script norms, put it in `SCRIPT_NORMS` (`packages/shared`, `export-norms`); the dialogue group already asks for the CINEMA medium and falls back to THEATRE with a note.

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

- Ten bands are measured on a corpus; the baseline compares runs and says what real scenes look like, not what a good one is. 25 bands are priors.
- Script-likeness is play-likeness and sits at its cap of 25 on 8 of 9 baseline runs.
- Subtext, interruption and pause beats are proxies. The engine speaks one line at a time, so interruption is near 0 by construction until the beat sheet writes overlaps.
- The arc positions and reversals exist only for runs the intensity proxy reads as a strong arc; most baseline runs (six of nine) are outside it.
- The climax is the first physical act within 80% of the strongest. Hugs and kisses count as physical (and as hard acts in the corpus's count, but not as conflict).
- Arc windows are the whole run: a 45-minute run is scored as one scene.
- The engagement judge reads a text digest, not the video. Faces, camera and sprite quality are invisible to it. No judge has been run for the baseline (no key was available) and no kappa exists.
- Camera is at its ceiling on every run so far and separates little.
