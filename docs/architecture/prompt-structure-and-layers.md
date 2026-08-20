# Prompt Structure & Delegation Layers — Design Notes

> Status: **decisions locked** for [issue #49](https://github.com/caiotheodoro/perfectman/issues/49).
> Two decisions, fixed after research on 2026-08-20:
> **(A)** prompt text uses a **full hybrid** structure, chosen for *model precision*, not human readability;
> **(B)** no LangChain/Graph framework — instead **surface the typed pipeline steps we already have** so
> they actually get used.

---

## A. Prompt text structure: full hybrid, precision-first

### A.1 Evidence that struct</think>

**Format variance is real and matters for our model class.**
*"Does Prompt Formatting Have Any Impact on LLM Performance?"* (Microsoft/MIT/UCSD, arXiv:2411.10541,
submitted NAACL 2025). Same content as plain text, Markdown, JSON, YAML:
- **GPT-3.5-turbo varied up to 40%** (code translation) purely from template choice.
- GPT-4 was substantially more robust.

We run qwen3:8b (small local) and free-tier API models (GPT-3.5-class) — the fragile class.
Format must therefore be **set precisely and benchmarked**, not chosen for how easy the prompt is to
skim in a diff.

**Anthropic (primary source, docs.claude.com — "use XML tags"):**
- "XML tags help Claude parse complex prompts unambiguously, especially when your prompt mixes
  instructions, context, examples, and variable inputs. Wrapping each type of content in its own tag
  (e.g. `<instructions>`, `<context>`, `<input>`) reduces misinterpretation."
- Long-context guidance (same page): longform data near the top; **"queries at the end can improve
  response quality by up to 30 percent in tests"** for complex multi-document inputs.

**Community synthesis** (AI/TLDR): three structural tools — XML tags (explicit named containers,
unambiguous boundaries), Markdown headings (token-cheap but **soft boundaries — no closing tag**),
delimiter fences (literal/untrusted content). Structure works because models train on structured text;
markers signal *roles* (command vs data vs example).

### A.2 Failure evidence in our own repo (why structure must be precise)

- **Boundary bleed:** channels rendered as `#channelId`; models copied the `#` into `channelTarget`
  (`intent-parser.ts` strips it after the fact).
- **Instruction/data confusion:** judge ignored "Return ONLY a JSON object" and emitted markdown
  prose (#26); an agent emitted ` message_sent` with empty content (#39).
- **Ordering:** the output contract (Section 8) sits *before* the context blocks (2–7); the actionable
  decision should follow the data, not precede it.

### A.3 Decision: full hybrid, precision-first

Every zone is deliberately tagged by *role*, using the strongest marker for that role. Human
readability is a side effect, not a goal; the structure exists to make the model's job unambiguous.

1. **Sectioning: Markdown headers only where they carry real semantic weight** (cheap,
   token-efficient, `## Context` / `## Persona` / `## Actions`). They organize; they do not delimit
   data boundaries.
2. **Data-typed zones: explicit opening + closing tag containers** — persona profile, scenario /
   social context, the event log, the memory list, the permitted-actions menu. Each is
   `<events>…</events>`, `<persona>…</persona>`, … with a closing tag so the model knows the boundary
   is definite. Closing tags are what separates "this zone ends here" from a soft Markdown boundary.
3. **Literal content the model must never execute or imitate: fence-wrapped** — especially the
   agent's own prior utterances (data to avoid repeating, not instructions and not a style to copy).
4. **Ordering: data/context first, actionable decision question last** — per Anthropic's 30% finding,
   the final prompt line is the single crisp instruction ("pick exactly one permitted action and emit
   the packet"), replacing the current system-side Section 8 placement.
5. **No prose JSON contract.** The output schema leaves the prompt entirely once #38/Phase 2 lands
   (JSON Schema → constrained decoding). Any residual semantic guidance lives in a tagged container.

**Benchmark gates (tie to #43/#44/#45):** same scenarios, same seed, same sampling, format as the
only variable, measured on the axes that regressed (voice, motive, believability, creativity,
repetition). Decide by numbers, not taste.

---

## B. Delegation layers: no framework — surface the typed steps we already have

We already implement the right idea in plain TypeScript (`PromptSurface`-shaped flow in
`agent-runtime.ts` + `IntentParser` + `repetition-guard`). The gap is that it is **implicit**: spread
across classes, undocumented, and easy to bypass (blind string-appends at agent-runtime.ts:150,
regex repair in intent-parser.ts). We will not add LangChain/LangGraph; we will make the existing
composition explicit and consumable so it starts being used as the one way to add an LLM surface.

### B.1 The typed step (the "arm")

A single LLM call = a typed step with an explicit, closed outcome:

```ts
// packages/server/src/agent/surface/llm-step.ts
type StepOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; fallback: T; errorDetail?: string; gateBlocked?: boolean };

interface LlmStep<Input, Output> {
  readonly purpose: string;
  readonly label: string;
  execute(input: Input, ctx: StepRunContext): Promise<StepOutcome<Output>>;
}
```

`ActionIntentStep` (`surface/action-intent-step.ts`) `implements LlmStep<AgentRuntimeInput, AgentRuntimeOutput>`
and is the canonical pattern for a new surface: render → gate → provider call → strict parse →
repetition-guard retry arm → controlled fallback → usage/operatorEvents, all as a closed
`StepOutcome`. The production runtime calls `step.render → step.gate → step.execute` through the
interface (budget gate now lives inside `step.gate`, not ad-hoc in the runtime). `LlmChain` is
deferred until the judge/reflection multi-call surfaces are actually routed through it (see B.2).

### B.2 The chain registry

Multi-call surfaces are explicit ordered steps with typed inputs/outputs at each boundary:
- `background_reflection` (#34): reflection → memory consolidation → next-action context.
- Judge per-turn loop (`llmJudgePerTurn`): already a hand-written chain; re-express as registry.
- Repetition retry: a bounded 1-retry arm with structured feedback.

A chain is **data, not spaghetti** — declared, testable, and visible in one place.

### B.3 What "surfaced to be used" means concretely

Done (this pass + hardening):
- `LlmStep`/`StepOutcome`/`StepRunContext` in `surface/llm-step.ts`; `ActionIntentStep implements LlmStep`
  (`render`/`gate`/`execute`), registry in `surface/index.ts`; `agent-runtime.generateIntent` routes
  through the interface with the budget gate inside `step.gate`.
- Fixes from review: retry parse-failure/throw now reported as `llm_failure` (not mislabeled
  `intent_blocked`); `pulse_metrics` token telemetry now equals the summed budget totals; real
  `purposeToCallType`; dead `ActionIntentResult`/`LlmChain` removed.
- Unit tests: success / provider-failure / parse-fallback / retry-recovered / retry-still-repeats /
  retry-parse-fails / retry-throws — full server suite green.

Pending (next passes, in order):
1. **PR-1 Contract realignment (packet SPLIT).** New `ModelIntentPacketSchema` (zod) + `compose()`
   stamping `id`/`actorId`/`preferredDelay`; keep `ActionIntent`/`ActionIntentSchema` untouched. Delete
   the dead parser repair paths (fence/comma/null/brace) but **keep the `#`-strip + allow-list** until
   the renderer stops emitting `#`-prefixed channels.

   **Decision (2026-08-20):** `channelType` is wired — `create_channel` registers with
   `intent.channelType` instead of hardcoding `private_channel` (stays in #49 scope).
   `fallbackIfBlocked` is **moved to its own issue #50** and reverted from this PR — the
   engine keeps returning `blocked` (no fallback) until #50 lands; it is a model-sourced
   alternate-action decision with its own design questions (depth, allow-list, rate-limit).
   Both stay in the model-packet schema. Move the mock provider onto the packet; fold minimal
   `promptVersion` into this PR.
2. **PR-2 Prompt versioning (minimal slice of Phase 4, pulled forward).** Deterministic content-hash of
   the rendered prompt → `promptVersion` on `BuiltPrompt` + `LlmUsage` + bench report. Required before
   any format A/B can be attributed.
3. **PR-3 Constrained decoding (#38, #26).** zod→JSON-Schema + per-provider capability map; constrain
   the judge's `{"axes"}` packet (kept in `packages/eval`, **not** forced through the server surface
   contract).
4. **PR-4 Benchmark gate (#43/#44/#45/#35).** `--mode local` real-model format A/B on qwen3:8b, seed +
   `promptVersion` tagged, format as the only variable. Mock bench cannot detect format variance.
5. **PR-5a/5b Builder + format flip.** Snapshot-preserving renderer extraction first (behavior-neutral),
   then the hybrid + decision-last + drop-prose contract flip, gated on PR-4.
6. PR-6 cleanup/follow-ups (reflection routing #34, typed retry arm).

CI guard to add: build `shared`/`engine` before server typecheck so stale `dist` can't silently rot
(vitest aliases to `src`, tsc to `dist` — the staleness is invisible to the test suite).

---

## C. Locked open items (now implementation, not debate)

- [x] Implement full-hybrid renderers for `action_intent` (A.3.1–4) — done: builder rewritten to
      `##` headers + closable `<tag>` containers (`<persona>`, `<events>`, `<social>`, `<emotional_state>`,
      `<pressures>`, `<memories>`, `<actions>`, `<decision>`, `<output_contract>`, `<no_repeat>`),
      fenced literal own-utterances, engine-stamped fields removed from the contract, decision-last.
      Eval judge (`judge.ts`) + narrator user prompts converted to the same hybrid shape.
- [x] Remove prose JSON contract from the prompt — DONE for action_intent: the hand-written JSON
      blob is gone; shape is now the single-source `ModelIntentPacketSchema` (packet split), composed
      via `composeIntentPacket`, and enforced by constrained decoding on the Ollama native path
      (`format` = packet JSON Schema). OpenAI-compatible/proxy `format:"json"` fallback + real-model
      A/B to finish #38.
- [x] Extract `LlmStep` step type + `ActionIntentStep` + registry; route `action_intent` through
      it (B) — done this pass.
- [ ] Route judge + future reflection surfaces through the same step/chain contract — deferred
      (judge stays in `packages/eval`, scoped to constrained decoding per review).
- [ ] Replace repetition retry string-append with the typed retry arm (#50).
- [x] Benchmark protocol direction captured; `promptVersion` DONE (`BuiltPrompt.version` + `LlmUsage.promptVersion`,
      deterministic FNV content hash). Actual `--mode local` run is the remaining gate for the format flip
      (tie #44/#43); bench-report surface is a follow-up.

## D. Sources

- He, Rungta, et al., *Does Prompt Formatting Have Any Impact on LLM Performance?*, arXiv:2411.10541
- Anthropic, *Structure prompts with XML tags* / long-context prompting guidance — docs.claude.com
- Anthropic, *Prompting best practices* — docs.claude.com
- AI/TLDR, *Structuring Prompts: XML Tags, Markdown, Delimiters* — ai-tldr.dev (community synthesis)