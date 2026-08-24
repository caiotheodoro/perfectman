# LLM Provider SDK — Research and Recommendation (US-001 / FR-001)

**Status**: Recommendation for the approval gate (D-1/D-2). No dependency may be added to any `package.json` until this document is reviewed and the gate records LOCKED in `.claude/_output/pipeline/decision-log.md`.

**Scope**: Issue #89 (adopt an external AI provider SDK, retire the three hand-rolled transports). This is the written comparison required by US-001/FR-001/SC-001: Vercel AI SDK vs alternatives, covering OpenAI-compatible chat completions, Ollama native `/api/chat`, structured/JSON-Schema output, no-API-key local mode, non-streaming single-shot calls, TypeScript types, maintenance status, and bundle/transitive weight — plus the two seam constraints the migration depends on (test-seam `fetch` override and raw response-header capture), the cost of not adding, and the removal cost.

**Evidence basis**: npm registry metadata and published package sources (`dist/*.d.ts`, `dist/*.js`) inspected on 2026-08-24 for `ai@7.0.77`, `@ai-sdk/openai-compatible@3.0.35`, `openai@7.5.0`, `@langchain/openai@1.5.10`, `@langchain/ollama@1.3.0`, `ollama-ai-provider@1.2.0`, `ollama@0.6.3`, `@ai-sdk/provider@4.0.7`, `@ai-sdk/provider-utils@5.0.29`, `@ai-sdk/gateway@4.0.62`. No local Ollama/FreeLLMAPI run was performed (SC-004 smoke is the deferred manual verification, T024).

---

## 1. Verdict

**Adopt, in Wave 2:**

| Package | Role |
| ------- | ---- |
| `ai` (Vercel AI SDK core) `^7.0.77` | Orchestrates the single-shot calls (`generateText`/`generateObject`), non-streaming by design |
| `@ai-sdk/openai-compatible` `^3.0.35` | All OpenAI-compatible endpoints: FreeLLMAPI, DeepSeek, and any future proxy (Qwen3 via Ollama's OpenAI-compat path is NOT used — see §5) |
| `ollama` (official Ollama JS SDK) `^0.6.3` | The native `/api/chat` transport (Qwen3/Ollama provider path) |
| `zod` (direct, peer of `ai`) | `ai` 7 requires zod `^3.25.76 \|\| ^4.1.8`; the workspace already resolves zod `3.25.76` (through `@perfectman/shared`), so the server package pins the same version — no new zod major enters the lockfile |

**Rejected**: the community `ollama-ai-provider` (the "+ optional" package in D-1's provisional default) — evidence in §4.4. All SDK wiring stays confined to `packages/server/src/llm/sdk-transport.ts` + `packages/server/package.json` (D-4); the facades, `LLMProvider` boundary, factory, and 19 provider tests are unaffected by this choice.

**Deviation from the provisional default (D-1)**: D-1 named `ai` + `@ai-sdk/openai-compatible` (+ optional community `ollama-ai-provider`). The research confirms the first two and **replaces the community Ollama package with the official `ollama` JS SDK**. Reason: no currently compatible AI-SDK provider package can express Ollama's native `/api/chat` (see §4.4, §5) — the official Ollama SDK is the canonical maintained client for that endpoint and keeps the "no bespoke fetch" property of the ticket, which a hand-written `/api/chat` workaround would not.

---

## 2. Criteria Matrix

Legend: ✅ native support (verified in published types/source); 🟡 achievable through the caller's seam (documented workaround, no SDK change); ❌ not expressible.

| Criterion (US-001) | **Vercel AI SDK** (`ai` + `@ai-sdk/openai-compatible`) | official `openai` 7.5 | `@langchain/openai` + `@langchain/ollama` | community `ollama-ai-provider` 1.2 | official `ollama` 0.6 |
| --- | --- | --- | --- | --- | --- |
| OpenAI-compatible chat completions | ✅ `/chat/completions`, custom `baseURL`, Bearer only when `apiKey` set | ✅ (it defines the protocol) | ✅ (wraps `openai`) | ❌ (Ollama-only) | ❌ |
| Ollama native `/api/chat` | ❌ (see §5) | ❌ (no response re-shaping hook) | ✅ (wraps official `ollama`; `think?: boolean` exposed) | ✅ `/api/chat` (`baseURL` default `http://127.0.0.1:11434/api` + `/chat`) | ✅ native, canonical |
| `think: false` survives (Qwen3) | ❌ | ❌ | ✅ (passthrough to Ollama SDK) | ❌ no `think` option anywhere in body builder | ✅ typed `think?: boolean \| 'high' \| 'medium' \| 'low'`, serialized verbatim |
| JSON-Schema structured output | ✅ `generateObject` + `jsonSchema`; wire `response_format.json_schema` when `supportsStructuredOutputs: true`, else `json_object` | ✅ `response_format` `json_schema` / `json_object` typed params | ✅ via output parsers (extra machinery) | 🟡 `format: schema` when `structuredOutputs`, else `"json"`; no retry | ✅ `format?: string \| object` (schema object) |
| 400/422 `json_schema`→`json_object` fallback on the same budget slot | 🟡 seam: `APICallError.statusCode` (typed) → swap to tolerant handle, re-call without consuming retry budget (see §6) | 🟡 seam: `APIError.status` → re-call with `json_object` | 🟡 seam | ❌ (no retry/fallback in package) | 🟡 seam: re-call with `format: "json"` |
| No-API-key local mode | ✅ `apiKey` optional by design | ✅ | ✅ | ✅ | ✅ `host` only |
| Non-streaming single-shot | ✅ `generateText`/`generateObject` use the provider's `doGenerate` (no stream); `stream` never set by us | ✅ `chat.completions.create` (non-stream overload) | ✅ `invoke()` | ✅ `stream: false` hard-coded | ✅ `stream` defaults `false` in `chat()` |
| TypeScript types | ✅ first-class, strict generics (verified: `OpenAICompatibleProviderSettings`, `GenerateObjectResult`, `LanguageModelCallOptions`) | ✅ first-class | ✅ first-class | ✅ (but bound to provider v1 protocol) | ✅ first-class (`ChatRequest`/`ChatResponse`) |
| Maintenance status | ✅ very active: 84.0M dl/mo (`ai`), 23.0M dl/mo (provider); latest release 2026-08-22; 1464 versions | ✅ very active: 134.1M dl/mo; latest 2026-08-17 | ✅ active: 13.9M + 0.8M dl/mo | ❌ **stale**: last release 2025-01-17; deps pinned to `@ai-sdk/provider ^1.0.0`/`provider-utils ^2.0.0` (current: 4.0.7/5.0.29) — protocol-incompatible with `ai` 7 core | ✅ official (ollama/ollama-js); 2.7M dl/mo; latest 2025-11-13, stable API |
| Bundle / transitive weight | 3 packages: `@ai-sdk/gateway` 790 KB + `@ai-sdk/provider` 622 KB + `@ai-sdk/provider-utils` 887 KB unpacked, `sideEffects: false`; peer zod; `engines: node >=22` | 13.7 MB unpacked / 2747 files; peers ws, zod, `@smithy/*`, `@aws-sdk/credential-provider-node` (pnpm auto-installs peers → lockfile bloat even when unused) | heaviest: `openai` + `@langchain/core` + `js-tiktoken` (+ `ollama` + core) | tiny (24 KB + `partial-json`), but binds the whole stack to the 2025-era protocol | tiny: 128 KB unpacked, dep `whatwg-fetch` only |
| **`fetch` override (test seam, SC-003)** | ✅ `createOpenAICompatible({ fetch })` — documented "for e.g. testing"; provider passes it to `postJsonToApi` | ✅ `new OpenAI({ fetch })` | ✅ (inherited) | ✅ `config.fetch` | ✅ `new Ollama({ fetch })` |
| **Raw response-header capture** | ✅ `result.response.headers` (provider `doGenerate` returns `response: { headers: responseHeaders, body: rawResponse }`; errors expose `APICallError.responseHeaders`) | ✅ raw `Response` via `.withResponse()` / `.asResponse()` | ✅ (inherited) | ✅ (via `postJsonToApi`) | n/a — `/api/chat` has no routing headers; current code already returns `responseHeaders: {}` |

Verdict rows that drive the decision: **Vercel AI SDK wins the OpenAI-compatible column** (smallest maintained surface of the OpenAI-compatible candidates, documented test-seam `fetch`, raw headers on the result object, `transformRequestBody`/`convertUsage` hooks that map exactly onto the FreeLLMAPI/DeepSeek quirks this ticket exists to retire), and **the official `ollama` SDK wins the native column** (canonical, typed, 1:1 request-shape match with the current `OllamaProvider`, `fetch` override). LangChain adds an abstraction layer (`@langchain/core`, LCEL) with nothing this codebase needs on top of the two underlying SDKs. The community `ollama-ai-provider` is dead on arrival (§4.4).

---

## 3. Vercel AI SDK — evidence (recommendation basis)

Inspected: `ai@7.0.77` (released 2026-08-22; deps `@ai-sdk/gateway@4.0.62`, `@ai-sdk/provider@4.0.7`, `@ai-sdk/provider-utils@5.0.29`; peer `zod ^3.25.76 || ^4.1.8`; engines `node >=22`) and `@ai-sdk/openai-compatible@3.0.35` (deps provider/provider-utils only; `sideEffects: false`).

### 3.1 `OpenAICompatibleProviderSettings` (published d.ts, verbatim excerpts)

```ts
baseURL: string;                 // any OpenAI-compatible base URL (FreeLLMAPI, DeepSeek, …)
name: string;
apiKey?: string;                 // "If specified, adds an Authorization header … Bearer <apiKey>"; absent ⇒ no key sent (no-API-key mode)
headers?: Record<string, string>;
fetch?: FetchFunction;           // "Custom fetch implementation. You can use it as a middleware to
                                 //  intercept requests, or to provide a custom fetch implementation
                                 //  for e.g. testing."  ← SC-003 test seam, documented by the SDK
supportsStructuredOutputs?: boolean;   // true ⇒ wire json_schema; false ⇒ wire json_object
transformRequestBody?: (args: Record<string, any>) => Record<string, any>;
metadataExtractor?: MetadataExtractor;
convertUsage?: (usage) => LanguageModelV4Usage;   // maps prompt_tokens/completion_tokens
```

### 3.2 Verified request path (`dist/index.js`, `doGenerate`)

- URL: `this.config.url({ path: "/chat/completions", modelId })` with `baseURL` from settings.
- Body: `model`, `messages` (`convertToOpenAICompatibleChatMessages`), `max_tokens`, `temperature`, `response_format`:
  - `{ type: "json_schema", json_schema: { schema, name, strict } }` when `responseFormat.type === "json"` **and** `supportsStructuredOutputs === true` and a schema is present;
  - `{ type: "json_object" }` otherwise — **this is the JSON-Schema→`json_object` toggle the migration needs**, selectable per provider instance.
- Unknown keys under the provider-options key are spread onto the request-body root — the `extraBody` escape hatch (FR-006) maps to `providerOptions["openai-compatible"]`.
- `includeUsage`/usage: `convertUsage(responseBody.usage)` where usage schema parses `prompt_tokens`/`completion_tokens` — the exact fields `LLMProviderResult.usage` reads today.
- Response: `{ content: choice.message.content, …, response: { …createLanguageModelResponseMetadata(body), headers: responseHeaders, body: rawResponse } }` — **raw headers are captured and surfaced**; `result.response.headers` (and `result.response.body` = the raw parsed JSON, so `data.model` and any future field stay reachable through the seam).

### 3.3 Error path

`APICallError` (from `@ai-sdk/provider@4.0.7`) carries `statusCode?`, `responseHeaders?`, `isRetryable`. The seam detects `statusCode === 400 || 422` for the `json_schema` fallback and maps the rest into the `LLMError` family (network → `LLMError`, timeout → `LLMTimeoutError`, non-2xx → `LLMHttpError`, empty content → `LLMResponseError`) with the same retry-transience rules as today. This is the seam's only error-translation work — the SDK does not auto-retry 400/422 into `json_object`, which is exactly why the fallback stays caller-owned (see §6).

### 3.4 What the AI SDK does NOT provide (documented workaround obligation)

- **Native Ollama `/api/chat`** — not expressible: the response handler is fixed to the OpenAI-compatible schema (`OpenAICompatibleChatResponseSchema` → `responseBody.choices[0]`), so pointing `config.url` at `/api/chat` breaks parsing; `transformRequestBody` only shapes the request. The community provider is incompatible (§4.4). **Workaround: the official `ollama` SDK carries the `/api/chat` path** (§5) — confined to `sdk-transport.ts` per D-4. This is the one place where consolidation is "two SDKs behind one seam" instead of "one SDK", and it is forced by the ecosystem state, not by preference.
- **Dual timeout (abort + body-read race)** — the SDK offers `abortSignal` and a `timeout` call option, but not the race the spec pins (A4). The seam re-implements both timers around the call, unchanged semantics.
- **Automatic `json_schema`→`json_object` fallback on 400/422** — caller-owned (see §6), as it is in the current code.

---

## 4. Alternatives

### 4.1 Official `openai` SDK (`openai@7.5.0`)

The reference OpenAI-compatible client: 134.1M downloads/month, latest release 2026-08-17, engines `node >=22`. Verified: client-level `fetch?: Fetch` customization; typed `response_format: ResponseFormatJSONSchema | ResponseFormatJSONObject`; raw `Response` via `.withResponse()` (headers + `request_id`); `baseURL` for FreeLLMAPI/DeepSeek; no-API-key mode.

**Why not chosen**: (a) no native Ollama endpoint and no response re-shaping hook — `/api/chat`'s `{message: {content}}` shape is unparseable by the client, so the Ollama half would still need the bespoke seam; (b) heaviest footprint of the OpenAI-compatible candidates (13.7 MB unpacked, 2747 files) and, with pnpm's peer auto-install, drags `ws`, `@smithy/hash-node`, `@smithy/signature-v4`, `@aws-sdk/credential-provider-node`, and `zod` into the server package's lockfile even though only the chat resource is used; (c) the extraBody/usage/raw-header needs are all met by the AI SDK with less weight and a documented fetch seam. It remains the fallback choice if the AI SDK's provider protocol ever becomes a problem.

### 4.2 LangChain (`@langchain/openai@1.5.10` + `@langchain/ollama@1.3.0`)

`@langchain/openai` wraps `openai ^7.5.0` (+ `@langchain/core ^1.2.9` + `js-tiktoken`); `@langchain/ollama` wraps `ollama ^0.6.3` and — to its credit — exposes `think?: boolean` on `ChatOllama` (verified in `dist/chat_models.d.ts`), so it is the only candidate besides the raw `ollama` SDK that covers native `/api/chat` with `think`.

**Why not chosen**: the two wrappers inherit both SDKs' weight and add `@langchain/core` + LCEL (chains, callbacks, message history abstractions) that a single-shot chat seam cannot use; the codebase's structural precedent is deliberately minimal (plain constructor/deps injection, no service layer). The underlying SDKs are the maintained core; LangChain's added value is retrieval/chaining tooling this repo does not have.

### 4.3 Official `ollama` JS SDK (`ollama@0.6.3`) — **chosen for the native path**

Official client from `ollama/ollama-js`; 2.7M downloads/month; 128 KB unpacked; single runtime dep `whatwg-fetch` (browser build). Verified request/response types:

```ts
Config  { host: string; fetch?: Fetch; headers?: HeadersInit }        // ← fetch override (test seam)
ChatRequest {
  model: string; messages?: Message[]; stream?: boolean;              // default false ⇒ single-shot
  format?: string | object;        // schema OBJECT supported ⇒ shape-constrained decoding
  think?: boolean | 'high' | 'medium' | 'low';   // think: false serializes verbatim on /api/chat
  options?: Partial<Options>;      // nested: num_predict, temperature, seed, top_p, repeat_penalty, …
}
ChatResponse { model; message: { role; content }; done; done_reason;
               prompt_eval_count; eval_count; … }                     // usage fields, 1:1 with today's parse
```

`chat()` posts to `${host}/api/chat` (verified in the published implementation: `processStreamableRequest("chat", request)` → `post(this.fetch, host, request)` → `response.json()` when non-streaming). This is a **1:1 match for the current `OllamaProvider` request shape** (flat `extraBody` keys `top_p`/`repetition_penalty`/`seed` translated into nested `options` by the seam exactly as today; `think` at root; `format` = intent-packet schema with the 400/422 `"json"` fallback). Its non-streaming `chat()` has no built-in abort signal, so the seam's dual timeout is applied through the injected `fetch` wrapper (which also is the test seam).

**Why chosen over the AI-SDK-native alternative**: no compatible AI-SDK provider can hit `/api/chat` (§4.4, §5), and the official SDK is maintained where a bespoke fetch transport is not.

### 4.4 Community `ollama-ai-provider` — **rejected**

`ollama-ai-provider@1.2.0` is the only published AI-SDK provider for native Ollama. Verified problems:

1. **Stale**: last release 2025-01-17 (~19 months before this research date); 616K downloads/month vs 84M for `ai`.
2. **Protocol-incompatible with the current `ai` core**: deps `@ai-sdk/provider ^1.0.0` + `@ai-sdk/provider-utils ^2.0.0` (peer `zod ^3.0.0`), while `ai@7` requires provider 4.x / provider-utils 5.x. It implements the old `LanguageModelV1` protocol; `ai` 7's `generateText`/`generateObject` consume `LanguageModelV4`. Adopting it would pin the whole AI SDK stack back to the 2025-era majors — sacrificing the maintenance criterion for the other half of the stack.
3. **No `think` support**: its `getArguments` body builder (verified) produces `{ model, options: {…}, messages, format }` + `stream: false` — there is no `think` key anywhere, so Qwen3 `think: false` could not be expressed.
4. No 400/422 format fallback (it warns instead: "JSON response format schema is only supported with structuredOutputs").

It does target the right endpoint (`${baseURL}/chat`, default `http://127.0.0.1:11434/api`) and honors a `fetch` override — but the staleness and protocol skew make it a worse bet than the official `ollama` SDK, which covers the same endpoint with none of these problems.

---

## 5. Ollama native `/api/chat` and `think: false`

The head constraint of the ticket (spec edge case: "SDK must support the Ollama native `/api/chat` endpoint (where `think: false` is honored for Qwen3)"). Findings:

- **No current AI-SDK package can express native `/api/chat`** (see §3.4, §4.4). `@ai-sdk/openai-compatible` cannot be repointed at it (fixed OpenAI response schema), and `ollama-ai-provider` is stale/protocol-skewed and lacks `think`.
- **The official `ollama` SDK covers it fully**: `think?: boolean` is a typed, documented `ChatRequest` field on `/api/chat`, serialized verbatim — `think: false` survives the SDK exactly as it survives today's hand-rolled body (both are plain JSON to the same endpoint).
- LangChain's `@langchain/ollama` also passes `think` through, but only by wrapping the same official SDK underneath heavier machinery (§4.2).
- **Workaround note (plan A1 + D-4)**: the native `/api/chat` transport is not provided by the Vercel AI SDK; the official `ollama` SDK fills that gap. All Ollama-specific translation (URL derivation stripping `/v1`, flat→nested `options`, `think` passthrough, `format` schema→`"json"` fallback) stays inside `sdk-transport.ts`. Ollama's OpenAI-compat endpoint (`/v1/chat/completions`) is deliberately NOT used for Qwen3 — the current provider's comment and tests assert it does not respect `think: false`; the T024 manual smoke re-verifies post-migration behavior on a real local Qwen3.

---

## 6. Structured output and the 400/422 fallback (both transports)

The intent-packet JSON Schema (`ModelIntentPacketJsonSchema`) is the constrained-decoding contract today. Mapping:

| Current behavior | AI SDK (OpenAI-compat) | Official `ollama` SDK |
| --- | --- | --- |
| `response_format.json_schema` | `generateObject({ model: strictHandle, schema: jsonSchema(intentPacket), schemaName: "intent_packet" })` with a provider instance built with `supportsStructuredOutputs: true` | `chat({ format: ModelIntentPacketJsonSchema })` |
| 400/422 → `json_object` (`attempts--`, same budget slot) | seam catches `APICallError` with `statusCode 400/422` → re-calls the *tolerant* provider instance (`supportsStructuredOutputs: false`, which wires `{type: "json_object"}`) with the same retry budget; the schema still validates locally | seam catches 400/422 → re-calls `chat({ format: "json" })` on the same budget slot |
| `responseFormatJsonSchema: false` (force `json_object`) | use the tolerant instance from the start | `format: "json"` from the start |

Both SDKs' errors carry the status code (`APICallError.statusCode`; ollama SDK throws the parsed Ollama `ErrorResponse` with `status_code` — verified in its published types), so the existing same-slot retry semantics are preserved exactly, with the same budget accounting as today.

---

## 7. Test-seam verification (SC-003)

The 19 provider tests + agent-runtime integration cases today stub global `fetch`; SC-003 forbids behavioral rewrites. Verified override points:

- **AI SDK**: `createOpenAICompatible({ fetch })` (and `fetch` on the underlying chat config) — documented by the SDK for testing, threaded into `postJsonToApi`. The facade's injectable-fetch seam (T005) supplies this instance.
- **Official ollama SDK**: `new Ollama({ host, fetch })` — the client calls `config.fetch ?? fetch` per request. Same injection point.
- Both preserve the existing dual-timeout seam: the injected fetch wrapper can arm the abort controller and race the body read, so T004's timeout cases remain expressible for both transports (the ollama non-streaming path has no own abort signal, so the fetch wrapper carries the abort half there).

## 8. Raw response-header capture (FR-004)

`x-routed-model` / `x-routed-model-name` / `x-fallback-attempts` (FreeLLMAPI-style routing):

- **AI SDK**: `doGenerate` returns `response.headers = responseHeaders` (posted through `postJsonToApi`), surfaced as `result.response.headers` on `generateText`/`generateObject` results; raw parsed body as `result.response.body` (for `data.model` and usage). Error responses additionally expose `APICallError.responseHeaders`.
- **Ollama native**: `/api/chat` has no routing headers — today's `OllamaProvider` returns `responseHeaders: {}` with `routedModel = modelName`; the official SDK preserves that behavior trivially.
- The seam reads the headers once, into `LLMProviderResult.responseHeaders` + `routedModel`/`fallbackAttempts`, byte-for-byte the same fields as today.

## 9. Cost of not adding (FR-001)

The status quo keeps **424 lines of hand-rolled transport** (178 `openai-compatible-provider.ts` + 177 `ollama-provider.ts` + 69 eval `chat-completion.ts`), each a private re-implementation of fetch, retry, dual timeout, error mapping, and provider quirks (`think:false`, `json_schema`/`json_object` fallback, routed-model headers, usage/latency). The ticket's cost driver: every API evolution (Ollama releases, proxy json_schema tolerance, header semantics) becomes a manual patch in up to three places, and the transports have no upstream maintainer. Keeping them means #89 stays open: the duplicated `chatCompletion` seam is documented as "the seam to adopt next" in its own header comment.

## 10. Removal cost (FR-001)

By design (D-4), the SDK is confined to two touchpoints:

- `packages/server/src/llm/sdk-transport.ts` — all SDK construction, request-shape translation, retry/timeout, error mapping; deleting it (plus the `ai`/`@ai-sdk/openai-compatible`/`ollama`/`zod` entries in `packages/server/package.json`) restores the pre-SDK state; the pre-SDK provider bodies remain in git history for a direct revert.
- Facades (`OpenAiCompatibleProvider`/`OllamaProvider`), `LLMProvider`/`LLMProviderResult`, the factory, and the mock path are unchanged by the adoption — they do not participate in removal.

Estimated removal effort: one file + one package.json diff; no caller churn.

## 11. Dependencies to record at the gate (Wave 2, T006)

```jsonc
// packages/server/package.json (additions only — subject to D-1/D-2 LOCKED at the gate)
"ai": "^7.0.77",
"@ai-sdk/openai-compatible": "^3.0.35",
"ollama": "^0.6.3",
"zod": "^3.25.76"   // peer of ai; matches the version already resolved via @perfectman/shared
```

All packages declare `node >=22` (repo runtime: v22.23.2). No `ai`-related dependency is added in this wave; the FR-001 gate fires on this document's review.

## 12. Open items

- SC-004's manual smoke (T024) remains the final behavioral proof for `think: false` on a real local Qwen3 and a hosted DeepSeek/FreeLLMAPI run — not verifiable in this research wave.
- The coordinator records this verdict into D-1 (LOCKED with the final package set) at the Step 3.5 gate; Wave 2 is gated on that record.