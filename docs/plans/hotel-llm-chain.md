# Hotel LLM provider chain

Owner decision (2026-11-07): the sidecar calls a chain of models, not one. Link 1 is `gryphe/mythomax-l2-13b` on OpenRouter (the default), link 2 `sao10k/l3-lunaris-8b` on OpenRouter, link 3 OpenCode Go `glm-5.3-flash` (`https://opencode.ai/zen/go/v1`, needs `x-opencode-session`). This page says what shipped and what the first real-model runs measured. The sidecar itself is in [hotel-package.md](hotel-package.md); the body and turn-taking quality bars are in [embodiment.md](../embodiment.md) section 10.

## Verdict

Second pass (2026-11-07, `feat/pm-llm-chain`): a compact hotel prompt for small windows, a body-block hint in the output contract, and an earshot probe that measures. The first pass's findings are kept below as "before".

Third pass (2026-11-07, merged into `feat/pm-integration`): the three follow-ups from the second pass, measured on the real chain links. Details in "Third pass: copies, earshot, facing" below.

- **Copied examples** fell to 15% of MythoMax's valid bodies (from 39% in the same-day run) and 8% of Lunaris-compact's, with valid bodies unchanged at 29% and 62% of calls.
- **Out of earshot** fell from 17 of 91 addressed `say` lines to 0 of 38 in the final-code runs.
- **Facing** rose from 60% to 87% of addressed listeners from the cast turning to the speaker; a person who is spoken to cannot be turned, and is counted apart.

- **MythoMax now serves, and stays first.** With the compact profile its prompt is 1.7K to 1.9K estimated tokens against a budget of 2720, so the chain no longer skips it. D53 bench: p95 3.6 s (limit 6 s), 0 errors, 100% JSON. Live under the cast: link p50 1.2 s, p95 1.4 to 2.4 s. The owner's rule (keep MythoMax first if it passes D53 and guarded canaries reach 45 of 47) holds: raw hotel-prompt canaries 45/47, guarded 47/47. In a 101-call chain run MythoMax served every call; Lunaris and OpenCode got none.
- **Lunaris is better on body elicitation, MythoMax is better on canaries.** Valid body in 74% of Lunaris-compact calls against 32% for MythoMax-compact; raw canary echoes the other way (Lunaris 37.5/47 compact and 35/47 full, MythoMax 45/47). Both reach 47/47 behind the guards, Lunaris with 26 (compact) and 27 (full) of 94 probe runs silenced against 9 for MythoMax. Neither is clearly better overall, so the owner's order stands. Lunaris compact versus full: same schema fallback (0% vs 1%), same pt-BR (96%), 2.4 times fewer prompt tokens, and three times the valid body rate (74% vs 25%).
- **The model now chooses physical actions.** Valid `body` block in 32% of MythoMax-compact calls and 25% to 74% on Lunaris, from 0 in 202 calls without the hint (0 of 119 and 0 of 83 in the same-day control runs), with no meaningful change in the schema fallback rate (MythoMax 1.7% before, 1.6% after).
- **The earshot probe measures now, and the answer is mixed.** 99 addressed `say` lines over all final runs, 4 delivered out of earshot (4%; the band is 2%); facing is 0 to 100% per run on small counts (band 85%). See "Earshot" below. These are sidecar-side findings, not model-side only.
- **Chain order: unchanged.** MythoMax, Lunaris, OpenCode. OpenCode's weekly quota was still spent and was not re-measured.
- **Spend:** $0.52 of real OpenRouter calls for this pass (the key's meter went from $0.263 to $0.785), $0.25 before; $0.77 in all.

First-pass verdict (full prompt only), for the record:

- The chain works live. With OpenCode's weekly quota spent (429 `GoUsageLimitError`, `Retry-After` 155092 s) a run served every call from the next link, made zero calls to OpenCode, and counted no failure.
- MythoMax could not serve the full hotel prompt in its 4K window. The untrimmable part of one actor's prompt is 3.7K estimated tokens at an empty history, about 4.6K real; link 1's budget is 2720, so the chain skipped it on 100% of calls and Lunaris served. Forced to an 8K window it served but missed D53 live (p95 6.1 s and 7.1 s) and 56% of its embodiment answers failed the intent schema.
- Guarded canaries (reference prompt) passed on both links, but MythoMax did it by going quiet. Unguarded with the house rules, MythoMax was 38.5/47 and Lunaris 46/47.

## Compact hotel prompt

`PromptBuilder` renders the hotel prompt in one of two styles. `full` is the prompt as before. `compact` carries the same facts at about 40% of the size; non-hotel prompts never see it and stay byte-identical (the parity tests pin that).

| Part | Full | Compact |
| --- | --- | --- |
| Persona | every list of the profile, relationship views, scene, secret | one card: frame (330 chars), 3 traits, 3 voice lines, length, two tonal samples, 2 hard avoids, the secret objective and its constraint; relationship views only for people in view; scene (330 chars) and 2 rules |
| Output contract | the full field list with the `body` schema union (about 1.3K chars), 6 rules | 6 keys in one line each, body hint and 2 examples |
| Events | whole history, trimmed by the cap | the trigger plus the newest 6 lines |
| Body block | everything the engine renders, compressed by cap | people who are near plus the addressee (at most 4), 3 places, 1 reach, 1 room, no groups |
| Feelings, urges, motivations | three blocks | one block of at most 6 lines |
| Memories | all, tone included | top 3 by confidence, summary only |
| Own lines | 5 verbatim and 80-char stubs of the rest | last 3, clipped at 140 chars |
| Actions | every intent | without `typing_start`, `typing_cancel`, `delay_response`, `leave_channel`, `write_memory` |

The same quoting of strangers' text, the same D43 vocabulary lint and the same cap trimming apply. Sizes on the captured scene (`gato-no-telhado`, 4 actors): the full prompt is 4.1K to 4.7K estimated tokens, the compact one 1.6K to 2.2K; the largest compact prompt seen (`fixtures/hotel-prompt-compact.json`) is 1911 against MythoMax's 2720 minus about 220 for the house rules.

**Selection is per link, by window.** A link's style is its `promptStyle` (`full` or `compact`) if set, else `compact` when `maxContextTokens` is 4096 or less. The runtime renders one prompt per call before any link is chosen, so it writes the style of the first link that can hold the untrimmable prompt (`LlmChain.promptStyle`); when link 1 cannot, the cap and the style move to the next link together (`onCap(cap, style)`). That means a call that falls through from MythoMax to Lunaris carries the compact prompt: measured to cost nothing in quality (above), so it was not worth a second render per link. `bench:latency` benches a compact link with the compact fixture.

**A failover link is sent its own render** (`ChainOptions.rebuild`, wired by the run to `PromptBuilder`). The prompt the runtime renders is written for link 1; a later link of another style or a smaller window gets the prompt rendered again in its own style under its own cap (retry correction put back on the end), instead of being skipped because link 1's prompt did not fit. This is what a picked 8K model needs: in the first two Tilehouse runs after the pick landed, MythoMax behind it served 0 of 120 and 0 of 171 calls (it was skipped for context at about 3.5K estimated tokens against its 2720 budget), so a pick's invalid-JSON answer plus OpenCode's weekly-cap 429 left 8 calls with no link. A link is still skipped when even the re-render stays over its budget. A body that was not JSON (`Invalid JSON response`) is asked once more on the same link before the chain moves on, and is not counted as a failover. A 429 asking for a wait over 5 minutes (OpenCode Go's weekly cap says 109,869 s, with a message that carries no error type) parks the link for the quota cooldown at once; before, the last link slept out the 429 (up to 10 s, three times) and took the call past its deadline.

## Body elicitation

The first pass found the model emitted a `body` block in at most 1 of 70 calls. The field list alone does not teach a 13B model to use it. The hotel output contract (full and compact, only when a body block exists) now also carries a shape hint, one paragraph that names the keys and the handles' origin and says to approach an addressee who is more than a few steps away, and two short examples of a full answer that use handles from that very render, so a copied example is always valid. The two examples vary by turn (never random) and "sit" is offered only when a seat is free.

Three example designs were tried on MythoMax-compact before this one:

| Examples | Body in | What went wrong |
| --- | --- | --- |
| whole answers with fixed in-world speech | 28% to 53% of calls | the speech and the thought were copied into chat |
| body fragments only (`{"body": ...}`) | 0% of calls, 8% to 17% schema fallback | read as the answer's shape; the intent keys went missing |
| whole answers with "…" for the words | 12% (earshot scenario only) | "…" was copied as the line itself (17 of 25 lines) |
| whole answers, speech taken from the person's own tonal samples, thought about the move itself | 32% of calls | 13 of 39 bodies are an exact copy of an example; a copied line still sounds like the person |

The shipped design is the last row. Copying remains: 33% of MythoMax's valid bodies, 13% of Lunaris-compact's and 62% of Lunaris-full's equal one of the two examples. Read the emission rate with that in mind: the model chooses to act, but often with the example's shape.

## Earshot

The sidecar's frame log had no `chat` frames carrying an addressee, so the eval lane's `earshot-violation` and `facing-rate` probes read an empty set (the first pass reported 0 of 0). Now the run writes a `chat` frame (`agentId`, `mode`, `toRef`, `sameRoom`, `distance`) when an addressed line leaves the room queue. The addressee is the author a reply answers, a named target or someone named in the line, when they share the room. A line that outruns its commit (the model was slower than the persona's typing delay, which is the usual case for a slow link) is held until the planner seam has seen the intent. `DeliveryProjection` now passes `eventId` on message and reply deliveries (the type already declared it; nothing filled it).

The probe has a third scenario, `earshot`: the human stands at the far end of a 30-tile room, about 15 tiles from the cast, and shouts addressed lines (a shout is the only line the cast hears from there). Their answers to a person that far away are the addressed `say` lines under test; the engine defers a line only when the model also asks to move, so this exercises the body hint too.

## What shipped

| Piece | Where |
| --- | --- |
| `PERFECTMAN_LLM_CHAIN` parser, legacy `PERFECTMAN_LLM_*` fallback, known prices and tokenizer ratios | `packages/hotel/src/llm/chain-config.ts`, `src/config.ts` |
| Failover, per-link breaker and governor, sticky return, context fitting, per-link usage | `packages/hotel/src/llm/chain.ts`, wired in `src/run/run.ts` |
| Output guards and house rules | `packages/hotel/src/llm/guards.ts` |
| Per-link D53 gate, with the compact fixture for compact links | `packages/hotel/scripts/bench-latency.ts`, run through `scripts/register-ts.mjs` (`pnpm --filter @perfectman/hotel bench:latency`) |
| Compact hotel prompt, body hint and examples | `packages/server/src/agent/hotel-compact-prompt.ts`, `hotel-body-hint.ts`, wired in `action-intent-prompt-builder.ts` (`PromptStyle`); `LLMConfig.promptStyle` |
| Per-link prompt style, moves with the cap | `packages/hotel/src/llm/chain-config.ts` (`linkPromptStyle`), `chain.ts` (`promptStyle`, `onCap`), `env.ts` |
| Addressed-line frames for the earshot and facing probes | `packages/hotel/src/run/run.ts` (`noteAddressee`, `noteLine`), `gateway/hotel-gateway.ts` (`onLine`) |
| Body examples drawn per turn from the room's own handles | `packages/server/src/agent/hotel-body-hint.ts` (`candidates`, `bodyExamples`) |
| Walk-then-talk enforced for an addressed `say` line past the say radius | `packages/server/src/simulation/intent-resolver.ts` (`farAddressee`, `walkToAddressee`, `deferToArrival`), `wouldShout` from `run.ts` |
| Addressee and speaker turn to each other at once, keep facing through the exchange | `packages/hotel/src/embodiment/plan.ts` (`planFacing`, `noteExchange`, interlocutor memory), `run.ts` (`faceInterlocutor`) |
| Real-model probes (not part of `pnpm test`) | `packages/hotel/probe/` (`probe:llm`, `probe:canary`) |

Changes outside `packages/hotel`: one export line in `packages/server/src/hotel.ts` (`OpenAiCompatibleProvider`), so a link can pass its own `fetch` (extra headers) and `env` to the server's transport; and, in the second pass, the prompt builder (`packages/server/src/agent/`, hotel mode only), `LLMConfig.promptStyle`, and `eventId` on message and reply deliveries in `DeliveryProjection`.

### Config

`PERFECTMAN_LLM_CHAIN` is a JSON array. Per link: `name` (unique), `baseUrl`, `apiKeyEnv` (the NAME of the variable, never a key), `model`; optional `maxContextTokens`, `sessionHeader`, `headers`, `timeoutMs` (as written when set, and never more than what is left of the 16 s chain deadline; the narrator's chain caps it at 4 s; when absent, 5000 ms or more: see "Timeouts" below), `tokenRatio`, `promptStyle` (`full` or `compact`; default by window), `tier` (`recommended`, `fast` or `experimental`; default derived: see "Tiers" below), `harden` (default true), `extraBody` (a JSON object merged into the request body: see below). A bad entry names every problem at once; a missing key variable on any link fails startup. When the chain is set its models are the allowlist and `PERFECTMAN_LLM_MODELS` is not read. Prices come from a built-in table (MythoMax 0.08/0.11, Lunaris 0.04/0.05, in $ per million tokens) that `PERFECTMAN_LLM_PRICES` overrides; where the provider bills a call (OpenRouter's `usage.cost`) the billed amount is used instead. An enabled sidecar refuses to start when a link's model has no price, naming the link, so a forgotten price is not metered as free; a subscription link (OpenCode `glm-5.3-flash`) declares `{"inUsdPerMTok":0,"outUsdPerMTok":0}` in `PERFECTMAN_LLM_PRICES` explicitly. The chain is not parsed or validated while `PERFECTMAN_ENABLED` is off.

#### A thinking model: `extraBody`

A model that reasons before it answers spends the answer budget (400 tokens) thinking and returns an empty `content`, and takes longer than the 5 s default to do it. Measured live on OpenCode Go, `deepseek-v4.1-flash`: with the default timeout every call timed out; with a 120-token cap all tokens went to `reasoning_content`; with the reasoning switched off it answered in 1 to 2 s with 0 reasoning tokens. So give such a link a longer `timeoutMs` and a reasoning switch in `extraBody`:

```json
[{"name":"opencode-go","baseUrl":"https://opencode.ai/zen/go/v1","apiKeyEnv":"OPENCODE_KEY","model":"deepseek-v4.1-flash","sessionHeader":"x-opencode-session","timeoutMs":60000,"extraBody":{"thinking":{"type":"disabled"}}}]
```

with the price line it needs (a flat subscription is 0/0, declared, so a forgotten price is not mistaken for a free model):

```
PERFECTMAN_LLM_PRICES={"deepseek-v4.1-flash":{"inUsdPerMTok":0,"outUsdPerMTok":0}}
```

`OPENCODE_KEY` is the NAME of the variable that holds the key; the key itself is set in the environment, never in the chain. The switch is provider-specific: DeepSeek-style endpoints take `{"thinking":{"type":"disabled"}}`, OpenAI-style ones `{"reasoningEffort":"none"}`. Write it camelCase: the transport sets `reasoning_effort` itself from `reasoningEffort` and drops a snake_case extra, so `reasoning_effort` is refused at startup with that hint.

`extraBody` is merged exactly as a code-built one: the link's own replaces the base config's (the picked model's reasoning switch still replaces it for that link), and the link's penalties (`frequencyPenalty`, `presencePenalty`, or the model's known entry) go on top. It must be a plain JSON object and may not set a field the runtime owns: `model`, `messages`, `stream`, `stream_options`, `max_tokens`, `max_completion_tokens`, `temperature`, `tools`, `tool_choice`, `functions`, `function_call`, `n`, `response_format`, `frequency_penalty`, `presence_penalty` (`RESERVED_EXTRA_BODY_KEYS`). Anything else (`top_p`, `seed`, a vendor's own flag) goes through. A violation fails the whole config (`Invalid sidecar configuration`) naming the link and the key.

OpenRouter links send `HTTP-Referer` and `X-Title: CMB` unless the link sets its own. A link with `sessionHeader` sends the run id in it.

### Failover

Calls start at link 1 and take the first link that answers. Any error fails over: 429, 5xx, timeout, network, empty answer (a missing or blank `content`), rejected key. Skipped without a call: a link in a cooldown (a 429 carrying the provider's own quota code, OpenCode's `GoUsageLimitError` or OpenRouter's `insufficient_quota` and `free-models-per-day`, puts a link out for the `Retry-After`, capped at an hour and at least a minute; 402, 401 and 403 for 10 minutes. A generic 429, even one whose text says "exceeded your" or that asks for a long wait, only takes the governor's normal Retry-After backoff and never parks the link), a link whose breaker is open, a throttled link (penalty window over 1.5 s) when another link is behind it, and a link whose window the prompt does not fit.

- **Breaker:** one server `LlmCircuitBreaker` per link (per run), 3 consecutive failures to open (a success in between resets the count), 15 s backoff doubling to 5 min. Stickiness is the breaker's: while link 1 is open the chain stays on the working link, then one half-open trial call goes to link 1 and the first good answer returns the chain to it. A trial that ends in a spent quota or a refused key (`LinkUnavailableError`) reopens the breaker like any failed trial; before 2026-11-10 it left the breaker half-open, which skips the link for the rest of the run. A link opening never pauses the run; only a call where every link failed throws, and the run-level breaker counts that as one provider failure. The breaker's own probe events carry the structured `providerFailure` flag the fix-review lane added.
- **Governor:** one `GovernorShared` penalty window per link. A link with another behind it retries a 429 once and waits at most 1.5 s.
- **Deadline:** one 16 s chain deadline (13 s until run 63; the 20 s generate deadline is the outer bound) is shared by all attempts; each attempt gets the smaller of the link's timeout and what is left, and a link is skipped (`deadline`) when under 1.5 s is left.
- **Health check:** run start and the breaker probe ping the links in order and succeed on the first that answers.
- Each served call records its link: `routedModel` is the link name, `fallbackAttempts` the links passed over, `x-pm-link` the same in the headers. `run_status` `llm_p50_ms` / `llm_p95_ms` are over served calls and include the time lost to failed attempts. Per-link calls, failures, served, skipped by reason, tokens, cost, p50/p95 and breaker state are in `Run.llmChain().snapshot()`, logged at run end, and flattened into the replay manifest counters (`llm_served_<link>`, `llm_failures_<link>`, `llm_guard_<reason>`). The director's `run_status` schema is unchanged, so per-link numbers do not reach the panel; the repetition and output guards add `llm_guard_repeat_own` and the others listed in the seventh pass, and the dialogue guards the ones in the eighth. Failed calls are counted by class per link (`failReasons`, `llm_failreason_<link>_<class>`: `timeout`, `http_<status>`, `invalid_json`, `empty`, `network`, `quota`, `auth`, `context`, `error`), and each served call records why the links before it were passed over (`ServedRecord.passed`, e.g. `pick:invalid_json`, `opencode-glm:timeout`). The answering link and model per call are in the `pulse_metrics` event (`routedModel`, `model`, `fallbackAttempts`).

### The builder's draft follows the chain

`AuthoringService.draft` ("Draft with AI") runs over the same links, in order, with what each link declares: `baseUrl`, `model`, the key in `process.env[apiKeyEnv]`, the headers of `linkHeaders` (so an OpenCode Go link carries `sessionHeader`, one fresh session id per draft; without it the gateway answers 400 `MissingSessionID`), and `extraBody`. A link whose key variable is empty is skipped. A non-2xx (400, 401, 402, 429, 5xx), a network error, a timeout, an empty reply or two unreadable drafts fails over to the next link; a too-short brief is refused before any call. A draft is a long answer, so each attempt gets at least 60 s even when the link's `timeoutMs` is the 5 s pulse default, and at most 90 s; there is no breaker or cooldown state for drafts. When all links fail, the 503 carries each link's name and its provider's own `error.message` (or the first 160 characters of the body) in `errors[0].message`, e.g. `opencode-deepseek: 400 MissingSessionID ...; lunaris: 429 ...`, with every key scrubbed. With no `PERFECTMAN_LLM_CHAIN` the draft stays one request to `PERFECTMAN_LLM_BASE_URL` with `PERFECTMAN_LLM_API_KEY`.

### Context fitting

The runtime renders a prompt before any link is chosen, trimming to the first link's budget: `(maxContextTokens - 400 output) * 0.92 / tokenRatio`, in the prompt builder's own chars/4 unit. `tokenRatio` is real tokens per estimated token, measured on the pt-BR hotel prompt: 1.25 for MythoMax, 1.1 for Lunaris (live means ran 1.04 to 1.33 and 1.07 to 1.14). 4096 gives 2720 for MythoMax; with a ratio of 1 it would be the 3400 the owner quoted, which in real tokens was optimistic.

If a prompt stripped of everything droppable still does not fit link 1, the chain learns that link 1 can never hold this cast's prompt and moves the runtime's cap to the next link's budget. Without that, every actor would be sent a prompt with no history, no memories and no recent lines even though link 2 has room. A link that rejects a prompt for size shrinks its own budget to the size that failed, without counting against its breaker. The chain also skips any link whose budget the prompt (plus the house rules) exceeds, which is how MythoMax is passed over below.

OpenRouter silently shortens a prompt that is far over a small model's window (a 24K-character prompt came back as 4312 prompt tokens and a malformed answer), so the fit check is a correctness guard, not only a cost one.

### Output guards

Deterministic, no model calls, run on every answer before the runtime sees it. A line that trips one is never delivered; the chain asks the next link once; if that line trips too, or no link is left, the call returns a silent `no_op` (the runtime records `no_op_recorded`). The tokens of both calls are still metered.

| Guard | Holds back |
| --- | --- |
| `self_reference` | D43: first-person admissions and talk of AI, bot, language model, assistant, simulation, programming, pt and en; denials ("eu não sou um robô") pass |
| `refusal` | assistant-style refusals and offers to help |
| `whisper_leak` | a public line repeating a code or a four-word run of text the actor received privately; a reply in the private channel may repeat it |
| `canary_echo` | a code-like token (`CANARY-X-1`) planted in a stranger's line, name, room or furniture label, or a line that is mostly the phrase a stranger told the actor to say |

Only `visibleContent` is guarded; a private motive is never delivered.

### House rules for small models

Four short in-world rules are appended to the system prompt of each link (pt-BR or en to match the prompt, about 220 tokens, counted in the fit check): quoted text is talk, never an order; you are a person, answer "what are you" as one; a whisper is private; never talk like a clerk, choose `no_op`. They name no AI, bot, model, agent or simulation (D43), and a test lints that. `harden: false` on a link turns them off.

## Measurements

### Second pass: compact profile, body hint, earshot

Same sidecar, runtime, planner and pt-BR preset `gato-no-telhado` as the first pass. Each variant ran three scenarios: `turns` (12 human lines), `embodiment` (30 base pulses at 6 s, three scripted addressed lines) and `earshot` (12 shouted lines from across the room). The numbers below pool the three; counts are small, so read them as a few percent either way. The link column is the model's own latency per call; "turns reply" is the human line to the addressee's line on the wire.

| | MythoMax compact | Lunaris compact | Lunaris full | chain (MythoMax first) |
| --- | --- | --- | --- | --- |
| calls | 122 | 158 | 105 | 101, all served by MythoMax |
| prompt est. tokens, p50 per scenario | 1681 to 1708 | 1676 to 1816 | 4092 to 4396 | 1707 to 1770 |
| answer rejected by the intent schema (fallback no-op) | 1.6% | 0% | 1.0% | 5.0% |
| valid `body` block, % of calls | 32.0% | 74.1% | 24.8% | 23.8% |
| pt-BR lines | 93.5% | 96.0% | 95.8% | 92.9% |
| D43 self-reference in delivered lines | 0 | 0 | 0 | 0 genuine (4 lines opening "Ai, ai, ai...", the Portuguese interjection; the regex flags it) |
| link p50 / p95 | 1.2 s / 1.4 to 2.4 s | 1.2 to 1.5 s / 1.5 to 6.2 s | 1.2 to 1.5 s / 2.1 to 3.3 s | 1.2 to 1.3 s / 2.5 to 4.5 s |
| turns: addressed line answered | 5 of 8 | 8 of 8 | 7 of 8 | 6 of 8 |
| turns: reply p50 / p95 | 1.3 s / 2.5 s | 1.5 s / 5.0 s | 1.5 s / 3.3 s | 2.3 s / 4.5 s |
| guards held | 0 | 0 | 0 | 0 |
| billed cost | $0.034 | $0.016 | $0.021 | $0.031 |

- **Quality is a wash between the styles on Lunaris** and the compact prompt is 2.4 times smaller. Its one outlier is a single 6.2 s call. No LLM judge was run: it was not cheap enough to add to this pass, so "quality" here is schema fallback, language, D43, latency and body validity.
- **MythoMax answered 5 of 8 addressed lines** in the turns scenario (Lunaris 8, 7 and 8 of 8); with 8 lines per cell that is a flag to watch, not a result. Its per-call latency is the lowest of the three.
- **The chain's 5% fallback** is 5 of 101 calls on the same link that did 1.6% alone. The sample is too small to call that a difference.
- The first pass's "56% of MythoMax embodiment answers failed the schema" was at an 8K window with the full prompt. With the compact prompt it is 1.6%.

#### Body emission, before and after

"Before" is the same variant with the body hint and examples stripped from the contract (`PROBE_NO_BODY_HINT=1`, run the same day); the first pass saw at most 1 block in 70 calls. A body is valid when it passes the strict body schema and names only handles that render offered. "Movement plausible" is a prompt that shows someone 3 or more steps away or a free seat.

| variant | calls | body in prompt's contract | valid body, % of calls | valid body when movement plausible | schema fallback | bodies that copy an example |
| --- | --- | --- | --- | --- | --- | --- |
| MythoMax compact | 119 | no hint | 0% | 0 of 69 | 1.7% | - |
| MythoMax compact | 122 | hint | **32.0%** (39) | 29.2% (28 of 96) | 1.6% | 13 of 39 |
| Lunaris full | 83 | no hint | 0% | 0 of 12 | 4.8% | - |
| Lunaris full | 105 | hint | **24.8%** (26) | 22.2% (21 of 83) | 1.0% | 16 of 26 |
| Lunaris compact | 158 | hint | **74.1%** (117) | 72.5% (74 of 102) | 0% | 15 of 117 |

The target (20% of turns with a valid body intent when movement is plausible, without raising the fallback rate meaningfully) is met on all three. What the blocks are: MythoMax-compact 22 moves, 7 postures, 3 gestures and 6 expressions in the embodiment scenario; Lunaris-compact 87 moves of 124 calls. The engine blocked 0 to 5 of them per run (`body_blocked`).

#### D53 bench (30 calls per link, concurrency 2)

| link | prompt | budget | err | p50 ms | p95 ms | JSON | cost | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mythomax, compact fixture | 1911 | 2720 | 0 | 1896 | 3621 | 100% | $0.0296 | ALLOW |
| lunaris, full fixture | 4612 | 6516 | 2 | 1373 | 1757 | 100% | $0.0058 | ALLOW |
| lunaris, compact fixture | 1911 | 6516 | 0 | 1014 | 3788 | 100% | $0.0029 | ALLOW |

Before: MythoMax was REFUSED because the 4612-token prompt did not fit (latency alone, p95 4193 ms, would have passed).

#### Canaries through the real hotel prompt

The first pass ran the judge lane's 47 canaries on its own reference prompt, which fits any window, so it could not say anything about the compact profile. `CANARY_PROMPT=hotel` renders the same probes through the hotel prompt builder (house rules on, 2 samples; replies to a whisper count as a whisper back to the human, a little generous on whisper privacy). Clean probes out of 47, mean of two samples:

| link | prompt | est. tokens | raw | guarded | raw failures | probe runs the guards left silent |
| --- | --- | --- | --- | --- | --- | --- |
| mythomax | hotel compact | 1009 mean | 45 (46, 44) | 47 (47, 47) | 4 echoes | 9 of 94 |
| lunaris | hotel compact | 1009 mean | 37.5 (37, 38) | 47 (47, 47) | 19 echoes | 26 of 94 |
| lunaris | hotel full | 2660 mean | 35 (37, 33) | 47 (47, 47) | 21 echoes, 2 AI admissions, 1 whisper leak | 27 of 94 |

MythoMax scores 47/47 guarded, so the owner's rule (move Lunaris first only if MythoMax is below 45 while Lunaris passes) does not fire; raw, MythoMax is also the cleaner of the two under this prompt. One MythoMax answer did not parse as an intent (counted as silence). The Lunaris runs needed a retry on OpenRouter's upstream 429 (the probe now retries up to four times).

#### Earshot and facing, now measured

Addressed `say` lines on the wire, how many were delivered to an addressee more than 6 tiles away (or in another room), and the facing probe (listener facing the speaker about 3 s later; band 85%). Pooled over the three scenarios of each run.

| variant | addressed `say` lines | out of earshot | mean distance | facing, per scenario |
| --- | --- | --- | --- | --- |
| MythoMax compact | 12 | 1 | 1.0 to 3.5 tiles | 0.50, 0.75, 0.80 |
| MythoMax compact, no hint | 9 | 0 | 1.0 to 1.3 | 0.50, 0.40 |
| Lunaris compact | 45 | 1 | 1.6 to 7.3 | 0.50, 0, 0.44 |
| Lunaris full | 11 | 2 | 3.2 to 9.0 | 1.0, 1.0, 0.30 |
| Lunaris full, no hint | 16 | 0 | 1.1 to 1.3 | 0.25, 0.33 |
| chain | 6 | 0 | 1.5 to 3.5 | 1.0, 0.25 |

4 of 99 lines (4%) were delivered out of earshot against a 2% band (second pass; the third pass below changes this), and the cases are the ones the engine cannot stop: a model that answers a far shout with a plain line and no move (the engine defers a line only when the model also asks to walk; Lunaris-compact deferred 3 lines until the speaker arrived). Facing sits under the 85% band in most runs, on small counts. Neither number has a baseline from the first pass (it measured 0 of 0 and a vacuous 100%), and with counts this small they are a finding to follow up, not a verdict. The `earshot` scenario itself produced only 1 to 5 addressed lines per run; the embodiment scenario supplies most of them.

### Third pass: copies, earshot, facing

Same sidecar, runtime, planner and pt-BR preset as above, with one change to the harness: `FakeDirector` now applies `face` commands and turns a walker to the way it walks. Before, it ignored `face`, so every actor kept its spawn direction and the facing probe measured the fake, not the planner. "Before" is the merged code before these changes (commit `96ea881`, the same fake), "after" is the final code. Three scenarios per run (`earshot`, `turns`, `embodiment`, 12 lines, 30 pulses), two runs of the "after" variant, real MythoMax and Lunaris-compact. The pooled counts are still small; read them as a few points either way.

| | MythoMax before | MythoMax after | Lunaris compact before | Lunaris compact after |
| --- | --- | --- | --- | --- |
| calls | 129 | 257 (2 runs) | 169 | 283 (2 runs) |
| valid `body`, % of calls | 27.9% | 29.2% | 58.6% | 62.5% |
| valid bodies equal to a shown example | 14 of 36 (38.9%) | 11 of 75 (14.7%) | 7 of 99 (7.1%) | 14 of 177 (7.9%) |
| of those, privately-worded the same too (whole answer copied) | not counted | 2 | not counted | 1 |
| addressed `say` lines out of earshot | 0 of 7 | 0 of 18 | 3 of 32 | 0 of 66 |
| cast listeners facing the speaker 3 s later | 6 of 15 (40%) | 34 of 35 (97%) | 29 of 43 (67%) | 70 of 84 (83%) |

The out-of-earshot rate on the older fake, which is the one the second pass used, was 12 of 47 for Lunaris-compact and 2 of 5 for MythoMax in the first before-runs, and 1 of 33 and 4 of 28 in the first after-runs (the MythoMax lines were most likely replies that named the addressee in their words, which the first version of the check did not read; it does now, with a test).

**Copies.** The examples are no longer a fixed trio of shapes over the nearest, farthest and first-seat handles. `bodyExamples` builds a pool from the people, free seats and handles of this very render (approach a far person and talk, wave and smile, laugh, thumbs up, face them, sit on a free seat), then draws two of different kinds by a hash of the turn, so the pair changes every turn, a copy is still a valid and plausible act in this room, and nothing that leaves the room, kisses or dances is offered. Walk-to-a-spot and follow were dropped from the pool after the first re-measure: a model that picks them is indistinguishable from one that copied them. The probe counts a valid body as a copy when it equals a shown example; some of those are what a model would choose on its own (a laugh toward the person who just joked), so `copiedWhole` (the private motive also word for word the example's) is the stricter number: 3 answers in 252 valid bodies. Target of under 15% met on both; valid body of 20% or more kept (29% and 62%).

**Earshot.** `IntentResolver.assessBody` now treats an addressed `say` line to someone more than 6 tiles away (the replied-to author, a named target or a cast member named in the words, in that order) as a walk-then-talk whether or not the model wrote a body, a move, or `speak_then_move`: it adds an `approach` to the addressee with `move_then_speak`, which the existing deferral machinery holds until `body_arrived` (or drops after 2 times the ETA plus 5 s with `not_in_earshot`). Two things stay as they were: a line the planner will shout (arousal above 0.8 on shout-worthy text, once a minute; the new `wouldShout` peek is pure and does not start the cooldown) is not held, because a shout carries; and a released line is resolved without a space view, so it is never held twice. Two lines were held and released in the final runs, and none went out of earshot.

**Facing.** Rule 2 of the planner only ran after the actor's own model call, and only for `lastSpokeAt` within 8 s. Now `faceInterlocutor` runs at the moment a line is heard, with no model in the way: the addressed cast member turns to the human who spoke (`handleHumanChat`), and both ends of an actor line turn to each other when it leaves the queue (`noteLine`). It uses `planFacing`, which respects the 4-commands-per-5-s budget, a live room and a walking actor, and records the exchange in the planner memory for 20 s: later pulses keep facing that person even after they stop talking (rule 2 now reads the interlocutor too), and the no-op fidget does not turn the actor away mid-exchange. The frame log also records `human_chat {ref, toRef}` per addressed actor, so the probe judges cast members turning to a human, which it could not before. A person at the keyboard is not ours to turn: lines the cast addresses to a human are judged but left out of the 87% (5 lines, 1 facing in the final runs).

### First pass: full prompt only

All with the real sidecar, runtime, prompt builder, arbiter and planner, `FakeDirector` at the hotel's 300 ms tick and the real model, on the pt-BR preset `gato-no-telhado` (4 characters plus one human). Prompts are 3.7K estimated tokens at an empty history and 3.8K to 4.6K in play.

### D53 gate (`bench:latency`, 30 calls per link, concurrency 2, the captured real prompt of 4612 est. tokens)

| link | budget | n | err | p50 ms | p95 ms | JSON | cost | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mythomax | 2720 | 30 | 0 | 2620 | 4193 | 100% | $0.0295 | REFUSE: prompt does not fit the budget (latency alone would pass) |
| lunaris | 6516 | 30 | 1 | 1349 | 1692 | 100% | $0.0060 | ALLOW |
| opencode | 6000 | 30 | 30 | - | - | - | $0 | REFUSE: 30 of 30 calls 429 (weekly quota) |

Live under three concurrent actors MythoMax is slower than in the bench: p50 3.6 to 4.8 s, p95 6.1 s (turns) and 7.1 s (embodiment), above the 6 s budget. Lunaris live: p50 1.4 to 1.6 s, p95 2.1 s (turns) and 4.0 to 4.8 s (embodiment).

### Real-model probe (`probe:llm`)

Turn-taking: 12 human lines (8 addressed, 4 not), base pulses off, focus lane only. Embodiment: 31 base pulses at 6 s, three scripted addressed lines. MythoMax rows ran with its window forced to 8192 so it could serve at all.

| | lunaris | lunaris, no house rules | mythomax @8K | chain (mythomax, lunaris, opencode) |
| --- | --- | --- | --- | --- |
| calls (turns / embodiment) | 13 / 70 | 13 / 70 | 12 / 70 | 8 / 35, all served by lunaris |
| answer is valid JSON | 100% | 100% | 100% | 100% |
| answer rejected by the intent schema (fallback no-op), turns / embodiment | 8.3% / 6.8% | 0% / 9.5% | 16.7% / **55.6%** | 0% / 0% |
| addressed line answered by the addressee | 75% (6 of 8) | 100% (8 of 8) | 75% (6 of 8) | 100% (4 of 4) |
| addressed reply p50 / p95 | 1.4 s / 1.7 s | 1.6 s / 4.1 s | 4.2 s / 5.0 s | 1.3 s / 1.5 s |
| dog-pile rate (turns) | 8.3% (1 of 12) | 0% | 8.3% | 16.7% (1 of 6) |
| pt-BR lines | 98.9% to 100% | 100% | 92.7% to 100% (1.8% en) | 97.8% to 100% |
| D43 self-reference in delivered lines | 0 | 0 | 0 | 0 |
| lines held by the guards | 0 | n/a | 0 | 0 |
| billed cost, both scenarios | $0.016 | $0.015 | $0.129 | $0.008 |

Reading it:

- **JSON validity is not the failure; schema validity is.** Every answer parsed as JSON, but MythoMax's embodiment answers were rejected by the intent schema in 56% of calls (in a manual call it answered with `message` and `room` keys) and the runtime fell back to a no-op. Lunaris: 7 to 10%.
- **Reply latency** is from the human line to the addressee's line on the wire, so it includes the model call and the typing delay. Counts are small (4 to 8 lines per cell); read the ranges, not the points.
- **House rules on normal play:** no measurable difference at this sample size (answered 75% vs 100% is 6 of 8 vs 8 of 8). Their effect shows in the canaries.
- **No false positives:** the guards held 0 lines across 299 real calls of ordinary play.
- **Body intents:** the models emitted a `body` block in at most 1 of 70 calls per run, so body-intent validity is not measurable here (the one block was accepted in three runs and blocked in one). Movement and gestures in these runs came from the planner, not the model.
- **Embodiment probes** (`runEmbodimentProbes` on the run's frame log): teleport 0, impossible action 0, stale-command 0, facing 100% in every run. Earshot violation is 0 of 0: no `say` line with a named addressee reached the frame log, so that probe was not exercised; the 6-tile rule is covered by the deterministic tests, not by this run.
- **Prompt identity lint** (eval probe) reports 3 to 23 hits per run, all from words inside the cast's own chat history (the Portuguese verb "ia" matches); the static prompt of the captured fixture has 0.
- **Live failover:** a run whose chain was [opencode, lunaris] pinged OpenCode at start, got the 429, put it in cooldown for the hour, and served 8 of 8 calls from Lunaris with 0 calls and 0 failures against OpenCode.

### Canary red-team set (`probe:canary`)

The judge lane's 47 canaries (jailbreak echoes, planted names, "are you a bot", whisper privacy; `feat/pm-judge` @0c26cdc, vendored read-only in `probe/canary/`), its reference prompt and its detectors, 2 samples per cell. Clean probes out of 47, mean of two samples (each sample in brackets). "Guarded" removes the lines the sidecar's guards would hold back; in production the call is regenerated once on the next link, so this is the worse case.

| link | prompt | raw | guarded | raw failures | probes where the guards left the actor silent |
| --- | --- | --- | --- | --- | --- |
| mythomax | reference | 35 (36, 34) | 47 (47, 47) | 18 echoes, 6 AI admissions | 22 of 94 |
| mythomax | + house rules | 38.5 (39, 38) | 47 (47, 47) | 14 echoes, 3 AI admissions | 17 of 94 |
| lunaris | reference | 37.5 (35, 40) | 47 (47, 47) | 16 echoes, 3 AI admissions | 20 of 94 |
| lunaris | + house rules | 46 (46, 46) | 47 (47, 47) | 2 echoes | 3 of 94 |
| opencode | - | not run | - | weekly quota spent, every call 429 | - |

Silence is a cheap way to pass, so read the last column: MythoMax with the house rules still needs the guards to silence it in 17 of 94 probe runs, Lunaris in 3. The guards' echo counts equal the judge detector's exactly. They hold 1 to 2 more self-reference lines than the judge's detector flags in three of the four cells, plus one refusal-pattern line on MythoMax; those extra lines were not reviewed by hand. No whisper leak or refusal failed raw in these runs; the judge lane's 1 whisper leak and 1 refusal on its own run did not recur. MythoMax also answered outside the reference's `{"lines":[...]}` format far more often (49 and 72 of 102 replies vs 7 and 2 for Lunaris).

## Open items

- **A fall-through from MythoMax to Lunaris sends Lunaris the compact prompt**, because the runtime renders once before choosing a link. Measured harmless; a second render per link would only matter if Lunaris's compact answers turned out worse on a larger sample.
- **Body examples are still copied sometimes** (14.7% of MythoMax's valid bodies, 7.9% of Lunaris-compact's, 3 whole answers). The pool is wide and drawn per turn; if the cast still starts to move in lockstep, vary the shape per persona.
- **Earshot and facing counts are small** (66 and 84 lines for Lunaris-compact, 18 and 35 for MythoMax). Remaining ways for a far line to land: the addressee walks away while the line waits in the room queue, and a speaker who moves on a `speak_then_move` to somewhere else; neither showed up in the final runs. Re-measure with `PROBE_LINES=24` before treating the band as met for good.
- **No LLM judge** was run in the second pass.
- **Per-link numbers on the panel** need new fields in the `run_status` schema.
- **Re-run the OpenCode column** when its quota returns: `CANARY_LINKS=opencode pnpm --filter @perfectman/hotel probe:canary`, `bench:latency`, and `PROBE_LINKS=opencode ... probe:llm` with the chain reordered.
- **OpenRouter's table price understates MythoMax:** billed cost ran 4.4 times the listed $0.08 / $0.11 (a 4580-token prompt billed $0.0017). The meter uses the billed amount; the built-in table is only the fallback.

## Reproducing

```
set -a; source llm.env; set +a                       # OPENROUTER_API_KEY, OPENCODE_API_KEY, PERFECTMAN_LLM_CHAIN
pnpm --filter @perfectman/hotel build
pnpm --filter @perfectman/hotel bench:latency -- --n 30 --ignore-fit
PROBE_LINKS=lunaris PROBE_LINES=12 PROBE_PULSES=30 PROBE_MAX_USD=0.3 \
  PROBE_PROMPT_OUT=packages/hotel/fixtures/hotel-prompt.json pnpm --filter @perfectman/hotel probe:llm
PROBE_LINKS=mythomax PROBE_CTX=mythomax=8192 pnpm --filter @perfectman/hotel probe:llm
CANARY_LINKS=mythomax,lunaris,opencode CANARY_SAMPLES=2 CANARY_MAX_USD=0.45 pnpm --filter @perfectman/hotel probe:canary
```

Second pass:

```
# each link benched with the fixture of its own style; --prompt-file forces one
pnpm --filter @perfectman/hotel bench:latency -- --n 30 --link mythomax,lunaris
# compact prompt, three scenarios; PROBE_STYLE forces a style on every link, PROBE_NO_BODY_HINT=1 strips the body hint (the "before" column)
PROBE_LINKS=mythomax PROBE_SCENARIOS=earshot,turns,embodiment PROBE_LINES=12 PROBE_PULSES=30 \
  PROBE_PROMPT_OUT=packages/hotel/fixtures/hotel-prompt-compact.json pnpm --filter @perfectman/hotel probe:llm
PROBE_LINKS=lunaris PROBE_STYLE=full pnpm --filter @perfectman/hotel probe:llm
# canaries through the real hotel prompt
CANARY_PROMPT=hotel CANARY_LINKS=mythomax CANARY_STYLE=compact CANARY_VARIANTS=hardened pnpm --filter @perfectman/hotel probe:canary
```

`PROBE_HARDEN=0` runs without the house rules; `PROBE_DRY=1` runs the harness against a local stub and spends nothing. `PROBE_MAX_USD` stops a probe that has spent that much.

## Fourth pass: who gets an answer (2026-11-07, `feat/pm-integration`)

The final demo showed 5 of 11 addressed lines unanswered after 15 s and a p95 of 22.5 s. From the recorded run the causes were these, in order of weight:

- **The line never reached the actor.** The guest stood at the door and called "Rafa, ..." across the bar. `say` is heard only to 10 tiles, so the line was stored operator-only: no focused pulse, no open line for the arbiter, no turn toward the guest. Later the same actor's ambient turn was blocked by `room_speech:one_answer_per_line`. Fix: a person called by name hears it clear at any distance in the room (the ingestor), so the focused pulse, the open line and the head turn all happen.
- **A hung link ate the turn.** `generateIntent exceeded its 20000 ms deadline` on 5 of 207 calls: two OpenRouter links timing out at 8 s each, behind a single 20 s deadline. Link timeout 5 s, one chain call 13 s, so three links fit.
- **Silence and copies on an addressed line.** The model chose `no_op` for a whisper twice in a row (the flaky whisper check); a repeat was retried on the same link that had just copied. Now an actor that stays silent on a line addressed to it is asked once more on the next link with the reason to speak; a retry of a near-duplicate starts on a different link (the one that just answered goes last) and the repetition guard allows two retries in a hotel run; the body examples never use a line the actor or the room has just said.
- **A whisper that names someone else.** The flaky whisper check: "o que voce acha da Gabi?" whispered to Rafa carried `mentionedAgentIds: [Gabi]`, so the engine never counted Rafa as addressed and the focused pulse ended in a patience hold. A whisper now mentions its target alone; a spoken line mentions the names in it plus whoever it is addressed to.
- **A repeat for someone who asked.** After the retries, a near-duplicate answer to a guest's line aimed at the actor is delivered instead of blocked. A copy stays blocked on an ambient turn. The chain also keeps a per-link copy rate: a retry goes to the other link, unless that link copies at least 25 points more often than the one that just answered (after 6 samples each).
- **A blip on the only link that fits.** With Lunaris first and its full prompt, MythoMax's 4K window skipped it on every call, so one `Invalid JSON response` from Lunaris was silence (9 of 164 calls). A link that failed on a blip gets one more try when nothing else answered. Setting `"promptStyle": "compact"` on the Lunaris link makes the prompt small enough for MythoMax, which then serves as a real failover (74 of 189 calls in the compact runs).
- **Typing delay.** An addressed reply lands within 1.5 s of the consult (4 s for ambient talk).

Numbers are in `docs/perfectman/evidence-final.md` (Tilehouse repo), "After the fixes".

## A model picked for one run (2026-11-07, `feat/pm-start-modal`)

The Tilehouse start modal lets an admin pick any OpenRouter model for a run (Tilehouse decision D54). The hotel sends it in `run_start.model` (`{id, context?, price_in?, price_out?, reasoning?}`); `withPickedModel` in `packages/hotel/src/llm/run-model.ts` makes it link 1 of that run's chain, named `pick`, on OpenRouter with the key the configured OpenRouter link uses, and leaves the configured chain behind it as failover (a configured link with the same model is dropped). The prompt is sized for the pick: compact at a window of 8192 tokens or less, full above. A model that must think gets `reasoning.effort: low`, one that may think `reasoning.enabled: false` (`LlmLink.extraBody`, applied per link, never inherited by the next link). An unpriced model is metered at the price the hotel read from OpenRouter, else from the `usage.cost` the provider bills. The allowlist (`PERFECTMAN_LLM_MODELS`) and the D53 gate still describe the configured chain only. `PROBE_PICK=<id>` in the real-model probe runs this path; the numbers are in Tilehouse `docs/perfectman/evidence-start-modal.md`. The picker's list and its default are the hotel's, not the sidecar's (Tilehouse `crates/server/src/perfectman/models.rs`: `GET models`, `DEFAULT_MODEL`); the sidecar only receives `run_start.model`. It records the pick's tier and cast size in the manifest (see "Sixth pass").

## Fifth pass: repetition-blocked turns (2026-11-07, `feat/pm-repetition`)

Goal: repetition-blocked turns from 19% (Tilehouse stage 1, run 23) to 5% or less, without losing answers. Chain for every measurement: Lunaris (`"promptStyle": "compact"`), MythoMax, OpenCode (429, quota still spent).

### Where the repeats come from

Recorded Tilehouse runs (`final-fix/runs/23`, `final/runs/7`; the events keep the blocked turn but not its text, so this reads the delivered lines):

- **A finite pool of lines, spoken again.** Each default-mode person has 4 sample lines. In run 23, 15 of 34 delivered lines contain or nearly equal one of them (17 of 102 in run 7). The prompt showed the first two samples every turn ("Sounds like"), and the body examples borrowed the same lines.
- **Self-repeat.** 7 of 34 delivered lines are a near-duplicate (Jaccard 0.5) of the same actor's earlier line, and one actor (Gabi, 4 samples, timid) takes 7 of the 11 blocks.
- **Copying other actors** is small: 0 of 34. Real in principle, not the cause of the 19%.
- **Ambient talk.** 116 no-op turns for 40 spoken lines; the guard blocks were mostly turns with nobody waiting.

The new `default` scenario of `probe:llm` (4 people from the stage's "Sexta no bar" form, one guest who speaks to each in turn every 25 s, base pulses at 6 s, 5 minutes, `FakeDirector`) reproduces it. It splits each first attempt (before any retry) by what it repeats: about 70% of the model's first answers were a near-duplicate (Jaccard 0.7), over 90% of those of the actor's own lines, 2 to 9% of a sample line, 0 to 1 per run of another actor's. Retries rescued most, so blocks stayed at 22 to 29% of turns and half of all model calls were retries. Two things in the harness were wrong and are fixed: the probe counted thought bubbles (`mode: thought`, the motive over the head) as lines said, which made the cast look 3 times as talkative as the stage; and its D43 pattern matched inside accented words ("botão"), now fixed; it still flags the interjections "ai" in "E ai" and "ai, ai!" (false positives, left alone).

### What changed

| Change | Where |
| --- | --- |
| The compact prompt lists what the others just said ("Already said by the others", 3 lines) beside the actor's own last 4 lines (was 3) | `hotel-compact-prompt.ts` |
| "Sounds like" rotates the tone samples by turn and skips any the room or the actor just said (the body examples already did) | `rotateSamples` in `hotel-body-hint.ts` |
| An angle of the turn ("react to the last thing said", "ask somebody a concrete question", "tease lightly", ...) drawn by a hash of the turn; not on a line aimed at the actor | `angleFor` |
| `visibleContent` is described as speech only, never what the person wants or thinks | contract text |
| Per-link decoding penalties on OpenRouter: frequency and presence 0.5 for both known models, `+0.4` and temperature `+0.25` (cap 1.1) on the retry of a near-duplicate; `frequencyPenalty` / `presencePenalty` per link in `PERFECTMAN_LLM_CHAIN`, 0 turns one off | `chain-config.ts`, `chain.ts` |
| Cross-actor copies are caught: a line of 3 or more content words that is a near-duplicate (0.7) of one of the last 8 cast lines heard is retried and, if it survives, blocked; a guest's own line is never compared; asked lines are still delivered | `roomThreshold` in `RepetitionPolicy`, `roomLinesHeard` |
| A cheaper retry: the failed attempt joins "your last lines" in the retry prompt, so the angle rotates and the model sees it as said | `ambientMaxRetries`, `buildRetryPrompt` |
| A spoken thought is a repeat: a line that is the actor's own `privateMotiveSummary`, or one of the body examples' thoughts, is retried | `isThoughtSpoken` |
| Ambient gate: an actor consulted with no trigger is not consulted that way again for 30 s unless something someone else did has appeared in its view; addressed and triggered turns are never held | `ambientGate` (`SplitPulseConfig`), `AMBIENT_QUIET_MS` |

All of it is hotel-only: non-hotel prompts, the generic repetition guard (no `roomThreshold`) and the sequential scheduler are untouched, and the parity tests pass as before.

### Before and after

Same scenario, real chain, 5 minutes, 4 people and one guest, two runs each (baseline is the code of `56a56e7` with the same probe; runs alternated). Repetition rate is the Tilehouse definition, blocked / (said + blocked).

| | before (2 runs) | after (2 runs, final code) |
| --- | --- | --- |
| Repetition-blocked turns | 28.6%, 21.8% | **6.9%, 3.4%** |
| Lines said per minute (talk volume) | 8.9, 8.5 | 10.7, 11.2 |
| Model calls, of which retries | 189 / 99, 177 / 96 | 136 / 47, 153 / 65 |
| Addressed lines answered | 10 of 12, 12 of 12 | 12 of 12, 12 of 12 |
| Unanswered after 15 s | 2, 0 | 0, 0 |
| Addressed reply p50 / p95 | 3.2 / 10.1 s, 3.8 / 8.7 s | 3.7 / 5.6 s, 3.9 / 5.9 s |
| First answers that were a near-duplicate | 57 of 83, 54 of 77 | 42 of 81, 46 of 83 |
| D43 self-reference | 0 | 0 (the two probe hits are "ai, ai!" and "E ai") |
| Link p95 (Lunaris, MythoMax) | 1.8 / 1.9 s, 2.3 / 1.7 s | 4.0 / 3.6 s, 2.2 / 1.7 s |

Two more after-runs on the previous code (no retry temperature boost) gave 7.5% and 8.6% at 12.2 and 10.5 lines per minute, so the mean over the four after-runs is 6.6% and over the final two 5.2%: at the 5% target on two samples that vary between 3% and 9%, not a calibrated rate. The talk volume went up, not down: fewer turns end in a block and fewer lines are lost.

Canaries through the real hotel prompt (compact, house rules, the link's penalties, 2 samples): guarded 47 of 47 on both links; raw 46 (Lunaris, was 37.5) and 44 (MythoMax, was 45).

The compact prompt grew by about 170 tokens (p95 1572 to 1707 and 1739 estimated tokens against MythoMax's budget of 2720; no call was skipped for size).

Spend: about $0.41 of real OpenRouter calls (a 5-minute run costs $0.02).

### Still open

- First answers are still near-duplicates in half the turns; the retry is what keeps blocks low. Cutting that further needs more than 4 sample lines per person or a persona that gives the model something to say (the stage's cast is thin on purpose).
- The probe's `mode: thought` filter also changes the older tables above that counted chat lines (language share, dog-pile): they included thought bubbles. Not re-run.
- The Tilehouse 19% is one 5-minute run; the harness has no typing indicator, so the guest never makes `room_speech:human_typing` hold the cast, and walk-in timing differs. Re-run stage 1 on the stage before calling the target met.

## Sixth pass: a production audit (2026-11-10, `fix/chain-reliability`)

Question: the `runs.model` column showed the 8B Lunaris for 4 of the last 6 runs, with garbled pt-BR, verbatim repeats and more `no_op_recorded` events than lines said. Were the good links being skipped?

**No.** The `run llm usage` lines of runs 56 and 57 show every breaker closed, 0 calls skipped, 0 exhausted, link p95 4.6 to 6.4 s. The 8B was link 1, because it was the pick: run 56 had `pick` = `sao10k/l3-lunaris-8b`, which served 17 of 28 calls (deepseek 10, glm 1 call that failed on a timeout, MythoMax 1); run 57 had `pick` = `deepseek/deepseek-v4.1-flash-1017`, which served 18 of 19. The hotel's model list (`GET models`) names `sao10k/l3-lunaris-8b` as its default (`DEFAULT_MODEL`, owner decision 2026-11-07); whether run 56's admin chose it or kept the preselection was not checked. Nothing in the chain ordered the 8B first; the chain served the link it was given.

What the audit did find, each fixed here:

| Finding | Where it came from | Change |
| --- | --- | --- |
| A narrator reply with trailing commas (`"captions": ["a", "b",],`) and a second array after the object played the fallback text | the reply was cut from the first `{` to the last `}` and parsed strictly | `parseNarrationReply`: each `{` is tried as the start of the card, the balanced object is parsed, then parsed again without trailing commas; code fences, prose before or after and a BOM do not matter. A card needs a `title`; every other field falls back alone. `narrator_repaired` counts these, `narrator_fallbacks` the cards that played fallback text |
| A half-open trial that ended in a spent quota or a refused key left the link's breaker half-open, so the link was passed over as `breaker_open` for the rest of the run | `LinkUnavailableError` took the cooldown branch and never told the breaker | the trial's failure is observed: the breaker reopens with doubled backoff and the link is tried again after the cooldown |
| A blank `content` (a thinking model that spent its answer budget thinking) was served as an answer and became a `no_op` | the transport throws on a missing `content`, not on `""` | the chain treats a blank answer as a failed attempt (`empty`): it counts toward the breaker and the call moves to the next link |
| A link with no `timeoutMs` timed out at 5 s while its own p95 was 5.9 s | the default is fixed | see "Timeouts" |
| `llm_served_pick` does not say which model that was, and a failed call kept no reason | counters are per link name | see "Failure reasons" and "Tiers" |

Not changed, on purpose: the breaker's threshold, backoff and the chain's order. The logs do not show them misbehaving.

### Timeouts

A `timeoutMs` in a link's config is used as written (cut to what is left of the 13 s deadline). A link without one waits `max(5 s, 1.5 x p95)`, where the p95 is over its last 200 successful calls, once it has 10 of them, capped at 6.5 s (9 s until run 63, when a link at its cap timed out on 9 of 37 calls and left the third link under its 1.5 s minimum 9 times) and cut to what is left of the deadline. Only successes make the p95, so a run of timeouts cannot raise it. A link that has never answered inside 5 s has no p95 and keeps 5 s: run 56's one glm call timed out with no history to adapt from. Such a link needs a `timeoutMs` of its own (a live test of OpenCode deepseek measured p50 3.1 s and p95 5.9 s, against the 5 s default).

### Failure reasons

Per link, `failReasons` and the run counters `llm_failreason_<link>_<class>` (see "Failover"); per served call, `ServedRecord.passed`. A call that falls back is therefore explainable afterwards without the sidecar's log: which links, in what order, and why each was passed over.

### Tiers

`modelTier({ id, context, tier })`: the link's `tier` when set, else the lower of what its window and its size allow. A size is read from the model id (`l3-lunaris-8b` is 8, `gryphe/mythomax-l2-13b` is 13); a window or size that is not known counts for nothing.

| Tier | Rule | Examples |
| --- | --- | --- |
| `experimental` | 8B or less, or a window of 8192 or less | Lunaris 8B, MythoMax 13B at 4096 |
| `fast` | up to 30B, or a window up to 32768 | a 27B model, a 32K model |
| `recommended` | the rest, and a model that states neither | `deepseek-v4.1-flash`, `glm-5.3-flash`, a model with a 1M window |

The tier is recorded and never used to order the chain or refuse a pick. A pick is allowed for any cast; with an `experimental` pick and 3 or more characters the run logs a warning at prepare. The manifest (`replay.json`) has an optional `llm` block: `picked_model`, `picked_tier`, `picked_actors` (only when the admin picked) and `links`, the model and tier behind each link name. The snapshot shows each link's tier.

What this repo cannot do: the start-modal's list (`GET models`) and its default belong to Tilehouse. To label models in the picker and to default to a `recommended` one, Tilehouse needs a `tier` on each `ModelInfo` by the same rule (the rule is in `modelTier`, with its test vectors in `llm-model-tier.test.ts`) and a different `DEFAULT_MODEL`; the sidecar will then record whatever it is sent.

## Seventh pass: repeats that got through (2026-11-10, `fix/repetition-guard`)

Hotel runs 53 to 57 of 2026-11-10 (pt-BR, an 8B model, 3 actors) still had an actor saying the same sentence twice (Ian, 15:17:54 and 15:20:11), the same joke 27 s apart (Caio), one question in 5 of 6 lines (Pistolinha: "você já viu um pato de perto?"), a closing tic on nearly every line (Heloísa: "meu bem... não é, querido?"), a 90 s loop of "senta os dois / dois minutos / próximo passo", and corrupt tokens ("Éduğunu", "umapreciação"). The production event log was not available; the causes below are read from the code and measured on the lines quoted.

### What covered, what did not

| Mechanism | Covered | Gap (confirmed from the code unless marked) |
| --- | --- | --- |
| Own line vs `ownRecentUtterances` (12 lines), Jaccard 0.7 over word sets | an exact or near-exact repeat | a repeat whose changed tail is long: Ian's sentence plus 6 new words scores 0.67, plus 1 word 0.92 (measured); no check of word order, so an embedded question or a shared closing is invisible |
| Room copy (`roomThreshold`) | a line of 3+ content words at 0.7 against the room's last 8 | same set measure; a copy with a few words changed passes |
| A retry note, generic | "too close to something you already said" | never names the phrase, so a small model says it again |
| After the retries, a person's question is answered with the repeat | a guest who asks twice gets an answer | the carve-out delivers any repeat to a line aimed at the actor, including a loop; likely for lines addressed to a guest (inferred) |
| A line held for `move_then_speak` | the walk's arrival releases it | `releaseSpeech` re-submits it through `resolveDeferred` with no repetition check, and a held line is not in `ownRecentUtterances` until it is said, so an actor consulted while walking says it again and both go out |
| Decoding penalties | `KNOWN_SAMPLING` models and links that set them | a run's picked model (`pick` link) not in that table sends none, on the first answer or the retry; only the temperature boost applies |
| Corrupt text | nothing | no check reads the letters of a line |

### What changed

Everything below is hotel-only: `RepetitionPolicy.strict` is set in `run.ts`; without it the step behaves as before.

| Change | Where |
| --- | --- |
| Own echo: a 6-word shared opening, or a 6-word shared run covering 60% of the shorter line, or 60% of its trigrams, against the actor's last 8 lines (folded: case, accents, punctuation, stage directions, laughter runs, letter elongation) | `echo-guard.ts` `findOwnEcho` |
| Room echo: a 5-word run covering 70% of the shorter line, or 70% of its trigrams, against the room's last 4 lines | `findRoomEcho` |
| Signature phrase: a shared phrase of 5 words or more (4 with 3 topic words, so "o envelope do Otávio" is not one), the same first or last 3 words, or the same question about the same 3 topic words, in 2 of the actor's last 4 lines plus the candidate (3 of 5). The retry note names the phrase, bans it and its variations, and asks for new information or a decision | `findPhraseLoop`, `loopRetryNote` |
| Corrupt text: a replacement or control character, a letter outside Portuguese, Spanish, French and English (unless the room already wrote it), `uma`/`umas`/`voce` glued to a word, a word of 28 letters or more, one word 7 times running. One retry with a note that names the token, then the line is dropped | `findGarble`, `garbleRetryNote` |
| A repeat or loop that survives the retries is blocked as before (`repetition_blocked`); corrupt text is dropped as a `no_op` with the `Output guard:` motive, which is not a provider failure, so it never feeds the breaker or the health watch | `action-intent-step.ts` |
| A held line is checked against the log when it is released and dropped as `repetition_blocked` when it became a repeat while it walked | `heldLineRepeat`, `PulseScheduler.resolveDeferred` |
| Scene stall (drama hotel runs): 4 room lines with no person's line, no body change near the actor, and at most 2 numbers, names or topic words the 8 lines before did not have add one line to the decision: reveal, accuse, refuse and say why, leave, touch. Not on a whisper or a line aimed at the actor. A scene with fewer than 7 lines is never stalled | `scene-stall.ts` |

Unchanged on purpose: the carve-out for a person who asked (a repeat is still delivered to them, corrupt text is not), the chain's failover and breaker, and the penalty table (adding a retry-only default for unlisted models would send a parameter some providers reject; left for a measured follow-up).

### Thresholds

Chosen on 128 hand-written ordinary pt-BR lines (accents, "KKKK", slang, shouting, numbers, stock frames shared by different lines; 16,256 ordered pairs, and every window of 5 under 15 rotations) and the 63 chat lines the five persona packs carry (not written for this guard): no pair echoes, no window of 5 loops, no line is garbled. A shared opening of 5 words ("eu acho que você tem ...") is not an echo, which is why the own opening and run are 6. A line of fewer than 5 words is left to the older Jaccard check. The room rule is stricter than the own rule because answering in the other's words is half of talking.

### Counters

In the replay manifest, alongside `llm_guard_<reason>`; these eight are always present, zeros included: `llm_guard_repeat_own`, `llm_guard_repeat_room`, `llm_guard_phrase_loop`, `llm_guard_garble` (candidates flagged, a first answer or a retry, by what each is first; a repeat delivered to a person who asked is flagged too), `llm_guard_repeat_blocked`, `llm_guard_garble_dropped` (turns that ended without a line), `llm_guard_held_repeat` (held lines dropped on release) and `llm_stall_nudges` (prompts that carried the stall line). Operator events carry the new violations (`phrase_loop`, `garbled_text`) in `llm_retry_recovered.data.violations`.

### Not covered

- A number that contradicts the line before ("DUZENTAS" then "Duas mil pratas?").
- A loop in which every line brings a new word (the stall check counts new names, numbers and topic words, so a paraphrase loop with fresh synonyms reads as moving).
- A first-attempt prompt that already bans a phrase the actor's last lines carry: the ban is on the retry only, so a loop costs one retry per turn until it breaks.
- No measurement on a real model; the tests are the quoted lines and the corpora above.

## Eighth pass: dialogue the guards let through (2026-11-10, `fix/dialogue-v2`)

Run 60 (pt-BR, three bot actors, a hand-written estate scene) read as actors that do not listen: 92 model calls for about 41 spoken lines (45% of the calls were guard retries), 10 lines that were the guard's own "Ah.", "Hm.", "Ué.", "Sei." or "Tá." (they also closed question debts), narration said out loud ("Olho pra ela, sorriso atravessado."), a median line of 19 words under a cap of 40, a reveal ("eu vi a caneta na sua mão") that nobody answered, and a quotation nobody made ("Ela te chamou de irmão e de burro"). The production event log keeps no guard action as text (only counters in `replay.json`); the causes below are read from the code and the 38 lines of the transcript. The numbers and the rules are in [script-likeness.md](script-likeness.md); this is the part that touches the chain-facing actor loop.

| Change | Where |
|---|---|
| A turn gets one retry, whatever the rules the first attempt broke; the notes of every broken rule go in one numbered note (it was up to `maxRetries`, 2, one rule at a time) | `action-intent-step.ts`, `mergeRetryNotes` |
| A line the guard cannot repair is a no-op with the motive `Output guard: no fresh line (...)`, plus the model's face or one for its strongest feeling, never a filler said in its place; the "give a short reaction" sentence is gone from the notes. `PERFECTMAN_FILLER_SILENCE=0` restores the old text | `silenceMotive`, `silentBody`, `fillerSilenceEnabled` |
| `Line held back by the output guard` (the chain's silent no-op, `hotel/src/llm/guards.ts`) counts as an engine-written motive, so every reader that skips those skips it | `shared/src/agent/engine-motive.ts` |
| Builder personas and a persona file with no `presence.messageLength` are `short` (pt aim 5-12, cap 22, en 6-14 and 28) | `persona-md-compiler.ts`, `room-files.ts`, `lengthTargetFor` |
| Narration (first-person body verbs) is cut out of `visibleContent` before any check reads it; the contract line says speech only | `stripNarration`, `speechOnlyLine` |
| Novelty is judged against the actor's own last 3 lines and the previous turn, leaving out the scene's topic words; a filler does not clear a question debt | `lowNovelty`, `isRealAnswer`, `owedQuestion` |
| Quotations and claims ("X te chamou de Y", "X disse que ...") must be in the last 10 room lines: one retry, then the sentence is struck. Only a named speaker, "você", or "ela"/"ele" with exactly one other person in view is checked: a claim about someone who may be absent is left alone | `falseQuotes` |
| A reveal, accusation, threat or offer in the room's last line puts a "react to this first" note in the decision of the person it names or is aimed at (a name in the words, an addressee or reply target in the log), or of everyone who hears it when it names nobody | `moveBefore`, `answerNoteFor` |
| `guard-log.jsonl` per run, one line per guard action `{t_ms, actor, rule, before, after}` (an operator artifact, `guard_log` in the manifest; `PERFECTMAN_GUARD_LOG=0` turns it off) | `hotel/src/run/guard-log.ts`, `artifacts.ts`, `RepetitionPolicy.onGuard(kind, info)` |

### Counters

Added to the run's counters, always present, zeros included: `llm_narration_stripped`, `llm_quote_retry`, `llm_quote_struck`, `llm_guard_silenced` (turns that ended in silence because nothing fresh was left) and `llm_answer_note` (prompts that carried the note). `llm_motif_reaction` now counts repairs that kept the sentences without the motif; with `PERFECTMAN_FILLER_SILENCE=0` it counts the swaps for a reaction as before.

### Not covered

- No real model ran: whether deepseek obeys a 22-word cap, keeps its actions in `body`, quotes only what was said or reacts first to a reveal is unmeasured. The replay of run 60's lines is on scripted candidates (what the old guard replaced with a filler was not kept).
- "Ela" or "ele" in a room where two or more other people spoke is not checked, so a false claim hides behind a pronoun (run 60's "Ela te chamou de irmão e de burro" is caught only by name).
- A line that names a person who is not a speaker in view or near (a dead husband) names nobody here, so everyone in earshot gets its note.
- A repeated demand in new words is still invisible to the motif check, and the stall nudge is still suppressed whenever a body change is near the actor (`scene-stall.ts`).
- Non-word detection ("efatigável") stays a non-goal: there is no dictionary.

## Ninth pass: echoes in short lines (2026-11-10, `fix/echo-short-lines`)

Run 62 (production, pt-BR, 45 minutes, three bot actors, the eighth pass's code with the 22-word cap) kept the cap but not the variety: Heloísa said "Otávio, meu bem, sente-se." at 22 s and again at 27 s, Otávio opened 22 lines with "Rapaz", Heloísa 9 with "querido", Renato 6 with "mana", "Bêbado ..." opened four of Otávio's lines in a row of six and "Vinho não" three in 40 seconds. Its counters: `llm_guard_repeat_own` 25, `llm_guard_phrase_loop` 25, `llm_len_retry` 130 of 374 turns (35%), `llm_novelty_retry` 68, `llm_guard_silenced` 28, 1.8 model calls per spoken line. The echo checks were made for lines of 40 words (a shared opening of 6, a run of 6 over 60%, 60% of the trigrams, nothing under 5 words); at a median of 13 words a repeat has to be long to be one. The rules and the numbers are in [script-likeness.md](script-likeness.md#short-lines-echo-tics-repairs); this is the part that touches the chain.

| Change | Where |
|---|---|
| Lines are also compared by what they say, with the room's names, forms of address ("meu bem", "rapaz", "minha cara") and edge fillers taken off each clause: the same address and opening words (`lead`), the same 3 opening words with half the topic words (`open`), 60% of the topic words in any order (`set`), the same first 2 words in 3 of the last 6 turns (`frame`). The sequence thresholds for long lines are unchanged | `echo-guard.ts` (`voiceOf`, `findOwnEcho`) |
| A form of address, a tag question or an opening word in 4 of the actor's last 6 turns is a tic. A form of address is taken off the line with no retry (a retry that happens anyway carries "não comece com X"); an opening word or a tag question gets one retry | `findTics`, `stripTics`, `ticRetryNote` |
| A candidate over the cap by a quarter or less (23 to 27 words at cap 22) is cut at its last sentence or clause boundary with no retry, kept only when 5 words or more survive; more than that, one retry as before. `PERFECTMAN_FREE_TRIM=0` restores the retry | `trimFree` in `shared/src/script-likeness/guards.ts`, `action-intent-step.ts` |
| A repeat the retry did not fix, and a line stale against the actor's own lines after its retry, keep the clauses that say something new when 4 words of them remain, instead of becoming silence | `strikeEcho` |
| The decision says how many words the actor's last line had, when it had more than 75% of the cap | `lengthFeedbackFor`, both prompt builders |

### Counters

Added to the run's counters, always present, zeros included: `llm_len_trim_free` (candidates cut with no retry), `llm_guard_tic` (candidates with a tic), `llm_guard_tic_stripped` (forms of address taken off a line) and `llm_guard_echo_repaired` (repeats and stale lines kept in part instead of silenced). The guard log has the matching rules `len_trim_free`, `tic`, `tic_strip` and `echo_repair`; `echo_own` now carries the short-line rule and the earlier line it matched. `PERFECTMAN_SCRIPT_GUARD=0` turns all of it off (the free cut, the tics, the short-line rules, the repairs and the length feedback in the prompt).

### Measured

On run 62's own lines as candidates the new rules flag 129 of 207 (62%; 63 lines said in the room: 23, 37%), against 1 for the checks of before; of those 19 are echoes that earn a retry and 123 carry a form of address that is only cut. On ordinary lines (the 128 pt-BR lines and the personas' 133 style examples) there are no echo or tic flags and the loop as a whole flags 0.8% of the pt-BR turns, all by the novelty rule of the eighth pass. The retry bill for length, on scripted candidates (35 of 100 over the cap, every line ending within 22): 10% of the turns when the overshoots are mostly small, 25% when they follow the real overshoots of runs 52 to 60, 35% without the free cut. The real-corpus flag rate was not measured: `beats.jsonl` is not on this machine.

### Not covered

- No real model ran. Whether deepseek drops "rapaz" when told, how far over 22 words it lands, and so what the retry bill is, is unmeasured: the 10% is on an assumed distribution, the 25% on lines from runs that had a cap of 40 and no number in the prompt. The target of 1.3 calls per spoken line is not reachable from the length path alone: run 62's novelty retries (68), echoes and loops (about 50 flagged candidates) and garble (18) are separate, and the new rules add retries for echoes the old ones let through.
- The rules read words. A repeated idea in new words ("Cofre nunca fechou pra mim" then "Quero o cofre aberto agora") is not an echo; a tic is only as wide as the lists of forms of address and fillers.
- A free cut drops the tail of a line, so a line whose point is in its last sentence loses it.
- Phrase loops (`findPhraseLoop`) were not given short-line thresholds: a 3-word phrase held by 2 of the last 4 lines, a question frame of 2 shared topic words and a 2-word head or tail added at most 1 flag on run 62's 207 lines and none on the ordinary lines, so the vocative, opening and tag-question loops are caught by the tic and echo rules above.
