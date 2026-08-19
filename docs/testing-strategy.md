# Testing Strategy & Quality Standards (perfectman)

Applies to the fast deterministic suite (~685 `it`/`test` blocks in 65 files across
`shared`, `engine`, `server`, and the vitest tests inside `eval`).
The `eval` **benchmark** (123 rotated scenario tasks) is explicitly **out of this
budget** — it is a benchmark layer, not a unit suite (see Non-goals).

## 1. Why this document exists

The suite grew to 685 tests without a classification scheme or a quality bar.
Symptoms observed in the codebase:

- **Cross-layer re-assertion** — the same invariant is asserted at multiple
  layers. Example: visibility rules are asserted in `engine` unit tests
  (`visibility.test.ts`, `visibility-security.test.ts`), in server integration
  (`visibility-invariants.test.ts`), and again in e2e
  (`pipeline-invariants.e2e.test.ts`).
- **Suite cloning instead of parameterization** — `cold-start`,
  `exclusion-cascade`, `no-op-inhibition`, and `private-channel-motive` e2e
  suites each repeat the same ~10 assertions against a different seed. One
  scenario family, written four times.
- **Pattern-duplicated validation loops** — `shared/src/__tests__/constants.test.ts`
  re-implements the same range/cardinality loops by hand for every constant
  table instead of validating the tables against their zod schemas once.
- **No enforcement mechanism** — nothing stops the next agent stream from
  adding another layer of the same assertions.

The architecture already provides the seams this strategy needs (pure engine
with a no-IO guard test, `IDeliveryGateway` / `AgentRuntime` interfaces,
in-memory ↔ SQLite repositories, mock + real LLM providers, config-driven
composition). The missing piece is a taxonomy plus mechanical quality rules,
not a refactor of production code.

Agent-driven development constraint: agents default to writing many small
tests, and coverage-percentage targets incentivize exactly that. This strategy
uses **checkable rules** (suffixes, caps, a mutation-score gate) instead of
taste or coverage percentages.

## 2. Principles

1. **Confidence per unit of time.** Prefer the cheapest layer that can genuinely
   fail for a real defect. Never assert the same invariant at two layers; the
   lowest layer that can catch it owns it.
2. **Tests resemble usage.** Go through public package surfaces; inject only
   I/O (repos, gateways, LLM, clock).
3. **Deterministic.** No wall clock, no network, no shared global state; seeded
   RNG; injected time.
4. **Quality over count.** Mutation kill score on `engine` is the quality gate;
   property tests replace hand-written edge-case lists.
5. **Classification is enforced, not aspirational.** Filename suffixes + an
   audit script that fails CI when the rules are violated.

## 3. Taxonomy (honeycomb shape for this repo)

| Layer | Suffix | Where | Role | Current | Budget intent |
|---|---|---|---|---|---|
| Static | — | CI | `typecheck` + lint | — | always on |
| Contract | `*.contract.test.ts` | 1 file per package boundary | zod schemas + boundary parsing; constants/config validated **against their schema** | shared ~77 | ~30 |
| Integration | `*.integration.test.ts` | `src/__tests__/` | Engine: through public step API with injected deps. Server: real `SimulationRuntime` + in-memory repos + mock LLM + recording gateways, asserted through public surface | engine 216, server internals | engine ~80; server grows here |
| E2E | `*.e2e.test.ts` | `src/__e2e__/` | One suite per behavioral divergence; asserts **only cross-component wiring** invisible at lower layers | 12 suites | ≤6 suites |
| Eval (benchmark) | — | `packages/eval` | Scenario → judge → calibrated score over model behavior; run on demand / scheduled | 123 tasks | untouched, excluded |

Budget target: **~685 → ~280–320** fast deterministic tests. The eval benchmark
(123 tasks) is not part of this number.

### Contract decision (agreed)

Zod only. No double-drift parity suites (mock↔real LLM shape, in-memory↔SQLite
parity) in the test suite. The residual drift risk is acknowledged and covered
by process: `packages/eval` local-model runs (`--mode local --judge llm`)
surface provider drift manually.

### Tooling decision (agreed)

No Turborepo/Nx now. A git-diff affected script (`git diff --name-only` →
`pnpm --filter` on touched packages + dependents) improves the dev loop without
a new tool. Revisit only if CI time becomes the bottleneck.

## 4. Quality standards (the refactor workstream)

Each standard is concrete and maps to current files.

**Q1. Behavioral assertions over implementation detail.** Prefer observable
behavior; keep internal-field assertions (`lastProcessedEventId`, accumulator
seeding) only where they are the contracted effect of the layer — they belong
in integration tests, never in e2e.

**Q2. Schema-driven validation.** Constant tables and config objects are
validated against their zod schema **once**; never hand-write matching range
loops. Current `constants.test.ts` range/cardinality loops collapse into schema
validations; only behavior-specific facts (ordering, lookup results, threshold
ordering like `yellow < red < critical`) stay as explicit tests.

**Q3. No cross-layer duplication.** An invariant is asserted at the lowest
layer that can fail for it. E2E may assert wiring/projection effects only.
Enforced by review and by the audit script (identical assertion strings across
layers).

**Q4. Parameterization over suite cloning.** The same scenario family is one
suite with `it.each` over seeds/configs. The four cold-start-family e2e suites
collapse into one.

**Q5. Shared fixtures and factories.** Per-package `tests/helpers` for
recurring arrangements: the server `SimulationHarness` already exists — extend
it; extract the agent-state factory used in `eval/src/test/judge-signals.test.ts`
into a shared fixture; scenario builders already live in `shared`.

**Q6. Arrange–Act–Assert and one-concept files.** File names encode behavior;
test names state the violated invariant; each test has a single assertion
cluster.

**Q7. Determinism.** Injected clock (already implemented), seeded RNG, no
sleeps, simulated provider timeouts (already implemented). Every async test has
a bounded timeout.

**Q8. Meaningful failures.** Loop assertions carry context messages naming the
failing entity (`${persona.id}.${dim}` pattern already used in
`constants.test.ts` — keep and spread it, never assert inside a loop without
the element identity in the message).

**Q9. No smoke-only assertions everywhere.** "Completes pulse without error"
belongs once per suite family, not once per suite.

**Q10. Evals stay evals.** The unit tests in `packages/eval` (`probes`,
`judge-signals`) test the *harness* and are normal vitest tests; the 123-task
benchmark is a benchmark artifact and is excluded from all caps above.

**Q11. No bad habits — assertions must be able to fail.** Every assertion must
be able to actually fail when production breaks. An initial audit against the
real implementation found the following classes of defects (all currently
passing):

| Bad habit | Found examples | Rule |
|---|---|---|
| **Dead assertion** — cannot fail by construction (nanoid never returns empty) | `event-log.test.ts:32`, `channel-registry.test.ts:23`, `command-handlers.test.ts:23` (`expect(id).toBeTruthy()`) | Delete; replace with a property assertion on the object the ID belongs to, or drop |
| **Weak terminal `toBeDefined()`/`toBeTruthy()` as the only check of a behavior** | `no-op-inhibition.e2e.test.ts:49,93`; `private-channel-motive.e2e.test.ts:61,80` | Never end a behavior test at existence — follow with at least one property assertion (compare `pipeline-invariants.e2e.test.ts:79-80`, which does it right) |
| **Bare `as any` casts** | `html-snapshot.e2e.test.ts:115,119` (type already declared on line 112 — cast is redundant and hides typing drift); `validate-intent.test.ts:84,161` (negative fixtures — cast is necessary, idiom is wrong) | Forfeit redundancy: if the type exists, use it. For negative fixtures, use the narrowest cast (`as ActionIntent["intentType"]`) with a comment explaining why the type system is bypassed. No bare `as any` anywhere |
| **Non-null `!` on freshly built fixtures** | `otherStates[i]!` in e2e harnesses, `committedEvents[0]!` in intent-resolver tests | The `!` is fine only after an earlier assertion proved existence; otherwise assert existence explicitly first |
| **Tests of test-doubles' own behavior** | `mock-llm-provider.test.ts` | Doubles must be contract-thin; behavior tests on a double pin the double, not the product — keep only interface-compliance checks |
| **Unverifiable/unused mocks & spies** | `vi.fn()` in suites where the spy is never asserted | Every mock/spy is either asserted (`toHaveBeenCalled*`) or documented as an intentional sink |
| **Smoke-only assertions duplicated per suite** | "completes pulse without error" in every e2e suite | Once per suite family (Q9) |

A full sweep of all 65 test files against this table is part of P1 (rename/sort
pass runs with the hygiene sweep) and is enforced afterward by the audit script
(dead-assertion and weak-terminal greps are mechanically checkable).

## 5. Migration plan

| Phase | Work | Evidence of success |
|---|---|---|
| P0 Baseline | Inventory every test file; label target layer; **run the Q11 hygiene sweep** (dead assertions, weak terminals, `as any`, unchecked spies); write the classification manifest | `docs/test-inventory.md` + hygiene findings list |
| P1 Classify & rename | Move/rename files to layer suffixes and locations; move constants/config validation to the contract layer; **fix every Q11 finding found in P0**; no behavior change | `pnpm build` + `pnpm test` green, same count, zero hygiene findings |
| P2 Redundancy cut | Collapse 4 e2e family suites → 1 `it.each`; strip e2e assertions already owned by integration; remove duplicate invariant loops | count drops measurably; `pnpm test` green |
| P3 Quality refactor | Apply Q1–Q10 to every touched file: schema-driven constants, factories/helpers extraction, context messages, determinism audit | mutated files pass standards checklist |
| P4 Property tests | fast-check: emotion bounds, circumplex math, weighted-kappa/alpha calibration, signal-checker numeric invariants | property tests replace hand-written edge-case `it`s |
| P5 Mutation gate | Stryker on `engine`, target ≥80% mutant kill; delete or fix tests the mutants expose; wire into review gate | Stryker report committed; gate enforced in CI |
| P6 Guardrails | Audit script (`node scripts/audit-tests.mjs`): suffix compliance, e2e ≤6 suites, ≤25 `it`/file, cross-layer duplication grep; CI job; ADD review checklist references this doc | CI fails on rule violations |

Approximate target after P2–P4: **~685 → ~280–320** fast tests, evals untouched.

## 6. Review checklist (ADD pipeline / code review)

- [ ] File matches layer suffix and location.
- [ ] No assertion duplicated from a lower layer (grep check).
- [ ] Tests go through public surfaces; no pinning of implementation internals
      outside integration layer.
- [ ] Deterministic: no clock/network/global state; seeded RNG; bounded
      async timeouts.
- [ ] Loop assertions carry element-identity context messages.
- [ ] No dead/tautological assertions (every assertion can fail for some
      production bug; no `expect(id).toBeTruthy()` on generated IDs).
- [ ] No bare `as any` / `as unknown as X`; negative fixtures use narrow casts
      with a comment; no `!` before an existence assertion.
- [ ] No behavior test ends at `toBeDefined()`/`toBeTruthy()` — property
      assertions follow.
- [ ] No tests of test-double behavior; every mock/spy is asserted or declared
      an intentional sink.
- [ ] Same-family scenarios are parameterized (`it.each`), not cloned.
- [ ] Constant/config validation is schema-driven, not hand-written loops.
- [ ] `engine` mutation score unchanged or better (when gate exists).
- [ ] No coverage-percentage requirements added anywhere.

## 7. Non-goals

- No double-drift parity suites (zod-only contract decision).
- No Turborepo/Nx now.
- No coverage-percentage targets — mutation score replaces them.
- Eval benchmark (123 tasks) untouched; evals excluded from the suite budget.
- No snapshot tests for deterministic code. Snapshot/characterization tests
  are reserved for fuzzy dynamics (simulation trajectories) if needed later.