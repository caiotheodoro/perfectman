# Architecture Decision Records

Index, convention, and template for the ADRs in this directory. New ADRs consume the next free number (0011+).

## Convention

Rationale and rejected alternatives live **inline** in the ADR (Context / Decision / Rationale / Rejected Alternatives / Consequences), never as a pointer to the pipeline run's archived decision log. Per-run `_output/` pointers rot when the run's directory is archived — PR #103 (2026-08-26) repaired exactly that class of broken pointer, and the goal-layer pack's R4 audit (notes.md:56) pins the lesson. A rationale that requires the run's archive to be readable is not a rationale.

ADR-0001..0007 pre-date this convention and are historical records: their Status lines claim the inline-rationale shape, but they were written before the template below was pinned. They are not retrofitted.

## Index

| ADR | Title |
| --- | --- |
| [ADR-0001](0001-event-visibility-operator-event.md) | Per-Committed-Event Visibility Signal |
| [ADR-0002](0002-action-intent-emission.md) | `action_intent` Operator Event |
| [ADR-0003](0003-shared-agent-state-serializer.md) | Shared Agent-State Serializer |
| [ADR-0004](0004-gateway-construction-metadata.md) | Runtime Metadata at Gateway Construction |
| [ADR-0005](0005-stream-fed-html-receiver.md) | Stream-Fed HTML Receiver in Production |
| [ADR-0006](0006-html-snapshot-gateway-config.md) | `html-snapshot` Gateway Config Variant |
| [ADR-0007](0007-pulse-frame-result-approximation.md) | `PulseFrame.result` Stream-Derived Approximation |
| [ADR-0008](0008-world-goal-layer.md) | World Goal Layer |
| [ADR-0009](0009-goal-layer-runtime-wiring.md) | Goal-Layer Runtime Wiring |
| [ADR-0010](0010-goal-layer-llm-slice.md) | Goal-Layer LLM Slice |

## Template

Section order matches ADR-0010 (the current convention reference):

```markdown
# ADR-00NN: <Title>

**Status**: Proposed | Accepted (LOCKED, YYYY-MM-DD) — rationale and rejected alternatives inline in this ADR (decisions D-XX..D-YY).

## Context

<the problem the decision responds to; constraints carried into the decision>

## Decision

<numbered decisions; what was decided, not what was considered>

## Rationale

- <evidence that forced the decision: constraints, patterns, measured costs>

## Rejected Alternatives

- <what else was viable and the specific reason it lost>

## Consequences

- <what changes structurally; what future work this enables or blocks>

## Cross-links

<related ADRs, packs, concept pages>
```