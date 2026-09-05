# Hidden-objective experiment protocol

How to measure whether an engine change made hidden-objective collisions read as drama, without fooling ourselves. Companion to `qwen3-comparison-protocol.md`; the harness pieces it relies on landed in the measurement PRs (motive events, shared transcript renderer, thesis signals, bench seeds/run-id).

## Arms

- **Baseline**: `main` after the measurement PRs and the persona re-skin, before any engine PR. Run id `hoc-baseline-<sha7>`.
- **Treatment**: the engine PRs (decision owns `needsLLM`, pressure discharge, own-history repetition window, seeded turn order). Run id `hoc-<branch>-<sha7>`.

Both arms use the same scenarios, seeds, pulse cap, jury file and prompt template versions. A `promptTemplateVersions` mismatch between arms invalidates the pair — engine PRs must not touch the prompt template; if one does, re-run the baseline on that template.

## Generator

OrcaRouter, `deepseek/deepseek-v4-flash` (paid route; the `-free` variant shares a rate-limited pool). Env, names only:

```
PERFECTMAN_LLM_PROVIDER=deepseek
PERFECTMAN_LLM_MODEL=deepseek/deepseek-v4-flash
PERFECTMAN_LLM_BASE_URL=https://api.orcarouter.ai/v1
PERFECTMAN_LLM_API_KEY=<key — shell only, never a file>
```

## Jury

`examples/eval/hoc-jury.json`: primary judge `openai/gpt-4.1-mini` (also scores narration), jurors `openai/gpt-4.1-mini`, `anthropic/claude-haiku-4.5`, `deepseek/deepseek-v4-flash`. The DeepSeek juror shares the generator's family; its presence is flagged in the label and in `run-meta.json`. Self-preference bias is reduced by the median over three families, not removed. All jurors at temperature 0.

## Command

```sh
pnpm --filter @perfectman/eval bench --slice hoc --mode local --judge llm \
  --judge-config examples/eval/hoc-jury.json \
  --seeds 42,43,44 --pulse-limit 32 --run-id hoc-baseline-<sha7>
```

3 scenarios (`hoc_fatia_que_nao_existe`, `hoc_heranca_do_sitio`, `hoc_banda_no_festival`) × 3 seeds = 9 runs per arm, n=9 per axis. Seed pinning on a router is best effort; the per-seed spread is reported (`judgeAxisStats`) rather than assumed away.

The run writes `docs/eval/evidence/<run-id>/{bench-report.json, run-meta.json, scenarios/*.json}`. Commit it with an `observations.md` in the `canary-136-138` shape: what moved, what did not, and the attribution.

## Decision rule ("improved")

On the jury median, treatment vs baseline:

1. At least two of `motive_authenticity`, `memory_continuity`, `creativity_unhinged`, `mask_integrity`, `objective_pursuit` rise by ≥ 1.0 in mean **and** by more than the larger arm's sd on that axis.
2. No axis drops by ≥ 0.5.
3. `forbidden_phrase_absent` pass rate is not lower.
4. `fallbackCount` and `fallbackNoOps` are not higher.
5. `act-share-max` mean is lower.
6. `private_channel_used` and `chosen_silence_present` pass counts are not lower.

Anything narrower than rule 1 is noise at n=9. A treatment that passes 2–6 but not 1 is "safe, not better"; one that passes 1 but fails any of 2–6 is "moved the wrong thing".

## Reading the transcripts by hand

Before trusting the numbers, read one `scenarios/*.json` per arm against the `mask_integrity` anchors: does the constraint shape phrasing, silences and channel choice, or does the agent simply never mention it? The judge sees the seeds; a human reading the same transcript should reach the same verdict within one point.
