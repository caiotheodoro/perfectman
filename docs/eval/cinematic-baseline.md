# Cinematic baseline, runs 55-63

Scores of the nine recorded runs before the cinematic revamp, so every later change has a before. Machine-readable, with every reading: [cinematic-baseline.json](cinematic-baseline.json). Definition and limits: [cinematic-score.md](cinematic-score.md).

Read this with three caveats.

- **No engagement judge was run** (no key was available), so every score below is the four measured groups, renormalised: `deterministic`. The full score adds 25% from the judge. These numbers compare runs and changes; they are not grades.
- **Norms are the fallback**: priors for every band and the plays' norms for script-likeness. Nothing is calibrated against a human.
- The runs are different scenes and lengths (95 s to 45 minutes). Runs 55-61 predate the acts and the guards that came later.

Reproduce:

```sh
pnpm --filter @perfectman/eval build
pnpm --filter @perfectman/eval cinematic --baseline <runs root> --runs 55-63 --out-json docs/eval/cinematic-baseline.json --markdown
```

## Scores

| run | length | lines | acts | climax by 4:00 | arc | dialogue | embodiment | camera | deterministic | script-likeness |
|---|---|---|---|---|---|---|---|---|---|---|
| 55 | 1:34 | 8 | 0 | fail (none) | 18.8 | 58.0 | 17.6 | 94.4 | 36.4 | 25.0 |
| 56 | 3:25 | 17 | 0 | fail (none) | 9.6 | 68.8 | 31.5 | 100.0 | 39.3 | 53.6 |
| 57 | 3:05 | 14 | 0 | fail (none) | 21.7 | 58.8 | 30.5 | 100.0 | 41.9 | 25.0 |
| 58 | 2:17 | 14 | 2 | fail (none) | 32.0 | 58.8 | 70.4 | 98.3 | 56.4 | 25.0 |
| 59 | 5:36 | 38 | 5 | fail (none) | 23.4 | 52.7 | 73.3 | 100.0 | 52.8 | 25.0 |
| 60 | 6:56 | 43 | 0 | fail (none) | 40.0 | 50.2 | 40.0 | 90.1 | 48.7 | 25.0 |
| 61 | 7:47 | 58 | 0 | fail (none) | 32.7 | 53.1 | 35.1 | 96.0 | 45.9 | 25.0 |
| 62 | 45:24 | 377 | 24 | fail (shove 6:30) | 43.1 | 40.6 | 87.2 | 98.1 | 59.0 (capped from 61.5) | 25.0 |
| 63 | 7:28 | 54 | 1 | fail (none) | 36.4 | 50.4 | 40.0 | 87.0 | 46.9 | 25.0 |

"acts" is acts on screen from `frames.jsonl`. "none" means no shove, slap, punch, kill, die, faint, restrain, hug or kiss reached the screen.

## What it shows

- **No run reaches a physical climax by 4:00.** The only one with a physical act is run 62, whose single shove came at 6:30 in a 45-minute run. That is the plan's hard invariant, and it fails on all nine. The cap of 59 only bites on run 62; the others are below it already.
- **Run 63 (Sobremesa, deepseek): 46.9.** One act in 7:28, a glare at 4:37. No climax. The reveal at 0:22 is the inciting incident and the peak is a threat line at 4:35. 32 camera cues were lost (stale or unstageable) against 88 shown, 26.7% of the 120 queued, the highest stale-drop rate of the nine. Script-likeness 25 on novelty and topic words. Among the runs over five minutes it is second lowest, one point above run 61 (45.9, no act, threat at 1:31): on this score alone runs 60, 61 and 63 are not distinguishable, and none of the three has an act worth the name. The judge and the owner's grades are what will separate them.
- **Run 62: 59.0, the highest.** 24 acts (glare 8, insult 4, recoil 5, freeze_gasp 5, shove 1, turn_back 1) over 45 minutes, three initiative swaps, a verb range of six, every owed reaction delivered (20 of 20). It is held to 59 by the invariant (raw 61.5), and its arc is low because the single physical beat is late and the aftermath is 86% of the run.
- **Embodiment sanity check.** Run 62 (87.2) is far above run 63 (40.0), as expected. Run 60 is **not** above run 63: it has no act in `frames.jsonl` at all (the brief remembered otherwise), so both sit on the embodiment core cap of 40.0; uncapped the means are 41.0 for run 60 and 50.0 for run 63. Run 63 also leaves the room never, run 60 twice, which is why run 60 is not lower.
- **Most scenes peak early and idle.** Runs 57, 59 and 61 find their strongest beat in the first 90 s (a threat at 8 s, an accusation at 54 s, a threat at 91 s) and never exceed it. Run 63's strongest beat is a threat line at 4:35, still words.
- **Camera is at its ceiling** (87-100) on every run. It moves the score by the stale-drop rate: run 63 loses 32 of 120 queued cues (26.7%), run 60 17 of 79 (21.5%), run 55 4 of 28 (14%), and the others under 10%.
- **Script-likeness is 25 on eight of nine runs**, its cap. Run 60's own `replay.json` stores 88.4 for the same scene; the stored value was written by the build that ran it, and the current benchmark (`script-likeness --run`) gives 25 for the same events. That is a note on how far the benchmark has moved, not a finding about the scorer.

## What would change these numbers

Adding the judge (25% of the score), swapping in E1's cinema norms, and the owner's grades. Re-run the same command after each and keep the JSON next to the commit that changed the engine.
