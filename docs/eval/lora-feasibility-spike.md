# LoRA per-persona fine-tuning — feasibility spike

Status: **documented spike, not implemented.** This file records what an
experiment would look like, what data already exists, and which measured
outcomes would justify going further. No runtime code depends on any of it.

## The hypothesis

Persona traits, voice guidelines, and style examples currently live in the
prompt (`action-intent-prompt-builder.ts`'s persona section) and are
re-sent on every generation call. Lightweight per-persona LoRA adapters on
the local Qwen3 models could move that identity into the weights: fewer
prompt tokens per call, potentially stronger `voice_match` (2.559 in
`docs/eval/evidence/bench-mock-baseline.json` vs the 3.5 target) and
`in_character` — the two axes below target in the pinned mock baseline.
`creativity_unhinged` already clears its target there, so gains there are
a bonus, not the motivation. The known cost of role-specific fine-tuning
is weakened general reasoning — `interpretation` must be measured in the
same run (experiment shape step 5 below).

## Why the cheaper in-repo levers do not already cover this gap

A spike for training infrastructure should first say why the levers already
in this repo have not moved the weak axes. Measured state of each:

- **#29's styleExamples-curation hypothesis** — the packs hold 9–10
  single-line style utterances per persona (see counts below), the smallest
  and cheapest thing that shapes `voice_match`, and the exact seed data any
  fine-tune would consume. There is no A/B on record that adds lines or
  turns to the packs and re-measures the axes.
- **Per-persona sampling knobs** — every pack carries `sampling`
  (`temperature`, `repetitionPenalty`, `topP`, `maxTokens`), and the
  temperature sweep (`sweep:temperature`) exercises exactly this family of
  knobs, but no sweep has been run per persona against the judge axes.
- **#68's salience retrieval (engine, merged)** — changes which memories
  reach the perception packet; it affects conditioning, not generation
  voice, and measured zero gate-bench movement.

None of the three has a `voice_match` A/B on record. **Open question (a
project-direction judgment, not a measurement):** if a curation or
trimming pass gets `voice_match` most of the way to 3.5, the adapter case
loses most of its motivation. The spike should not start until that cheap
pass has been attempted and reported.

## Existing assets (measured)

Compiled persona packs live in `packages/shared/src/persona-packs/`:

| Pack | `styleExamples` | `voiceGuidelines` | memory seeds |
|---|---|---|---|
| bruno | 9 | 5 | 2 |
| caio | 9 | 5 | 2 |
| goulart | 9 | 5 | 2 |
| leo | 10 | 5 | 2 |
| mariana | 9 | 5 | 2 |

The `styleExamples` are **single-line utterances, not prompt–response
pairs**, and all five packs also carry a `privateMotiveLexicon` (consumed
by `packages/eval/src/bench/persona-aware-mock.ts`). The "10–20 curated
examples suffice" claims in the fixed-persona SLM literature (e.g. arXiv
2511.10277) use those examples as **seeds for a synthetic-expansion
pipeline that trains on roughly 115–564 reviewed pairs** — so the pack
contents are seed material, not a training set, and a data-preparation
step is required (below).

- **Serving path**: Ollama supports Modelfiles with `ADAPTER` LoRA layers,
  but its safetensors adapter import covers Llama/Mistral/Gemma only —
  **Qwen is not in the converter set**. A qwen3:1.7b PEFT LoRA needs the
  `llama.cpp convert_lora_to_gguf.py` detour, which the Ollama docs warn
  behaves erratically unless trained on the exact base, and single-adapter /
  no-hot-swap limits are still open upstream (ollama#14032, #9548) — five
  personas means five separately created and loaded models. The local
  docker infra under `docker/qwen3/` does not use `ADAPTER` today.
- **Measurement**: bench slices (`--slice canary`), rule + llm judges, and
  the `content-repetition` and `cross-agent-echo` probes measure whether
  fine-tuned personas repeat or converge differently.

## Data preparation (the "no new collection" claim was wrong)

The reviewer finding stands: the two facts the section asserted do not
hold — the referenced recipe's pairs are seeds for a synthetic-expansion
pipeline (a data-prep step that is itself new collection), and the packs
are below even the seed range in count and kind. The honest experiment
shape therefore includes:

1. **Source filtering** — the only persona-committed transcripts on main
   are outputs of exactly the pipeline whose weak voice motivates this
   spike (the rule-judge `voice_match` mean is the same mock). Training on
   them is self-distillation of the current voice and can't be expected to
   lift `voice_match` above its source. Require filtering to
   high-judge-scored turns, or curated/synthetic data.
2. **Synthetic expansion** (per the reference recipe) to a reviewed
   prompt–response set before training.
3. **Leakage guard** (unchanged from the original doc): EXCLUDE every
   benchmark/golden slice scenario from the training export — training on
   the evaluation set would inflate `voice_match` exactly where the
   decision rule looks.

## Experiment shape (maintainer-run; needs live models)

0. **Smoke-test an adapter first, under a pinned Ollama version.** The
   repo pins `ollama/ollama:latest` by tag, not digest
   (`docker/qwen3/qwen3.compose.yml`), so any adapter experiment is
   unreproducible until the image is pinned or the exact tested version is
   recorded. Before any training spend: convert a trivial LoRA to GGUF and
   load it as `ADAPTER` on qwen3:1.7b, and record the Ollama version it
   works on — the single-adapter/no-hot-swap constraint alone may kill the
   five-persona serving story on this stack.
0b. **Pre-experiment, zero training: what does the persona section buy?**
   Benchmark base model + full prompt vs base model + trimmed prompt
   (identity section removed) on the weak axes, same slice and seed. This
   isolates the variable independently of the adapter, costs nothing, and
   may already move `voice_match` enough to change the premise.
1. Export each persona pack to a JSONL chat dataset: system = compiled
   identity frame; user turns from filtered past scenario transcripts
   where that persona acted; assistant turns = the persona's actual
   committed content. Start with the two strongest-voice personas only.
2. Train one LoRA adapter per persona on qwen3:1.7b (small model first —
   cheapest signal). Keep rank ≤ 16, one epoch, then stop.
3. Register a `Modelfile.perfectman-<persona>` with `ADAPTER`.
4. Benchmark A/B: base model + full prompt vs **adapter + trimmed prompt**
   against the step-0b pre-experiment numbers, so the adapter's marginal
   contribution is separated from the trim's.
5. Measure: the three target axes AND `interpretation` — the known cost of
   role-specific fine-tuning is weakened general reasoning, so a rise in
   voice scores that coincides with an `interpretation` drop is a net loss.

## Decision rule

Proceed further only if: `voice_match` improves by ≥ 0.5 on average across
trained personas *over the step-0b trimmed-prompt baseline* (the adapter
must beat the trim, not the full prompt), `interpretation` does not fall
below its current mean, and quality holds at trimmed tokens. Token count
itself is not a decision input: dropping the persona section is a fixed
trim, so "≥30% prompt-token savings of the persona section" is true by
construction for any accepted adapter — the falsifiable version is
**quality at trimmed tokens at non-regressing `interpretation`**. (The
token share of the persona section is computable today by assembling two
prompts, with and without the persona container, and diffing
`inputTokensEstimate`; it is a reporting number, not an outcome.)

Otherwise stay prompt-only and revisit after the pack format stabilizes.

## Known risks

- Catastrophic forgetting of commonsense/social reasoning (measured via
  `interpretation`, above).
- Adapter drift between Ollama versions; **pin the image or record the
  exact version smoke-tested in step 0** — the repo currently pins neither
  digest nor tag.
- Qwen adapter conversion fragility (step 0) and the single-adapter /
  no-hot-swap serving constraint (ollama#14032, #9548) — five personas →
  five separately created and loaded models; acceptable at benchmark scale,
  questionable for production multi-agent rooms.
- Annotation-free alignment research (persona-aware contrastive methods)
  is promising but unreplicated here; treat claims as unverified until the
  experiment above runs.
- Train/eval leakage: transcripts from benchmark or golden scenarios must
  never enter the training export while those same scenarios gate the
  decision rule.