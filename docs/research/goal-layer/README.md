# Goal Layer Research Pack

Durable home for the external-source trail behind the emergent goal layer: goal formation and narrative closure (R1), self-vs-world judgment (R2), autotelic/emergent goals and ending theory (R3), and the docs-structure audit that shaped where this pack lives (R4).

Scope: design research for the world-level goal layer — the simulation's principled ending mechanism. Code lives in `packages/shared/src/goal/` and `packages/engine/src/goal/` (pure layer) plus `packages/server/src/simulation/world/` (runtime wiring); the layer's place in the system and its semantics are spelled out in the [concept page](../../concepts/goal-layer.md) and locked in [ADR-0008](../../adr/0008-world-goal-layer.md) (semantics), [ADR-0009](../../adr/0009-goal-layer-runtime-wiring.md) (runtime wiring — pulse-loop review, ending gate, `goalLayer` config, deterministic synthesizer + auto acceptance), and [ADR-0010](../../adr/0010-goal-layer-llm-slice.md) (**IMPLEMENTED 2026-08-26**: LLM synthesizer + `"agent"` acceptance + LLM self-verdicts wired, decisions D-17..D-23).

## Read Order

1. [source-map.md](source-map.md) — every source with URL, type/version, fetch date, verification status, and local use, plus freshness notes and the gaps summary.
2. [notes.md](notes.md) — atomic paraphrased findings per thread, each linked to its source-map row; the verbatim quotes the design relies on.
3. [gaps.md](gaps.md) — open questions and staleness caveats: removed/blocked sources, paywalled primaries, and design choices that outrun the literature.

## Not An Imported Copy

These files paraphrase and organize the sources instead of copying them verbatim. They are a local engineering reference for this codebase, with links back to the source pages for freshness checks. The research notes in `.claude/_output/research/` are the staging copies; this pack is the durable home (R4).

## Related

- [Concept: Goal Layer](../../concepts/goal-layer.md) — the layer, lifecycle, verdict architecture, and the N possibilities.
- [ADR-0008: World Goal Layer](../../adr/0008-world-goal-layer.md) — locked decisions with inline rationale.
- [Research log](../log.md) — append-only chronology of research runs.