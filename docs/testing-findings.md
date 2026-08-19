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

## Verified findings — REMAINING (deferred)

| File | Issue | Why deferred | Plan |
|---|---|---|---|
| `engine/__tests__/emotion-stack.test.ts:200-201`, `engine/__tests__/engine-step.test.ts:173-174` | Tests end with 4 existence-only `toBeDefined()` (shape guard, not dead — would catch null field) | Needs behavioral value decisions | P2/P3 quality refactor |
| `shared/__tests__/constants.test.ts` | 31 `it` blocks; range loops hand-duplicated per table | Q2 schema-driven refactor | P3 |
| `server/simulation/__tests__/pulse-scheduler-integration.test.ts:697,775` | `payload[key]).toBeDefined()` terminal after length check | Borderline (presence of event key); low priority | P3 if kept |

## P2 — completed redundancy cut

1. **4 e2e family suites → 1 parameterized suite** — `cold-start`, `exclusion-cascade`, `no-op-inhibition`, `private-channel-motive` deleted; replaced by `roleplay-behaviors.e2e.test.ts`: a `SCENARIOS` registry (fixture adapters) + one `describe.each` smoke block + per-scenario behavioral describes. Cross-cutting invariants (shape, operator visibility, cursor, persistence, bounds) were **already owned by `pipeline-invariants.e2e.test.ts`** — stripped from the family suites instead of re-asserted (Q3). Result: 38 its → 23 its, zero behavior lost, all P1-fixed assertions carried over.
2. **sqlite-repositories.test.ts (47 its, 6 suites + contract runs) split into 6 files** — `sqlite-test-helpers.ts` extracted (fixtures + `makeSqliteFactory`); per-repo files: simulation, channel, event, agent-state, memory, foreign-key-cascade. Each runs its own `run*RepositoryContract`. 81 tests preserved exactly.

Suite totals after P2: 67 files, 664 `it`/`test` blocks, 713 vitest-reported tests (was 65 files / 685 / 728). Audit flags 20 → 6 (sqlite over-cap resolved; the split files are all ≤24 it).

## Documented false positives / exceptions (do NOT re-flag)

- `server/simulation/__tests__/pulse-scheduler-resilience.test.ts` — `new Promise` in a `deferred()` helper: legitimate async orchestration, not a sleep.
- `server/__e2e__/html-snapshot.e2e.test.ts:135` — `console.log` success notice for the file-generating e2e: deliberate UX, kept.

## Open decisions (need owner)

1. **html-snapshot e2e side effect** — the e2e writes `docs/simulation-snapshot.html` (a committed file) on every test run, dirtying the tree. Options: (a) keep in fast suite + restore after run, (b) move to a generator script excluded from `pnpm test`. Undecided.
2. **Rename existing files to layer suffixes** (`*.contract.test.ts` / `*.integration.test.ts`) — pure churn vs. enabling the enforcement script from day 1. Deferred until the audit script is promoted to a CI gate (P6).

## Phase tracker

| Phase | Status | Exit criterion |
|---|---|---|
| P0 Baseline: inventory + hygiene sweep | ✅ done | `docs/test-inventory.md` + verified findings list |
| P1 Classify & rename / hygiene fixes | ✅ done (hygiene; rename deferred per open decision #2) | 728/728 green, flags 20 → 7 |
| P2 Redundancy cut | ✅ done | 4 e2e family suites → 1 `it.each`; e2e assertions owned by lower layers stripped; sqlite 47-it split; 713/713 green, flags → 6 |
| P3 Quality refactor | ⏳ next | Q1-Q10 applied per file; constants schema-driven; weak-terminal clusters in emotion-stack/engine-step resolved |
| P4 Property tests | ⏳ | fast-check replaces edge-case `it`s (emotion bounds, circumplex, kappa/alpha, signal-checker) |
| P5 Mutation gate | ⏳ | Stryker on engine ≥80% kill; wired into review gate |
| P6 Guardrails | ⏳ | `scripts/audit-tests.mjs` promoted to CI gate (caps + zero-tolerance list) |

## Tooling

- `scripts/audit-tests.mjs` — flags forced casts, `@ts-ignore`, `.only`/`.skip`,
  dead `id` truthy, weak terminal `toBeDefined`, over-cap files, async pauses.
  Outputs `docs/test-inventory.md` + `.json`. Heuristic — always pair with a
  manual verification pass.
- Regenerate anytime with: `node scripts/audit-tests.mjs`
