---
name: pr-house-style
description: "Rewrite a pull-request title and body to this repo's maintainer house style before opening the PR. Use whenever you are about to run `gh pr create` for perfectman, or when asked to clean up / rewrite a PR description. Derived from matheusht's merged PRs."
---

# PR House Style

Rewrite a draft PR title and body so it is indistinguishable from a `matheusht` PR in this repo. Run this immediately before `gh pr create`, on whatever draft you have (a change-report, a pipeline outcome, a rough bullet list).

Output is a title line and a Markdown body. Nothing else. Do not open the PR from inside this skill unless the caller asked for that in the same breath — hand the polished text back.

## Source Of Truth

The style is derived from ~20 merged PRs authored by `matheusht` (PRs #59–#79 range). To refresh or extend the sample:

```bash
gh api 'repos/caiotheodoro/perfectman/pulls?state=closed&per_page=100' --paginate \
  --jq '.[] | select(.user.login=="matheusht" and .merged_at!=null) | "### " + .title + "\n" + .body + "\n"'
```

`joao-ryft` / `yoarajota` PR **bodies** are agent-generated — do not sample them for style (his inline review *comments* are a different voice, covered by `write-as-joao`). `matheusht` bodies are hand-written and consistent; they are the model.

## Title

`type(scope): imperative lowercase summary` — Conventional Commits, one line, ~50–72 chars.

- `type`: `feat` · `fix` · `refactor` · `docs` · `ci` · `chore`.
- `scope`: the package or area, lowercase — `eval` · `agent` · `server` · `llm` · `engine` · `shared` · `goal-layer` · `docker` · `ci` · `simulation` · `delivery`. Pick the one a reader would grep for.
- Summary: verb-first, lowercase, no trailing period. "adopt AI provider SDK", "survive unparseable LLM judge responses with retry + prose salvage".
- Append ` (#NN)` **only** when the PR closes a tracked issue with that number. Otherwise no ref.

## Body

Exactly these sections, in this order. No others — no "How", no "Testing", no "Screenshots", no checklist, no "Notes for reviewer".

```
## What

<one framing line, verb-first, ends with a colon>

- <concrete change — exact symbol / file / flag / number in backticks>
- <concrete change>
- <...>
- <test summary folded in: "N tests: <what each covers>, terse">

## Why

<1–3 sentences of specific motivating context — a real gap or incident. OMIT this
section entirely when the framing line in What already answers "why".>

## Validation

- `pnpm lint` PASS - `pnpm test:all` PASS (+N)
- <1–2 lines of concrete evidence: a head-to-head number, a live run result, a committed evidence path>
```

### `## What` rules

- **Framing line**: present tense, verb-first, ends with `:`. Templates that fit almost everything:
  - `Adds <thing> to <where>:`
  - `Replaces <old> with <new>:`
  - `Turns <X> into <Y>:`
  - `Upgrades <area> from <A> to <B>:`
  - `Makes <X> resilient to <failure>:`
  - `Measures <tradeoff> that <gap>:`
- **Bullets** name the substantive changes only. Every bullet carries at least one backticked identifier — a symbol, a filename, a flag, a config key, a number. No bullet is a vague verb phrase ("improve reliability", "clean up code").
- **Contrasting pairs** get bold lead-ins: `**Old proxy**:` / `**New proxy**:`, `**Strict retry**:` / `**Prose salvage**:`.
- **Tests** are one closing bullet, not a section: `Five unit tests: single-type floor, uniform ceiling, skew monotonicity, operator-noise exclusion, empty input.` Name each case in 2–4 words.
- **Honest scoping** is stated plainly, in the same register, when the change has a known limit: `Committed mock baseline is honestly flat and says so`, `live-model sweeps drop straight into this harness`. Never bury a caveat and never inflate.

### `## Validation` rules

- First bullet is always the two commands, backticked, joined by ` - `, each followed by `PASS`. Add `(+N)` or `NNN passed (+N <label>)` when there is a test-count delta worth stating.
- Follow with concrete proof, quantified: `edge_mutation_pressure moves 3 -> 4`, `--slice edges -> 12 variant runs, 0 failed, signals 100%`, `4-cell matrix committed under docs/eval/evidence/`. One or two bullets, no more.
- If lint or tests were not run, or an unrelated pre-existing failure exists, say so in one plain bullet. Do not claim a green run you did not see.

## Register

- Declarative and dense. No "This PR…", no "I've…", no "Let me know". Drop the framing, name the thing.
- Quantify everything quantifiable — counts, thresholds, scenario ids, file paths.
- Em-dashes within a sentence are fine (this is not Joao's inline-comment voice). Sectioned Markdown is correct here.
- Never mention AI, agents, pipelines, generated output, or assistant tooling — in the title, the body, or the commit.
- Match the length of the change: a one-module fix is ~10 lines of body; a cross-cutting change is ~18. If the body runs past ~25 lines, it is over-explaining.

## Checklist before handing back

- [ ] Title is `type(scope): lowercase`, `(#NN)` present only if it closes that issue.
- [ ] Body has `## What`, optional `## Why`, `## Validation` — nothing else.
- [ ] `## What` opens with a colon-terminated framing line; every bullet has a backticked identifier.
- [ ] Test cases are one folded bullet, each named.
- [ ] `## Validation` leads with `` `pnpm lint` PASS - `pnpm test:all` PASS `` and follows with quantified evidence.
- [ ] No AI/agent/pipeline mention anywhere.
- [ ] Reads like `matheusht` wrote it.
