# Human-likeness preview: run 63 on the Terraço, offline

Run 63's cast (Heloísa, Otávio, Renato) and its 54 lines at their seconds, in the Terraço's own layout (`pm_terraco`, 16 x 11: the round table with four chairs, two sofa groups, the barbecue counter, the sun loungers, the rail along the south and east edges; Heloísa and Otávio start seated at the table as in the run), on the offline sim: the real planner and director, the real shot planner timing each line on a film, the fake grid hotel underneath. A model that proposes nothing, so the director starts no act, as in the run. The same cast, script, room and seed for every arm; only `human_likeness` changes: **0** (the body as it was, on the same film), **0.6** (the default) and **1**.

Authored for the scene, as a beat sheet's notes would: lines 14, 16, 19, 20, 24, 28 and 33 are lies, lines 0, 18, 22, 36 and 38 reveal something, and the envelope, the safe and the pen are props the lines point at. The sim has no engine mood update, so a hostile line heats whoever it is for (`appraise`).

Command: `node packages/eval/dist/humanlike/preview.js <dir>` writes the three traces, `python3 -I packages/eval/scripts/render-humanlike.py <dir>` draws a contact sheet per arm (15 top-down snapshots, 30 s apart: position, facing arrow, typing bubble, face, gesture, trails, the line being said; and a lane chart of typing, lines, gestures, faces and walks for the whole scene). `node packages/eval/dist/humanlike/preview.js x --md <file>` writes the table below.

## Mean over 12 seeds

| measure | h = 0 | h = 0.6 | h = 1 |
|---|---|---|---|
| human-likeness score | 69.1 | 92.3 | 96.3 |
| lines said within earshot | 1.00 | 1.00 | 0.99 |
| median distance at a line (tiles) | 1.4 | 2.2 | 2.1 |
| stacking events | 0.0 | 0.0 | 0.0 |
| speaker faces addressee | 0.86 | 0.80 | 0.83 |
| listener faces speaker | 0.88 | 0.88 | 0.81 |
| gaze break and return | 0.00 | 0.03 | 0.05 |
| typing length correlation | n/a | 0.38 | 0.47 |
| median bubble ms | 500 | 1444 | 2031 |
| lines landing on the last (overlap) | 0.02 | 0.06 | 0.07 |
| lines cut off by a dash | 0.000 | 0.023 | 0.053 |
| lines with a gesture | 0.00 | 0.17 | 0.20 |
| non-verbal backchannel | 0.00 | 0.34 | 0.46 |
| face changes per actor-minute | 0.00 | 1.44 | 1.92 |
| walks per actor-minute | 0.07 | 0.67 | 0.81 |
| idle motion per actor-minute | 0.89 | 4.88 | 6.70 |
| frozen 10 s windows | 0.89 | 0.38 | 0.27 |
| back-and-forth walks per actor-hour | 0.00 | 0.00 | 0.00 |

The sim is deterministic per seed, so this is the spread of the dial, not noise. The score of the sim arms is not comparable with the real runs in the [baseline](humanlike-baseline.md): the real runs include a model that walked the actors and wrote faces, the sim does not.

## What the sheets show (seed 3)

- **h = 0:** the three stand in a tight diagonal at the table for seven minutes (median 1 tile apart, intimate for strangers), nothing moves, no face changes, no gesture, and every typing bubble is the same half second whatever the line. 89% of 10 s windows hold still.
- **h = 0.6:** Renato walks in from the door and stops at the table, later crosses to the far side of the room and back; Heloísa gets up and moves round the table; speakers turn to the person addressed and the listener turns after a beat, some look away and back, a brow goes up at the reveal, a witness freezes and looks to the accused, an exclamation sign goes up on a shouted line; bubbles run 1 to 3 s with the length of the line, and two lines trail off in a dash with the answer landing on them.
- **h = 1:** the same, stronger: more glances away and more faces, three lines talked over, a stray hesitation in a bubble, and more walking.
