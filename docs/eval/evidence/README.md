# Evidence Suite

Full roleplay evidence generated from the scenario library. Deterministic
(persona-aware mock provider, seed 7) — regenerate with:

```sh
pnpm --filter @perfectman/eval evidence --novela
# real model evidence (requires a local OpenAI-compatible server, e.g. Ollama):
# PERFECTMAN_LLM_BASE_URL=http://localhost:11434/v1 PERFECTMAN_LLM_MODEL=qwen3:8b \
#   pnpm --filter @perfectman/eval evidence --novela --mode local --out docs/eval/evidence/local
```

## Contents

| Artifact | What it is |
|---|---|
| `evidence-report.md` | Human-readable synthesis: signal/probe/judge aggregates by category, 12 key scene transcripts, and the 90-pulse long-form novela run with final emotional states |
| `evidence-index.json` | Machine-readable per-scenario summary |
| `scenarios/*.json` | Per-scenario evidence: full transcript (messages + private motives), final agent states, probes, signals, judge axis scores, LLM calls |
| `novela-run.json` | The 90-pulse continuous arc — gossip, resentment, public mock, exclusion — as one timeline |
| `bench-mock-baseline.json` | The 123-task rotated benchmark baseline (noise-floor analysis) |

## Reading the transcripts

- `[motive: …]` lines are the agent's private motive summary (evidence of
  motive authenticity) — e.g. Bruno mocked publicly leaves 24 no-ops with
  motives like *"hurt_hidden_as_sarcasm"* and *"fear_of_being_the_last_pick"*,
  shame holding at 0.96 across the scene.
- `finalStates` show the emotional trajectory's endpoint per agent.
- `judge` is the v0 rule-judge proxy — see `docs/eval/README.md` for the
  calibration caveat.

## Notable observations in this evidence set

1. **Negative contagion compounds** (novela run): by pulse 90 all five agents
   sit at ~0.94 jealousy/resentment/fearOfExclusion — the docs' intended
   "paranoia spreads faster than calm" behavior, observed at full strength.
2. **Private channels are motive-gated**: channels appear only in scenes
   whose seeds create a real drive (gossip/alliance/vulnerability), and
   public-dominance personas (Goulart, Léo) never scheme on status alone.
3. **Mentions now reliably produce replies**; **lurkers stay silent with
   engine-recorded no-ops**; **shamed agents hold silence with motive**.
