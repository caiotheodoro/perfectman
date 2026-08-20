# Prompt Structure & Delegation Layers — Architecture

Design for how LLM-facing prompts are structured and how an LLM call is made.
Two design decisions: **(A)** prompt text uses a *full hybrid* structure chosen for
**model precision** (not human readability); **(B)** no LangChain/LangGraph framework —
instead an internal typed-step abstraction (`LlmStep`) that the runtime routes through.

---

## A. Prompt text structure: full hybrid, precision-first

### A.1 Why format matters

*Does Prompt Formatting Have Any Impact on LLM Performance?* (Microsoft/MIT/UCSD,
arXiv:2411.10541): same content rendered as plain text / Markdown / JSON / YAML shifted
**GPT-3.5-class performance by up to 40%** (code translation), while GPT-4 was far more
robust. We run qwen3:8b (small local) and free-tier API models (GPT-3.5-class) — the
fragile class — so format is a real lever, to be set precisely and benchmarked, not chosen
for how easy the prompt is to skim in a diff.

Anthropic's guidance (docs.claude.com): XML-style tags make complex prompts unambiguous
("XML tags help Claude parse complex prompts unambiguously"), and for long
multi-document inputs, data near the top with the decision query at the end improves response
quality by up to ~30%.

### A.2 Our own failure evidence

- **Boundary bleed:** channels rendered as `#channelId`; models copied the `#` into
  `channelTarget` (parser strips it after the fact).
- **Instruction/data confusion:** judge ignored "Return ONLY a JSON object" and emitted
  markdown prose (#26); an agent emitted ` message_sent` with empty content (#39).
- **Ordering:** an output contract placed before the context mis-orders data and decision.

### A.3 Decision

Every zone is tagged by *role* using the strongest marker for that role:

1. **Sectioning:** Markdown `##` headers only where they carry semantic weight (token-cheap
   organization; they do not delimit data boundaries).
2. **Data-typed zones:** explicit opening + closing tag containers (`<events>…</events>`,
   `<persona>…</persona>`, …) so the boundary is definite, not a soft Markdown edge.
3. **Literal content:** fence-wrapped anything the model must never execute or imitate
   (e.g. the agent's own prior utterances).
4. **Ordering:** data/context first, actionable decision question last.
5. **No prose JSON contract:** the output shape lives in the schema (see packet split) and is
   enforced by constrained decoding; the prompt carries only semantic guidance.

**Validation (benchmark gates):** same scenarios, same seed, same sampling, format as the only
variable, measured on the axes at risk (voice, motive, believability, creativity, repetition).
Decide by numbers. (Real-model `--mode local` run tied to #44/#45/#43.)

All prompt builders emit this structure through the shared `PromptSection` helper
(`@perfectman/shared`), which owns the string manipulation (headings, bullets, fences, and
auto-closing containers) — builders never hand-write or hand-close tags.

---

## B. Delegation layers: no framework — typed steps

The engine is the deterministic behavioral core; the LLM is a decision + language layer. An LLM
call is made as a closed, typed step rather than ad-hoc branches in the runtime (which is easy to
bypass and undocumented). We deliberately do **not** adopt LangChain/LangGraph: their differentiators
(durable execution, cross-session memory, orchestration) duplicate what the event-log/simulation
runtime already provides.

### B.1 The typed step

```ts
// packages/server/src/agent/surface/llm-step.ts
type StepOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; fallback: T; errorDetail?: string; gateBlocked?: boolean };

interface LlmStep<Input, Output> {
  readonly purpose: string;
  readonly label: string;
  render(input: Input, ctx: StepRunContext): BuiltPrompt;
  gate(input: Input, ctx: StepRunContext): StepOutcome<Output> | undefined;
  execute(input: Input, ctx: StepRunContext): Promise<StepOutcome<Output>>;
}
```

`ActionIntentStep` is the concrete, canonical pattern for a new surface: render → gate → provider
call → strict parse → repetition-guard retry → controlled fallback → usage/operator events as one
closed `StepOutcome`. Surfaces are registered in `llmSurfaceRegistry` keyed by `PromptPurpose`; the
runtime calls `render`/`gate`/`execute` through the interface and never re-implements a surface
locally.

### B.2 Multi-call surfaces (chains)

Multi-call LLM surfaces are declared ordered steps with typed inputs/outputs at each boundary
(reflection #34, the judge per-turn loop, a bounded retry arm). A chain is data, not spaghetti —
declared, testable, visible in one place. The chain construct is introduced alongside its first
multi-call consumer (see open items).

---

## C. Open items (tracked in issues, not status-tracked here)

- Judge output constrained decoding for its `{"axes"}` packet — #38.
- Real-model format A/B (`--mode local`, qwen3:8b) — #44/#45/#43.
- CI: build `shared`/`engine` before server typecheck so stale `dist` can't silently rot — #43.
- `fallbackIfBlocked` alternate-action wiring — #50.

## D. Sources

- He, Rungta, et al., *Does Prompt Formatting Have Any Impact on LLM Performance?*, arXiv:2411.10541
- Anthropic, *Structure prompts with XML tags* / long-context prompting guidance — docs.claude.com
- Anthropic, *Prompting best practices* — docs.claude.com
- AI/TLDR, *Structuring Prompts: XML Tags, Markdown, Delimiters* — ai-tldr.dev (community synthesis)
