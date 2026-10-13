# Roleplay rubric and judge harness

A 10-axis rubric (`rubric.json`, frozen after round 0) and the scripts that scored
the `cat-on-the-roof` and `elevator-at-midnight` presets with a cheap cast model
and a cross-family judge pair.

## Pipeline

- `proxy.mjs` — local proxy on `:4399` that adds the `x-opencode-session` header opencode Go requires. Reads the key from `OPENCODE_API_KEY`; never write it to a file.
- `round.py <label> <demoDir> [model] [seeds]` — runs seeds 7, 8, 9 through `/api/runs`, extracts, judges, aggregates.
- `extract.py` — `replay.json` to transcript plus stats; `STORY_START` / `STORY_MPP` render story-clock stamps.
- `judge.py <dir> <transcript> <model> <out>` — temperature-0 rubric judge; `SCENE_FILE` selects the scene brief.
- `agg.py <labels...>` — per-axis table across judges.

The scripts resolve `rubric.json` and write `rounds/<label>/` next to themselves, so copy the directory somewhere writable before a run. `<demoDir>` is a folder of `*.persona.md` plus one `*.scenario.md`, e.g. a preset's cast and scene files merged.

## Result (mean of 10 axes, 3 seeds, GLM + Qwen judges)

| Round | Change | Mean |
|---|---|---|
| r0 | baseline, long messages | 4.20 |
| r1 | short voice rules + `messageLength` | 4.22 |
| r2 | story clock in the prompt | 4.30 |
| r3 | limited private channels + hard deadline (reverted) | 3.90 |
| r4 | warmth and stakes in scene text | 4.23 |
| r5 | `deepseek-v4-pro` cast | 4.15 |
| held-out | new scene, one persona swapped | 4.03 |

No axis reached 4.5 on both judges. Shorter messages lifted `chat_naturalness` (2.67 to ~4.2) and `temporal_realism` (2.83 to ~4.0) at some cost to `arc` and `reader_interest`. Differences under ~0.3 are noise at 3 seeds. From r2 the temporal judge reads the story clock rather than wall-clock stamps, so that axis is not strictly like-for-like across rounds.
