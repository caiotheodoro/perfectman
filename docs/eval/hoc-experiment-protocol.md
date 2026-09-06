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

`examples/eval/hoc-jury.json`: primary judge `deepseek/deepseek-v4-flash` (scores narration only — under a jury the transcript verdict is the jury median), jurors `z-ai/glm-5.3-flash`, `qwen/qwen3.8-27b-free`, `deepseek/deepseek-v4-flash`. The DeepSeek juror shares the generator's family; its presence is flagged in the label and in `run-meta.json`. Self-preference bias is reduced by the median over three families, not removed. All jurors at temperature 0.

The three are what a single OrcaRouter key scoped to the free/flash tier can reach (`model_access_denied` for `openai/*` and `anthropic/*`); a key with wider scope can swap stronger non-DeepSeek jurors in without touching the harness. GLM has no thinking switch through the router and spends 4000+ tokens reasoning over a 32-pulse transcript, so its juror entry carries `maxTokens: 8000` and `timeoutMs: 300000` (measured 146 s on the Sítio read); DeepSeek with thinking disabled holds the narration seat; Qwen's thinking is disabled through `chat_template_kwargs`.

## Prompt template versions

`promptTemplateVersions` in `run-meta.json` identifies the agent prompt template. `hn81j7` is the template every M0 read used (baseline and main arms); `2imp7w` is prompt round 1 (silence as a move, Portuguese pin with Portuguese exemplars, ungated creativity with the generic-reply list, memory writes on belief change, memories trimmed last). Arms with different template versions are not a pair.

## Command

```sh
pnpm --filter @perfectman/eval bench --slice hoc --mode local --judge llm \
  --judge-config examples/eval/hoc-jury.json \
  --seeds 42,43,44 --pulse-limit 32 --run-id hoc-baseline-<sha7>
```

3 scenarios (`hoc_fatia_que_nao_existe`, `hoc_heranca_do_sitio`, `hoc_banda_no_festival`) × 3 seeds = 9 runs per arm, n=9 per axis. Add `--variants 1` so each scene runs its canonical v0 only (the bench otherwise expands every scene into its seed variants; `--limit` truncates the whole list, not per scene). An iteration read is `--seeds 42 --variants 1` (3 runs, ~20 min); the 3-seed matrix is for milestones. Seed pinning on a router is best effort; the per-seed spread is reported (`judgeAxisStats`) rather than assumed away.

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
