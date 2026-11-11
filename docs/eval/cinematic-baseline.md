# Cinematic baseline, runs 55-63

Scores of the nine recorded runs before the cinematic revamp, so every later change has a before. Machine-readable, with every reading and the band it was read against: [cinematic-baseline.json](cinematic-baseline.json). Definition and limits: [cinematic-score.md](cinematic-score.md).

This is the second baseline. The first (E2) read every band as a prior; this one reads the 10 bands E1 measured on the cinema corpus from the corpus, and leaves 25 as priors and one (the 4:00 climax) as a product requirement. Both tables are below.

Read this with three caveats.

- **No engagement judge was run** (no key was available), so every score below is the four measured groups, renormalised: `deterministic`. The full score adds 25% from the judge. These numbers compare runs and changes; they are not grades.
- **Nothing is calibrated against a human.** The corpus bands are measured on films, series and subtitles, not graded; the norms say what real scenes look like, not what a good one is. Read E1's reliability section before leaning on a position: arc detection is plausible in 60% of scenes overall and in 16 of 18 strong-arc scenes.
- The runs are different scenes and lengths (95 s to 45 minutes), and each is scored as one scene (the corpus's scenes are about a minute to eight). Runs 55-61 predate the acts and the guards that came later.

Reproduce:

```sh
pnpm --filter @perfectman/eval build
pnpm --filter @perfectman/eval cinematic --baseline <runs root> --runs 55-63 --out-json docs/eval/cinematic-baseline.json --markdown
# the before-E1 reading, same structure, every band a prior:   add --priors
# soap-opera structure norms (run 63 is a telenovela scene):    add --genre melodrama
```

## Scores (corpus norms)

| run | length | lines | acts | climax by 4:00 | arc | dialogue | embodiment | camera | deterministic | uncapped | script-likeness |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 55 | 1:34 | 8 | 0 | fail (none) | 25.0 | 64.0 | 17.2 | 94.4 | 40.0 | 40.0 | 25.0 |
| 56 | 3:25 | 17 | 0 | fail (none) | 52.6 | 71.1 | 30.8 | 100.0 | 56.8 | 56.8 | 53.6 |
| 57 | 3:05 | 14 | 0 | fail (none) | 12.1 | 62.5 | 29.8 | 100.0 | 38.6 | 38.6 | 25.0 |
| 58 | 2:17 | 14 | 2 | fail (none) | 34.4 | 62.5 | 66.2 | 98.3 | 57.0 | 57.0 | 25.0 |
| 59 | 5:36 | 38 | 5 | fail (none) | 53.4 | 68.9 | 72.3 | 100.0 | 59.0 (capped) | 67.8 | 25.0 |
| 60 | 6:56 | 43 | 0 | fail (none) | 22.2 | 66.4 | 40.0 | 90.1 | 44.8 | 44.8 | 25.0 |
| 61 | 7:47 | 58 | 0 | fail (none) | 27.4 | 73.2 | 34.3 | 96.0 | 47.5 | 47.5 | 25.0 |
| 62 | 45:24 | 377 | 24 | fail (shove 6:30) | 36.6 | 60.0 | 89.7 | 98.1 | 59.0 (capped) | 63.6 | 25.0 |
| 63 | 7:28 | 54 | 1 | fail (none) | 21.4 | 54.5 | 40.0 | 87.0 | 41.7 | 41.7 | 25.0 |

"acts" is acts on screen from `frames.jsonl`. "none" means no shove, slap, punch, kill, die, faint, restrain, hug or kiss reached the screen. The cap (59, no climax by 4:00) only bites on runs 59 and 62; `uncapped` is what orders them.

## Before and after

| run | E2 (priors) | corpus norms | uncapped | what moved it |
|---|---|---|---|---|
| 55 | 36.4 | 40.0 | 40.0 | arc: 8 lines, the proxy sees no strong arc, so the readings that penalised it before are left out |
| 56 | 39.3 | 56.8 | 56.8 | arc 9.6 to 52.6: a strong verbal arc (peak 0.64, inciting at 0.16 of the scene, peak at 0.69, aftermath 0.26) sits inside the corpus bands; the 45 s prior had zeroed it |
| 57 | 41.9 | 38.6 | 38.6 | arc 21.7 to 12.1: no strong arc, only the priors and the failed climax count |
| 58 | 56.4 | 57.0 | 57.0 | about the same: two acts, no strong arc |
| 59 | 52.8 | 59.0 | 67.8 | arc 23.4 to 53.4: a strong arc (peak 0.31, climax at 0.45, aftermath 0.51, two reversals) with five acts; first once the cap is lifted |
| 60 | 48.7 | 44.8 | 44.8 | arc 40.0 to 22.2 (peak 0.275 is just under the strong-arc gate); dialogue 50.2 to 66.4 |
| 61 | 45.9 | 47.5 | 47.5 | arc 32.7 to 27.4; dialogue 53.1 to 73.2 (the fastest talk of the three, 7.6 lines a minute) |
| 62 | 59.0 (61.5) | 59.0 | 63.6 | arc 43.1 to 36.6, embodiment 87.2 to 89.7, dialogue 40.6 to 60.0; second to run 59 uncapped |
| 63 | 46.9 | 41.7 | 41.7 | dialogue 50.4 to 54.5 but lowest of the three: 60% of the span is silent, 4% short replies, 1 act |

Rank, best to worst, uncapped. E2: 62, 58, 59, 60, 63, 61, 57, 56, 55. Now: 59, 62, 58, 56, 61, 60, 63, 55, 57. What changed the order, in order of size:

1. **The arc group stopped being a prior's opinion.** Where the corpus's own reader finds a strong arc (runs 56, 59, 62) the inciting beat, climax, aftermath and reversals are scored against real scenes and mostly land inside the bands; before they were scored against 45 s, 3:30 and 8-30% priors. The arc group goes from 9.6 to 52.6 for run 56 and from 23.4 to 53.4 for run 59. Where it does not find one (55, 57, 58, 60, 61, 63) those four readings are left out, not scored 0, because the proxy is near-blind to cold or afraid conflict (AUC 0.56). The arc group of those six is therefore the three prior readings and the failed climax, and moves little.
2. **Rhythm is now measured.** The runs speak 4 to 8 lines a minute. The corpus's subtitle files carry 16.5 cues a minute at the median (11.4-23.0 for the middle 80%); a cue is not a turn, and scaled by E1's own screenplay-to-subtitle ratio the full-marks band is 7.5-14.5 turns a minute (see the norms section of cinematic-score.md). Seven of the nine runs sit under its low edge (only 61 and 62 are inside). Six of nine also hold almost no short replies (0 to 4%; the corpus, corrected for cue length, is 0.38-0.45 at the median): the actors speak in full sentences.
3. **Run 62 is one scene of 377 turns.** The corpus's scenes are a few dozen turns at most, so 13 reversals, a peak at 0.14 of the scene (the single shove) and an aftermath of 0.86 score low on arc. It is still second.

## Do runs 60, 61 and 63 separate?

A little, and not on the things that matter. Deterministic: 61 at 47.5, 60 at 44.8, 63 at 41.7, a spread of 5.8 against 2.8 before, and run 63 is now clearly the lowest of the three where before it sat between them. All three fail the climax invariant and none has a strong arc, so the arc group (22.2, 27.4, 21.4) and embodiment (40.0, 34.3, 40.0; zero acts for 60 and 61, one glare for 63) tell them apart by almost nothing.

What separates them is dialogue rhythm, and each gap is small:

- 63 against 60 and 61 (dialogue 54.5 against 66.4 and 73.2): 59.5% of its span is silent against 45.6% and 37.1%, and 3.7% short replies against 20.9% and 29.3%. 63 is a slower, more spoken-in-paragraphs scene than the other two.
- 61 over 60 (73.2 against 66.4): 7.6 lines a minute against 6.2 (the band starts at 7.5), and 60 has 55 s of dead air over 10 s where 61 stays inside the band.

The ordering of 60 against 61 rests on pace and dead air, which sit close to the edge of a band, so it should not be trusted; the lower position of 63 rests on three readings that agree. The judge and the owner's grades are what will separate the three on what they are about (stakes, surprise, payoff).

## What the other views say

- Every band a prior (`--priors`, same structure as now): 55 38.7, 56 55.6, 57 37.2, 58 55.8, 59 62.7 (59.0 capped), 60 43.6, 61 45.4, 62 57.5, 63 41.4. **The order is the same as with the corpus bands** (59, 62, 58, 56, 61, 60, 63, 55, 57), so the rank changes against E2's table come from the structure that E1's findings changed (a strong-arc gate on the proxy readings, measured rhythm, hard acts), not from the corpus numbers replacing the priors. The corpus numbers move scores by 1 to 6 points (run 59 62.7 to 67.8, run 62 57.5 to 63.6, run 56 55.6 to 56.8).
- `--genre melodrama` (structure norms from the soap-opera transcripts; action from the same screenplays): 55 40.0, 56 56.6, 57 38.6, 58 57.0, 59 64.8 (59.0 capped), 60 44.8, 61 47.5, 62 61.0 (59.0 capped), 63 41.7. Same order again. Run 63 is a telenovela scene and scores no better for it: its arc is not strong, so no structure band is read.

## What is still true of these runs

- **No run reaches a physical climax by 4:00.** The only one with a physical act at all is run 62, whose single shove came at 6:30 in a 45-minute run. That is the plan's hard invariant, and it fails on all nine. The corpus does not soften it: the median climax of a strong-arc scene is at 0.58 of the scene, and a 6-minute scene with the climax at 3.5 minutes matches that, but the deadline is the owner's product requirement and is checked on its own.
- **Run 63 (Sobremesa, deepseek).** One act in 7:28, a glare at 4:37. 32 camera cues were lost (stale or unstageable) against 88 shown, 26.7% of the 120 queued, the highest stale-drop rate of the nine.
- **Run 62** has 24 acts (glare 8, insult 4, recoil 5, freeze_gasp 5, shove 1, turn_back 1) over 45 minutes, three initiative swaps, every owed reaction delivered (20 of 20). It is held to 59 by the invariant (uncapped 63.6).
- **Embodiment sanity check.** Run 62 (89.7) is far above run 63 (40.0). Run 60 has no act in `frames.jsonl` at all, so both 60 and 63 sit on the embodiment core cap of 40.0.
- **Camera is at its ceiling** (87-100) on every run, as before; it moves the score by the stale-drop rate only. No corpus has a camera, so all its bands are priors.
- **Script-likeness is 25 on eight of nine runs**, its cap, as before.

## What would change these numbers

The judge (25% of the score), the owner's grades, E3's calibration, B5's human-likeness report (an optional input to embodiment, see cinematic-score.md), and a corpus that carries action lines in Portuguese. Re-run the same command after each and keep the JSON next to the commit that changed the engine.
