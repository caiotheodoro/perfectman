# Final run — merged presets

`building-aurora` + `cat-on-the-roof` loaded from `examples/presets` at `main` (39d8aa6, after #216 and #217), cast on `deepseek-v4.1-flash`, seeds 7/8/9, 24 pulses, judged at temperature 0 by `glm-5.3-flash` and `qwen3.8-flash`. Transcripts (`seed*.txt`), run stats (`seed*.stats.json`) and raw judge output (`seed*.<judge>.json`) are alongside.

| axis | glm | qwen | min |
|---|---|---|---|
| interaction | 5 | 4 | 4 |
| creativity | 4.67 | 4 | 4 |
| reader_interest | 4.33 | 4 | 4 |
| funk | 5 | 4 | 4 |
| niceness | 4 | 4 | 4 |
| voice_distinctness | 4.67 | 5 | 4.67 |
| secret_play | 4.33 | 3.33 | 3.33 |
| arc | 4 | 4 | 4 |
| chat_naturalness | 4 | 4 | 4 |
| temporal_realism | 3.67 | 3.33 | 3.33 |
| **mean of 10** | | | **4.17** |

- 0 LLM failures across 3 runs; 36.7 messages and 210 chars per message on average, 7.6 s per pulse.
- Matches the tuned r4 round (4.23) within noise, so the merged presets reproduce the result with no scratch-directory files.
- Still short of the 4.5 target on every axis for both judges. Weakest: `temporal_realism` and `secret_play` (Qwen).
- Neide recorded 12 / 20 / 19 engine no-ops across the three seeds, the same silence pattern described in the engine finding on initiative accumulators.
- `rubric.json` is the rubric frozen after round 0. `round.py`, `agg.py` and `judge.py` now read it by that name (they previously looked for `rubric.frozen.json`, which was not shipped).
