# LoRA per-persona fine-tuning — feasibility spike

Status: **documented spike, not implemented.** This file records what an
experiment would look like, what data already exists, and which measured
outcomes would justify going further. No runtime code depends on any of it.

## The hypothesis

Persona traits, voice guidelines, and style examples currently live in the
prompt (`action-intent-prompt-builder.ts`'s persona section) and are
re-sent on every generation call. Lightweight per-persona LoRA adapters on
the local Qwen3 models could move that identity into the weights: fewer
prompt tokens per call, potentially stronger `voice_match` / `in_character`
/ `creativity_unhinged` (the persistently weakest axes).

## What already exists (no new collection needed)

- **Seed data**: compiled persona packs carry style examples, voice
  patterns, private-motive lexicons, and memory seeds per persona
  (`packages/shared/src/persona-packs/`). Research suggests 10–20 curated
  examples per persona can be enough for fixed-persona SLM dialogue — the
  packs are in that range today.
- **Serving path**: Ollama supports Modelfiles with `ADAPTER` LoRA layers;
  the docker/native infra under `docker/qwen3/` is the same free/local
  stack the benchmarks already run on.
- **Measurement**: the bench harness + named slices give before/after axis
  scores with pinned sampling; the repetition guard and echo probes measure
  whether fine-tuned personas repeat or converge differently.

## Experiment shape (maintainer-run; needs live models)

1. Export each persona pack to a JSONL chat dataset: system = compiled
   identity frame; user turns from past scenario transcripts where that
   persona acted; assistant turns = the persona's actual committed content.
   Start with the two strongest-voice personas only.
2. Train one LoRA adapter per persona on qwen3:1.7b (small model first —
   cheapest signal). Keep rank ≤ 16, one epoch, then stop.
3. Register a `Modelfile.perfectman-<persona>` with `ADAPTER`.
4. Benchmark A/B: base model + full prompt vs adapter + trimmed prompt
   (identity section removed), same slice (`--slice canary`), same seed.
5. Measure: the three target axes AND `interpretation` — the known cost of
   role-specific fine-tuning is weakened general reasoning, so a rise in
   voice scores that coincides with an `interpretation` drop is a net loss.

## Decision rule

Proceed further only if: `voice_match` improves by ≥ 0.5 on average across
trained personas, `interpretation` does not fall below its current mean,
and prompt-token savings ≥ 30% of the persona section. Otherwise stay
prompt-only and revisit after the pack format stabilizes.

## Known risks

- Catastrophic forgetting of commonsense/social reasoning (measured via
  `interpretation`, above).
- Adapter drift between Ollama versions; pin the base model hash.
- Five personas → five adapters → serving matrix grows; acceptable at
  benchmark scale, questionable for production multi-agent rooms.
- Annotation-free alignment research (persona-aware contrastive methods)
  is promising but unreplicated here; treat claims as unverified until the
  experiment above runs.
