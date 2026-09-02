# Dead-room run: `deepseek-api` config, live DeepSeek `deepseek-v4-flash`

Live `pnpm --filter @perfectman/server simulation` run, 2026-09-01, ~6 min
(63 pulses at 5s), 2 agents (`ana`, `bruno`), public channel `general`.
Run killed externally via SIGTERM (graceful stop). The build included the
local retry-prompt/fixture repair for the #141/#145 merge collision; it has
no bearing on this run (0 retries, 0 trims, no retry path executed).

## What happened

- p0-p2: warm, in-persona opening exchange (3 messages, coherent private
  motives, reply via event handle, no fallbacks, no prompt trims).
- p3-p63: zero cognition calls from either agent. The run ends with ana's
  question ("tudo bem sim, e contigo?") unanswered for ~5 minutes.

## Findings

1. `cold_start_bootstrap` pins at 1.0 and fires every pulse without producing
   an action-intent call. Both agents: value 1.0 vs threshold 0.3,
   `lastFiredAt` advancing to 61. This is the residual risk documented in the
   #142 review: growth-only + clamp, exempt from the passive-decay formula.
2. A silent room cannot self-start: for the other 16 sources, the passive
   growth fixed point (`growthRate / (decayRate * 0.5)`) sits below the firing
   threshold in every case — e.g. `repair_urgency` plateaus at 0.480 vs 0.50,
   `reply_pressure` 0.400 vs 0.45, `avoidance_exit` 0.400 vs 0.45, both agents.
   Verified against the logged final snapshots.
3. The stagnation layer escalates correctly and does nothing else: yellow at
   p10-p40 (0.604-0.702), red at p50 and p60 (0.843, `message_loop`
   attractor, BDI 0.96, IGE/ISD/CNS 1.0). Six warnings total; no intervention
   is wired to the red level (see #129).

## Context

- LLM budget (`llmCallBudgetPerMinute: 10`) was never the constraint: 3 calls
  in the first 20s, none after. No budget-denial events in the stream.
- No `llm_failure`, no `prompt_trimmed` events: prompts stayed under the
  2048-token cap; the trim machinery never engaged.
- Rumination bookkeeping advances (`lastRuminationPulse: 63`) but no
  reflection LLM calls are made and no memories commit (`memories: []`
  throughout).
