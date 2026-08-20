# Contributing to Perfectman

Thanks for taking a look. This is an early-stage experiment, so expect design churn — the fastest way in is usually a small PR against an open question, not a big architectural proposal.

## Setup

```bash
pnpm install
pnpm build
```

Run the test suite before opening a PR:

```bash
pnpm test:all     # unit/integration tests + the test-hygiene gate (scripts/audit-tests.mjs)
pnpm lint         # typecheck across all packages
```

`pnpm test:all` is what CI-equivalent checks run — a PR that doesn't pass it locally won't merge. See [`docs/testing-strategy.md`](docs/testing-strategy.md) for the test taxonomy and what makes an assertion meaningful here; it's a living guideline, not boilerplate.

## Where things live

```text
packages/
  shared/  — shared types, schemas, constants (pure)
  engine/  — pure social presence engine: attention, motivation, emotion, pressure, inhibition (no I/O)
  server/  — event-oriented runtime: event log, command handlers, intent resolver, projections,
             agent runtime/LLM providers, persistence, delivery gateways, CLI entrypoint
  eval/    — evaluation harness
```

Read [`docs/README.md`](docs/README.md) first for the canonical architecture and design decisions, and [`docs/plans/master-contract.md`](docs/plans/master-contract.md) for the cross-package ownership map and type contracts (e.g. the `PersonaConfig` vs `PersonaPromptProfile` split) if your change crosses a package boundary.

## Picking something to work on

- Issues tagged `good first issue` are scoped and don't require reading the full architecture doc first.
- [`docs/README.md`](docs/README.md#current-open-questions) lists genuinely undecided design questions (private-channel spectator visibility, scoring machinery, which symbolic actions earn their keep). If one interests you, open an issue or discussion before a big PR so the direction gets agreed on first.
- Use GitHub Discussions for design debate; issues for concrete, scoped work.

## Personas and private data

Real, person-specific persona files are gitignored by design (`config/index.json`, `config/personas/`, `docs/personas/` subfolders except templates). Never commit real names, transcripts, or persona interview material outside the example/template paths in `examples/personas/`. See [`docs/personas/README.md`](docs/personas/README.md) for the intended workflow.

## PR expectations

- Keep PRs scoped to one concern; cross-package changes should respect the ownership map in `docs/plans/master-contract.md`.
- Add or update tests per `docs/testing-strategy.md` — a test that can't fail for a real bug isn't worth adding.
- Explain *why*, not just *what*, in the PR description if the change touches behavior (emotion model, motivation thresholds, intent resolution) rather than pure plumbing.

First-time contributors: expect a response within a few days. If you don't hear back, it's fine to ping the PR/issue.
