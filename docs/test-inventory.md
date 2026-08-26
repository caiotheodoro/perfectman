# Test Inventory & Hygiene Snapshot

Generated: 2026-08-26T15:03:10.406Z — audited 109 files, 1025 `it`/`test` blocks (some it.each expand further at runtime).

Layer classification follows `docs/testing-strategy.md`: `contract` (zod/boundary, once per package) / `integration` (through public surface, the honeycomb's big middle) / `e2e` (max 6 suites) / `eval-harness` (vitest tests of the eval tooling — the 123-task *benchmark* is out of scope).

## Totals by package

| Package | Files | it/test | Hygiene flags
|---|---|---|---|
| engine | 22 | 259 | —
| eval | 17 | 140 | async-pause(1)
| server | 62 | 541 | console(1), async-pause(1), async-pause(1), async-pause(2)
| shared | 8 | 85 | —

**Total: 109 files, 1025 it/test blocks; 5 files flagged.**

## Per-file inventory

| File | Layer | it/test | Flags
|---|---|---|---|
| packages/engine/src/__tests__/attention.test.ts | integration | 10 | 
| packages/engine/src/__tests__/available-actions.test.ts | integration | 11 | 
| packages/engine/src/__tests__/compute-action-emotions.test.ts | integration | 3 | 
| packages/engine/src/__tests__/compute-inhibitions.test.ts | integration | 5 | 
| packages/engine/src/__tests__/compute-pressures.test.ts | integration | 5 | 
| packages/engine/src/__tests__/decision.test.ts | integration | 20 | 
| packages/engine/src/__tests__/derive-motivations.test.ts | integration | 6 | 
| packages/engine/src/__tests__/emotion-stack.test.ts | integration | 14 | 
| packages/engine/src/__tests__/engine-step.test.ts | integration | 13 | 
| packages/engine/src/__tests__/multi-pulse.test.ts | integration | 4 | 
| packages/engine/src/__tests__/no-io-boundary.test.ts | integration | 3 | 
| packages/engine/src/__tests__/no-prompt-leak.test.ts | integration | 12 | 
| packages/engine/src/__tests__/pressure-inhibition.test.ts | integration | 19 | 
| packages/engine/src/__tests__/scenarios.test.ts | integration | 23 | 
| packages/engine/src/__tests__/stagnation.test.ts | integration | 11 | 
| packages/engine/src/__tests__/translate-emotional-state.test.ts | integration | 15 | 
| packages/engine/src/__tests__/update-core-mood.test.ts | integration | 7 | 
| packages/engine/src/__tests__/update-social-emotions.test.ts | integration | 6 | 
| packages/engine/src/__tests__/validate-intent.test.ts | integration | 22 | 
| packages/engine/src/__tests__/visibility-security.test.ts | integration | 18 | 
| packages/engine/src/__tests__/visibility.test.ts | integration | 20 | 
| packages/engine/src/perception/__tests__/memory-salience.test.ts | integration | 12 | 
| packages/eval/src/test/bench-dispatch.test.ts | eval-harness | 4 | 
| packages/eval/src/test/bench-seed.test.ts | eval-harness | 7 | 
| packages/eval/src/test/bench-slices.test.ts | eval-harness | 6 | 
| packages/eval/src/test/bench.test.ts | eval-harness | 8 | 
| packages/eval/src/test/calibration-matching.test.ts | eval-harness | 4 | 
| packages/eval/src/test/calibration-properties.test.ts | eval-harness | 6 | 
| packages/eval/src/test/echo-chamber-stability.test.ts | eval-harness | 2 | 
| packages/eval/src/test/golden-labels-coverage.test.ts | eval-harness | 3 | 
| packages/eval/src/test/intent-entropy.test.ts | eval-harness | 8 | 
| packages/eval/src/test/judge-config.test.ts | eval-harness | 19 | 
| packages/eval/src/test/judge-json-salvage.test.ts | eval-harness | 9 | 
| packages/eval/src/test/judge-sdk-path.test.ts | eval-harness | 10 | async-pause(1)
| packages/eval/src/test/judge-signals.test.ts | eval-harness | 10 | 
| packages/eval/src/test/jury-judge.test.ts | eval-harness | 11 | 
| packages/eval/src/test/probes.test.ts | eval-harness | 23 | 
| packages/eval/src/test/signal-breakdown.test.ts | eval-harness | 4 | 
| packages/eval/src/test/sweep-temperature.test.ts | eval-harness | 6 | 
| packages/server/src/__e2e__/html-receiver-parity.e2e.test.ts | e2e | 7 | 
| packages/server/src/__e2e__/html-snapshot.e2e.test.ts | e2e | 1 | console(1)
| packages/server/src/__e2e__/pipeline-invariants.e2e.test.ts | e2e | 10 | 
| packages/server/src/__e2e__/roleplay-behaviors.e2e.test.ts | e2e | 17 | 
| packages/server/src/agent/__tests__/agent-runtime.test.ts | integration | 11 | 
| packages/server/src/agent/__tests__/background-reflection-prompt-builder.test.ts | integration | 11 | 
| packages/server/src/agent/__tests__/intent-parser-null.test.ts | integration | 4 | 
| packages/server/src/agent/__tests__/intent-parser.test.ts | integration | 16 | 
| packages/server/src/agent/__tests__/persona-loader.test.ts | integration | 7 | 
| packages/server/src/agent/__tests__/prompt-builder.test.ts | integration | 17 | 
| packages/server/src/agent/__tests__/repetition-guard.test.ts | integration | 8 | 
| packages/server/src/agent/surface/__tests__/action-intent-step.test.ts | integration | 9 | 
| packages/server/src/cli/__tests__/llm-health-check.test.ts | integration | 4 | 
| packages/server/src/config/__tests__/judge-config.test.ts | integration | 16 | 
| packages/server/src/config/__tests__/simulation-config.test.ts | integration | 22 | 
| packages/server/src/delivery/__tests__/html-snapshot-gateway.test.ts | integration | 7 | 
| packages/server/src/discord/__tests__/bot-registry.test.ts | integration | 9 | 
| packages/server/src/discord/__tests__/channel-map.test.ts | integration | 6 | 
| packages/server/src/discord/__tests__/discord-config.test.ts | integration | 13 | 
| packages/server/src/discord/__tests__/discord-errors.test.ts | integration | 13 | 
| packages/server/src/discord/__tests__/discord-formatter.test.ts | integration | 9 | 
| packages/server/src/discord/__tests__/discord-gateway.test.ts | integration | 13 | 
| packages/server/src/discord/__tests__/discord-rate-limiter.test.ts | integration | 8 | 
| packages/server/src/discord/__tests__/role-manager.test.ts | integration | 10 | 
| packages/server/src/llm/__tests__/llm-budget.test.ts | integration | 6 | 
| packages/server/src/llm/__tests__/mock-llm-provider.test.ts | integration | 7 | 
| packages/server/src/llm/__tests__/ollama-provider.test.ts | integration | 9 | 
| packages/server/src/llm/__tests__/openai-compatible-provider.test.ts | integration | 9 | 
| packages/server/src/llm/__tests__/provider-factory.test.ts | integration | 5 | 
| packages/server/src/llm/__tests__/sdk-transport.test.ts | integration | 18 | async-pause(1)
| packages/server/src/persistence/__tests__/sqlite-agent-state-repository.test.ts | integration | 8 | 
| packages/server/src/persistence/__tests__/sqlite-channel-repository.test.ts | integration | 9 | 
| packages/server/src/persistence/__tests__/sqlite-event-repository.test.ts | integration | 13 | 
| packages/server/src/persistence/__tests__/sqlite-foreign-key-cascade.test.ts | integration | 2 | 
| packages/server/src/persistence/__tests__/sqlite-memory-repository.test.ts | integration | 8 | 
| packages/server/src/persistence/__tests__/sqlite-simulation-repository.test.ts | integration | 7 | 
| packages/server/src/simulation/__tests__/channel-registry.test.ts | integration | 7 | 
| packages/server/src/simulation/__tests__/command-handlers.test.ts | integration | 4 | 
| packages/server/src/simulation/__tests__/delivery-projection-fanout.test.ts | integration | 18 | 
| packages/server/src/simulation/__tests__/delivery-projection.test.ts | integration | 5 | 
| packages/server/src/simulation/__tests__/engine-snapshot-projection.test.ts | integration | 1 | 
| packages/server/src/simulation/__tests__/event-log.test.ts | integration | 7 | 
| packages/server/src/simulation/__tests__/intent-resolver-fallback.test.ts | integration | 10 | 
| packages/server/src/simulation/__tests__/intent-resolver.test.ts | integration | 8 | 
| packages/server/src/simulation/__tests__/lifecycle-state-machine.test.ts | integration | 18 | 
| packages/server/src/simulation/__tests__/operator-event-producers.test.ts | integration | 4 | 
| packages/server/src/simulation/__tests__/operator-projection.test.ts | integration | 4 | 
| packages/server/src/simulation/__tests__/pulse-scheduler-observability.test.ts | integration | 12 | 
| packages/server/src/simulation/__tests__/pulse-scheduler-resilience.test.ts | integration | 2 | async-pause(1)
| packages/server/src/simulation/__tests__/pulse-scheduler.test.ts | integration | 12 | 
| packages/server/src/simulation/__tests__/runtime-input-builder.test.ts | integration | 5 | 
| packages/server/src/simulation/__tests__/simulation-lifecycle.test.ts | integration | 10 | 
| packages/server/src/simulation/__tests__/simulation-manager.test.ts | integration | 4 | 
| packages/server/src/simulation/__tests__/simulation-runtime.test.ts | integration | 3 | 
| packages/server/src/simulation/__tests__/spectator-projection.test.ts | integration | 6 | 
| packages/server/src/simulation/__tests__/visibility-invariants.test.ts | integration | 13 | 
| packages/server/src/simulation/__tests__/world-signals-builder.test.ts | integration | 7 | 
| packages/server/src/simulation/world/__tests__/acceptance-gate.test.ts | integration | 4 | 
| packages/server/src/simulation/world/__tests__/goal-end-to-end.test.ts | integration | 1 | async-pause(2)
| packages/server/src/simulation/world/__tests__/goal-registry.test.ts | integration | 8 | 
| packages/server/src/simulation/world/__tests__/goal-synthesizer.test.ts | integration | 7 | 
| packages/server/src/simulation/world/__tests__/world-evaluator.test.ts | integration | 12 | 
| packages/shared/src/__tests__/constants.test.ts | contract | 13 | 
| packages/shared/src/__tests__/contracts.test.ts | contract | 3 | 
| packages/shared/src/__tests__/intent-packet-schema.test.ts | contract | 9 | 
| packages/shared/src/__tests__/judge-config.test.ts | contract | 18 | 
| packages/shared/src/__tests__/prompt-syntax.test.ts | contract | 5 | 
| packages/shared/src/__tests__/schemas.test.ts | contract | 13 | 
| packages/shared/src/persona-packs/persona-packs.test.ts | contract | 16 | 
| packages/shared/src/scenarios/library.test.ts | contract | 8 | 

## Hygiene legend
- `forced-cast(n)`: bare `as any`/`as unknown` — Q11 violation unless narrow cast + comment for negative fixtures
- `dead-id-truthy(n)`: `expect(x.id).toBeTruthy()` — cannot fail for generated IDs (nanoid) — Q11 dead assertion
- `weak-terminal-toBeDefined(lines)`: behavior test ending at existence-only assertion — Q11 weak terminal
- `ts-bypass` / `eslint-disable` / `ONLY` / `skip` / `console`: must be absent (skip/ONLY must never merge to main)
- `async-pause(n)`: `new Promise`/`setTimeout` in tests — determinism risk (Q7); simulated clock should replace
- `over-cap(n>cap)`: more than 25 it/test per file — force parameterization (Q4)

> WIP snapshot, not a gate yet. The enforcement script (P6) will fail CI on: `.only(`/`.skip(`, `as any`, `@ts-ignore`, dead-id-truthy, weak terminals, and over-cap files.