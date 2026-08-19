# Test Suite Findings & Phase Tracker

Durable record of the test-suite audit, decisions, fixes, and phase state for
the `refactor/test-taxonomy-and-hygiene` work. Lives in the repo so context is
never lost between sessions. Companion spec: `docs/testing-strategy.md`
(taxonomy + quality standards + migration plan).

## Baseline

- 65 test files, 685 `it`/`test` blocks (728 reported by vitest — some `it.each`
  expand at runtime).
- Distribution: shared 77 (5 files), engine 216 (15), server 376 (43), eval 16 (2).
- Before this work the repo was **red**: `packages/eval/node_modules` was
  missing (no `@types/node@26.2.0`, no workspace links) → `pnpm build` failed
  (TS2688) and one eval test suite failed to load. Fixed with `pnpm install`.
- Baseline after install: build green, 728/728 tests pass.

## Decisions locked (2026 — user-approved)

| Decision | Choice |
|---|---|
| Pattern | Testing Honeycomb (integration-first, e2e capped) + mechanical guardrails, not taste |
| Contract layer | Zod only — no double-drift parity suites (mock↔real LLM, in-memory↔SQLite). Drift risk covered by eval local-model runs |
| Eval accounting | Benchmark (123 tasks) is NOT in the suite budget; only `packages/eval`'s 2 vitest files count |
| Tooling | No Turborepo/Nx now; git-diff affected script for dev loop |
| Quality gate | Mutation-score gate (Stryker on engine), NOT coverage % — coverage incentivizes more tests |
| Count-reduction technique | Property tests (fast-check) during the cut — one property replaces N edge-case `it`s |
| Budget target | ~685 → ~280-320 fast tests; evals untouched |

## Method (trust-nothing)

Audit flags from `scripts/audit-tests.mjs` are **heuristics, not verdicts**.
Every finding was manually verified against the real implementation before
acting. **13 of the first 20 script flags were false positives** — this is why
the script alone can never be the gate without the verification pass.

## Verified findings — FIXED in P1

All fixes verified against production before editing. Tests stayed green
(728/728) and the count is unchanged — this phase was quality, not reduction.

| File | Issue | Production evidence | Fix |
|---|---|---|---|
| `server/simulation/__tests__/event-log.test.ts:32` | Dead assert: `expect(id).toBeTruthy()` | id assigned by repo via nanoid — can never be falsy | Removed |
| `server/simulation/__tests__/channel-registry.test.ts:23` | Dead assert: `expect(ch.id).toBeTruthy()` | id from `createId()` | Removed |
| `server/simulation/__tests__/command-handlers.test.ts:23` | Dead assert: `expect(commandId).toBeTruthy()` | `makeCommandResult` uses `createId()` | Removed |
| `engine/__tests__/pressure-inhibition.test.ts:170,184-185` | Dead truthy on enum fields | Types are TS unions; find-based tests already pin types | Replaced loop asserts with real invariants |
| `engine/__tests__/pressure-inhibition.test.ts` (motivation loop) | Weak: strength/type truthy only | `derive-motivations.ts`: with zero action emotions only `boredom` can emit (score computed unconditionally; others gated on action emotions) | Assert `m.type === "boredom"` + strength ∈ enum |
| `server/__e2e__/no-op-inhibition.e2e.test.ts:49` | Weak terminal `toBeDefined()` | `engine-event-builder.ts`: `no_op_recorded` payload = `{ reason, privateMotiveSummary }`; engine defaults summary to `"Staying quiet for now."` | Assert summary is a non-empty string (the e2e's point: silence carries a private motive) |
| `server/__e2e__/private-channel-motive.e2e.test.ts:61,80` | Weak terminals + **factually wrong test** | `intent-resolver.ts:223-231`: `channel_created` payload = `{ channelName, channelType, invitedAgentIds }` — NO `privateMotiveSummary` (the test's comment claimed it did) | Assert `invitedAgentIds` contains caio + `channelType === "private_channel"`; fixed the comment |
| `server/agent/__tests__/intent-parser.test.ts:113` | Weak terminal `toBeDefined()` on errorDetail | `intent-parser.ts:137`: `errorDetail = errorMsg` (Error message or String(error)) — non-empty by construction | Assert non-empty |
| `server/discord/__tests__/discord-gateway.test.ts:114` | Weak terminal `toBeDefined()` on discordChannelId | `role-manager.ts ensurePublicChannel`: creates text channel in `guildPort.channels` keyed by discordChannelId | Assert `guildPort.channels.has(entry.discordChannelId)` |
| `server/__e2e__/html-snapshot.e2e.test.ts:115,119` | Redundant `as any` | Trajectory type already declared at line 112 (intersection type) | Extended the declared type with `perPulseEventSummary`; removed both casts |
| `engine/__tests__/validate-intent.test.ts:84,161` | `as any` for negative fixtures | `validate-intent.ts` is a hand-written runtime validator (Set-based), not schema-typed — the negative tests are valuable | Narrow casts (`as ActionIntent["intentType"]`) + rationale comments |

## Verified findings — RESOLVED in P3

1. **`engine/__tests__/emotion-stack.test.ts` + `engine/__tests__/engine-step.test.ts`** —
   deleted `toBeDefined()` shape-guard tests. Rationale: every field of
   `EmotionStackResult` / `EngineStepResult` is required (verified in
   `shared/src/.../engine.types.ts`) — a dropped field is a compile error, so the
   runtime guards duplicated the type system. Behavioral tests that follow cover
   the real contract.
2. **`shared/__tests__/constants.test.ts` 31 → 13** — merged per-table range
   loops into one validity assertion per table using a shared
   `expectAllInRange` helper with element-identity messages (Q8) and original
   strictness (exclusive bounds preserved). All invariant coverage retained
   (counts, schema validation via `PersonaConfigSchema`, lookups known/unknown,
   threshold ordering, weight sums). True schema-driven validation (Q2) is
   deferred: the constant tables have no zod schemas — creating them is a
   production change (see Open decisions).
3. **`pulse-scheduler-integration.test.ts` — MAJOR FINDING.** The suite drives a
   hand-rolled fake `PulseOrchestrator` (a parallel re-implementation of the
   scheduler), **not the real `PulseScheduler`**. The double had drifted from
   production on six event payload contracts:
   - `memory_written`: fake `{ proposal }` vs production flat `{ memoryType, summary, ... }`
   - `message_sent`: fake `{ text }` vs production `{ content }`
   - `intent_blocked`: fake `{ reason, intentType }` vs production `{ intentType, violations, intentId }` (both validation & rate-limit)
   - `intent_delayed`: fake omitted `intentId`
   - `stagnation_detected`: (deleted test — see below)
   Fixes: aligned the double's payloads to the production builders
   (`intent-resolver.ts` / `engine-event-builder.ts`), corrected the suite header
   to state it pins commit-ORDERING against a controlled double (real scheduler
   is covered by `pulse-scheduler.test.ts`), and **deleted a tautological
   stagnation test** that constructed `{ metrics }` then asserted
   `payload["metrics"]` was defined (asserts its own fixture; can never fail).

Suite totals after P3: 67 files, 643 `it`/`test` blocks, 692 vitest-reported
(suite was 728). Audit flags: 20 → **2** (both documented exceptions below).

## Documented false positives / exceptions (do NOT re-flag)

- `server/simulation/__tests__/pulse-scheduler-resilience.test.ts` — `new Promise` in a `deferred()` helper: legitimate async orchestration, not a sleep.
- `server/__e2e__/html-snapshot.e2e.test.ts:135` — `console.log` success notice for the file-generating e2e: deliberate UX, kept.

## P2 — completed redundancy cut

1. **4 e2e family suites → 1 parameterized suite** — `cold-start`, `exclusion-cascade`, `no-op-inhibition`, `private-channel-motive` deleted; replaced by `roleplay-behaviors.e2e.test.ts`: a `SCENARIOS` registry (fixture adapters) + one `describe.each` smoke block + per-scenario behavioral describes. Cross-cutting invariants (shape, operator visibility, cursor, persistence, bounds) were **already owned by `pipeline-invariants.e2e.test.ts`** — stripped from the family suites instead of re-asserted (Q3). Result: 38 its → 23 its, zero behavior lost, all P1-fixed assertions carried over.
2. **sqlite-repositories.test.ts (47 its, 6 suites + contract runs) split into 6 files** — `sqlite-test-helpers.ts` extracted (fixtures + `makeSqliteFactory`); per-repo files: simulation, channel, event, agent-state, memory, foreign-key-cascade. Each runs its own `run*RepositoryContract`. 81 tests preserved exactly.

Suite totals after P2: 67 files, 664 `it`/`test` blocks, 713 vitest-reported tests (was 65 files / 685 / 728). Audit flags 20 → 6 (sqlite over-cap resolved; the split files are all ≤24 it).

## Open decisions (need owner)

1. **html-snapshot e2e side effect** — the e2e writes `docs/simulation-snapshot.html` (a committed file) on every test run, dirtying the tree. Options: (a) keep in fast suite + restore after run, (b) move to a generator script excluded from `pnpm test`. Undecided.
2. **Rename existing files to layer suffixes** (`*.contract.test.ts` / `*.integration.test.ts`) — pure churn vs. enabling the enforcement script from day 1. Deferred until the audit script is promoted to a CI gate (P6).
3. **Constants have no zod schemas** — Q2 (schema-driven validation) currently approximated by per-table validity tests. Creating schemas for the constant tables is a production change (engine parses them); decide if/when to add them.
4. **`PulseScheduler` lacks a stepResult-injection seam** — the commit-ordering tests in `pulse-scheduler-integration.test.ts` run against a hand-rolled double because the real scheduler computes `runEngineStep(snapshot)` internally. Recommend adding a test seam (production change) so ordering tests migrate to the real scheduler and the double can be deleted.

## Phase tracker

| Phase | Status | Exit criterion |
|---|---|---|
| P0 Baseline: inventory + hygiene sweep | ✅ done | `docs/test-inventory.md` + verified findings list |
| P1 Classify & rename / hygiene fixes | ✅ done (hygiene; rename deferred per open decision #2) | 728/728 green, flags 20 → 7 |
| P2 Redundancy cut | ✅ done | 4 e2e family suites → 1 `it.each`; e2e assertions owned by lower layers stripped; sqlite 47-it split; 713/713 green, flags → 6 |
| P3 Quality refactor | ✅ done | Q1-Q10 applied; constants 31→13; shape-guard clusters removed; **fake scheduler double aligned to production + tautology deleted**; 692/692 green, flags → 2 (both documented exceptions) |
| P4 Property tests | ⏳ next | fast-check replaces edge-case `it`s (emotion bounds, circumplex, kappa/alpha, signal-checker) |
| P5 Mutation gate | ⏳ | Stryker on engine ≥80% kill; wired into review gate |
| P6 Guardrails | ⏳ | `scripts/audit-tests.mjs` promoted to CI gate (caps + zero-tolerance list) |

## Tooling

- `scripts/audit-tests.mjs` — flags forced casts, `@ts-ignore`, `.only`/`.skip`,
  dead `id` truthy, weak terminal `toBeDefined`, over-cap files, async pauses.
  Outputs `docs/test-inventory.md` + `.json`. Heuristic — always pair with a
  manual verification pass.
- Regenerate anytime with: `node scripts/audit-tests.mjs`

## P4 — property tests (fast-check) completed

- Added `fast-check` devDependency to `packages/eval` and `packages/engine` (engine installed for future emotion/circumplex targets).
- New `packages/eval/src/test/calibration-properties.test.ts` — 6 property tests over `weightedKappa` + `krippendorffAlpha`:
  - self-agreement returns exactly 1
  - raters symmetric
  - result finite and ≤ 1
- **Verified findings from running them:** both functions are mathematically symmetric. `weightedKappa` uses rational weights (0.75, 0.9375) that accumulate in different FP order when raters swap → symmetry holds to ~1e-10, not bit-exact (asserted with `toBeCloseTo`). `krippendorffAlpha` uses integer squared distances → symmetry is bit-exact (`toBe`). No logic bugs in the implementations — the initial property failure was first a test-generator destructuring bug, then the FP-precision consideration; both are documented here and in the test comments.
- Suite now: 68 files, 698 tests, audit flags still 2 (both documented exceptions).

## P5 — mutation gate (Stryker on engine): installed as DIAGNOSTIC, NOT a CI gate

**Tooling:** added `@stryker-mutator/{core,vitest-runner,typescript-checker}` to
`packages/engine`, config at `packages/engine/stryker.config.json`, npm script
`pnpm --filter @perfectman/engine mutation`.

**Reliability finding (why there is NO CI gate):**
- **Isolated/per-file stryker runs are reliable** and give real kill scores
  (verified: `memory/get-new-events-since.ts` = 100% kill, consistent with batch).
- **One-shot batch mode is broken in this monorepo** (pnpm + vitest alias +
  workspace layout): coverage attribution collapses under multi-file mutation →
  mass `no-cov` + `errors` (e.g. full run: 10.28% score, 1836 no-cov, 685 errors;
  2-3 tests/mutant vs 50+ in isolated runs). `vitest.related:false`,
  `coverageAnalysis:"all"`, explicit `configFile` did NOT fix it. Recorded as a
  stryker-vitest monorepo integration limitation until investigated further.
- Therefore: run stryker **per file** (`npx stryker run --mutate src/<dir>/<file>.ts`)
  for trustworthy scores. thresholds.break kept null (manual tool).

**MAJOR discovery (the value of the exercise):** engine test suite is shallow at
the branch level despite 214 green tests. Isolated mutation kill scores:
| Function | Kill % |
|---|---|
| memory/get-new-events-since | 100 |
| intent/validate-intent | 61 |
| visibility/filter-visible-events | 63 |
| motivation/derive-motivations | 0 |
| emotion/update-social-emotions | 0 |
| emotion/compute-action-emotions | 0 |
| emotion/update-emotion-stack | 0 |
| inhibition/compute-inhibitions | 0 |

The engine's core emotion/motivation/pressure/inhibition dynamics functions are
practically untested at the branch level — the green happy-path assertions
pass without covering the logic. **This is the real next-test work:** before
adding more tests, cover these functions with branch-behavioral tests (the
`compute-*`/`update-*` dynamics), which is far higher-value than count growth.

**Conclusion:** P5 does not ship an automated CI gate (tooling unreliable in
batch). It ships a dependable per-file diagnostic, and — more importantly —
a concrete, evidence-backed redirection: the engine's dynamics functions need
real behavioral tests. The audit script + review (the lighter alternative)
remains the practical gate.
