# Research Packs

Durable home for the external-source trails behind the docs: each research run's sources, findings, and gaps, plus the append-only log of when runs happened.

## Layout

One pack per topic in `docs/research/<topic>/`: README.md (pack index), source-map.md (every source with URL / type / fetch date / verification status), notes.md (atomic paraphrased findings, each linked to its source-map row), gaps.md (open questions and staleness caveats). Cited docs carry a `## Sources / Related decisions` footer with one row per external claim in the same column shape. Each run appends one entry to [log.md](log.md) with a `## [YYYY-MM-DD] <topic> | <one-line>` prefix, grep-parseable with `grep "^## \["`. The full rules live in the [documentation conventions](../README.md).

## Packs

- [Goal Layer](goal-layer/README.md) — emergent goal layer with world-level judgment (R1-R4; decisions D-17..D-23, ADR-0008..0010).

## Adoption of the LLM-Wiki Pattern (D-45)

This index generalizes the pattern of Karpathy's "LLM Wiki" gist — the external basis of the R4 docs-structure audit that shaped the goal-layer pack and this run's conventions.

| Source | Type / Version | Fetch Date | Verification Status |
| --- | --- | --- | --- |
| Karpathy, "LLM Wiki" — https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f | raw markdown, public gist | 2026-08-25 | tier 1 — fetched; re-verified 2026-08-27 (coordinating session, issue #98) |

### Adoption mapping

| Gist element | Repo adoption |
| --- | --- |
| Three layers: immutable raw sources / LLM-owned wiki / schema doc (= conventions) | Raw packs + source-maps / wiki pages (concept pages) / [AGENTS.md](../../AGENTS.md) + this run's convention homes ([docs/README.md](../README.md), [docs/adr/README.md](../adr/README.md), this file) |
| Append-only `log.md`, `## [YYYY-MM-DD]` prefix | [docs/research/log.md](log.md) — same prefix, same `grep "^## \["` parseability |
| `index.md` catalog (links + summaries) | [Concept-map catalog](../concepts/concept-map.md) + the catalog-row rule: new concepts are atomic pages with exactly one catalog row, no new `## Concept N` appends (D-42) |
| Lint items (orphan pages, stale claims, dead cross-references, data gaps) | [docs-lint L1-L5](../../scripts/docs-lint.mjs) — dead relative links, archived-path refs, orphan concept pages, line-final bare venue tokens, stale source-map fetch dates |
| Atomic pages | Goal-layer pattern: one concept = one file + one catalog row (see [the goal-layer concept page](../concepts/goal-layer.md)) |

### Non-lintable gap

The gist's first lint item — contradictions between pages — is an LLM-judgment health check there too. The deterministic docs-lint covers the scriptable subset; contradiction-checking stays a human/agent review item. Named as a documented gap, not a waiver.
