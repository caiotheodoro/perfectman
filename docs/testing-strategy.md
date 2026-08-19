# Perfectman — Testing Guidelines

A living guideline for anyone (human or agent) writing or reviewing tests in this
monorepo. It holds **principles and rules**, not a changelog — so it should not
contain test counts, file paths, or results that go stale. If you find specifics
here that drift out of date, fix them toward the general rule.

Guiding goal: tests that are small in number, fast, and able to actually fail
when production breaks. **Green tests do not prove coverage** — an assertion that
cannot fail is worse than none.

## 1. Why this guideline exists

Agent-generated suites tend to grow unbounded and assert nothing. The antidote
used here is a **taxonomy** (what layer a test belongs to), a **quality bar**
(rules that make assertions meaningful), and **mechanical enforcement** (a
hygiene gate) — not taste or coverage percentages.

Never add a coverage-percentage requirement. It incentivizes writing *more*
tests rather than *better* ones. Prefer checks that a test can fail for a real
bug.

## 2. Taxonomy

Choose the **lowest layer that can fail for the invariant**, and assert each
invariant at exactly one layer.

| Layer | Suffix convention | What it tests | Rules |
|---|---|---|---|
| Contract | boundary/type-level | zod schemas, boundary parsing, constant/config validation **against an existing schema** | one file per package boundary; never hand-write range loops that duplicate a schema |
| Integration | `*.integration.test.ts` | a unit's behavior through its public surface with only I/O (repos, gateways, LLM, clock) injected | the big middle — most tests live here |
| E2E | `*.e2e.test.ts` | cross-component wiring not visible at lower layers | one suite per behavioral divergence; may not re-assert lower-layer invariants |
| Static | — | typecheck + lint | always on |
| Evals / benchmark | — | model-behavior scoring (judge, golden labels, calibration) | a **benchmark**, not a unit suite — excluded from count/size rules; run on demand |

Each invariant is owned by the lowest layer that can genuinely fail for it (Q3).

## 3. Principles

1. **Confidence per unit of time.** Prefer the cheapest layer that can fail for a
   real defect. Never assert the same invariant at two layers.
2. **Tests resemble usage.** Go through public package surfaces; inject only I/O.
3. **Deterministic.** No wall clock, no network, no shared global state; seeded
   RNG; injected time; bounded async timeouts.
4. **Quality over count.** Property tests and branch-behavioral tests beat long
   hand-written edge-case lists.
5. **Classification is enforced, not aspirational.** Suffix conventions and the
   hygiene gate are mechanical.

## 4. Quality standards

- **Q1 — Behavioral over implementation.** Assert observable behavior. Internal
  fields belong in integration tests, never e2e.
- **Q2 — Validation against existing schemas.** Where a zod schema exists,
  validate against it instead of hand-writing matching loops. Do not add schemas
  purely for tests.
- **Q3 — One layer per invariant.** The lowest layer that can fail for it owns
  it; higher layers only assert wiring.
- **Q4 — Parameterize, don't clone.** A scenario family is one suite with
  `it.each`, not N copies.
- **Q5 — Shared fixtures.** Recurring arrangements come from shared per-package
  test helpers, not copied per file.
- **Q6 — One concept per test.** File names encode behavior; test names state the
  violated invariant; one assertion cluster each.
- **Q7 — Determinism.** Injected clock, seeded RNG, no sleeps, bounded timeouts.
- **Q8 — Meaningful failures.** Loop assertions carry the element identity in the
  message, so a failure names *which* item broke.
- **Q9 — No smoke-only everywhere.** A "completes without error" check belongs
  once per suite family, not once per suite.
- **Q10 — Evals are not unit tests.** Scoring/benchmark tests are a separate
  layer and excluded from count/size caps.
- **Q11 — Assertions must be able to fail.** No dead or tautological assertions.
  Specific hygiene rules below.

### Q11 hygiene rules (zero-tolerance)

- **No dead assertions.** `expect(id).toBeTruthy()` on a generated ID cannot
  fail. Assert a property of the object instead, or drop it.
- **No weak terminal exists-only checks.** A behavior test must end in a property
  assertion, not a lone `toBeDefined()`/`toBeTruthy()`.
- **No bare casts.** No `as any` / `as unknown as X`. If a type exists, use it.
  For a negative fixture that must hold an out-of-band value, use the narrowest
  cast with a comment explaining the type-system bypass.
- **No `!` before an existence assertion.** Non-null assertions are allowed only
  after a prior assertion proved existence.
- **No tests of test-doubles' own behavior.** Doubles are contract-thin; keep
  only interface-compliance checks, never behavior tests that pin the double.
- **No unverified mocks/spies.** Every `vi.fn()`/spy is asserted
  (`toHaveBeenCalled*`) or documented as an intentional sink.
- **No committed side effects.** Tests that generate artifacts write to a
  gitignored temp dir, never into the tree.

## 5. Enforcement

Run locally: `pnpm test` (unit) and `pnpm test:gate` (hygiene gate).
`pnpm test:all` runs both.

The hygiene gate fails on: `.only`/`.skip`, `as any`/`as unknown`, `@ts-ignore`/
`@ts-expect-error`, `eslint-disable`, dead id-truthy assertions, weak-terminal
`toBeDefined`, and over-cap files. Two informational patterns are allowlisted as
documented exceptions: a deliberate `console` notice in a snapshot
evidence-generating test, and a `deferred()` async orchestration helper.

## 6. Agreed structural decisions

- **Contracts are zod-only.** No double-drift parity suites (mock↔real layer
  shape, in-memory↔SQLite). Drift is surfaced by local-model eval runs.
- **Test the real scheduler.** The scheduler exposes a `stepResolver` test seam;
  commit-ordering tests drive the real scheduler, never a hand-rolled clone.
- **Snapshot/evidence tests write to a gitignored temp dir.**
- **No Turborepo/Nx.** Scope is small; use `pnpm --filter` and a git-diff
  affected script if a dev-loop need arises.
- **Mutation is a per-file diagnostic, not a CI gate.** Batch mutation runs are
  unreliable in this pnpm + vitest-alias monorepo; run per file when auditing
  test effectiveness.
- **Won't-do:** adding zod schemas purely for tests; the git-diff affected script
  (until a dev-loop need justifies it).

## 7. Review checklist (for agents reviewing a test change)

- [ ] File matches its layer's suffix and location; invariant asserted at only
      the lowest owning layer.
- [ ] Tests go through public surfaces; no implementation-interior pinning
      outside integration.
- [ ] Deterministic: no clock/network/global state; seeded RNG; bounded timeouts.
- [ ] Loop/list assertions carry element-identity messages.
- [ ] No dead/tautological assertion (can it fail for a real bug?).
- [ ] No bare casts; no `!` before an existence assertion; no exists-only endings.
- [ ] No tests of double behavior; every mock/spy asserted or an intentional sink.
- [ ] Same-family scenarios parameterized, not cloned; validation is
      schema-driven where a schema exists.
- [ ] No coverage-percentage requirements introduced.
- [ ] No side effects that dirty the working tree.

## 8. Non-goals

- No double-drift parity suites (zod-only contracts).
- No Turborepo/Nx.
- No coverage-percentage targets.
- Eval benchmark tasks are excluded from suite size rules.
- No snapshot tests for deterministic code; characterization tests are reserved
  for fuzzy dynamics (e.g., simulation trajectories).
