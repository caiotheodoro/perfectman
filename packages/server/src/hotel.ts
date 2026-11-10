/**
 * Narrow entry point for the hotel sidecar (`@perfectman/server/hotel`,
 * docs/plans/hotel-package.md 19.1).
 *
 * The package barrel (`index.ts`) loads better-sqlite3, ollama and discord.js
 * at module init. This entry re-exports only what a hotel run needs, from the
 * modules themselves, so none of the three loads until something asks for it
 * (`persistence.type === "sqlite"`, an Ollama config, a Discord gateway).
 * Do not import from `./index.js` or from the `delivery/` and `llm/` barrels
 * here: both pull a heavy dependency back in. `hotel-entry.test.ts` guards it.
 */
export { SimulationRuntime } from "./simulation/simulation-runtime.js";
export type { SimulationRuntimeRepositories } from "./simulation/simulation-runtime.js";
export type { PulseResult, AgentContext } from "./simulation/pulse-scheduler.js";
export type { HotelSimulationOptions, AgentCommitInfo, OnAgentCommitted } from "./simulation/hotel-options.js";
export type { ResolvedBody, ResolvedIntent } from "./simulation/intent-resolver.js";
export { parseMentionedAgentIds } from "./simulation/intent-resolver.js";
export type {
  IDeliveryGateway,
  DeliveryMessage,
  DeliveryMessageMeta,
  IBodyGateway,
} from "./simulation/scheduler-contracts.js";
export * from "./simulation/hotel-runtime-api.js";
export type { EventLog } from "./simulation/event-log.js";
export { ChannelRegistry } from "./simulation/channel-registry.js";

export { AgentRuntime } from "./agent/agent-runtime.js";
export type { RepetitionPolicy, GuardKind } from "./agent/repetition-guard.js";
export { PromptBuilder } from "./agent/prompt-builder.js";
export type { AgentRuntimeContext, AgentRuntimeOutput, BuiltPrompt } from "./agent/agent-runtime.types.js";

export { LLMBudgetTracker, hotelBudgetRegistration } from "./llm/llm-budget.js";
export type { BudgetWarningListener, LatencyStats } from "./llm/llm-budget.js";
export { LlmCircuitBreaker, classifyLlmCall } from "./llm/llm-circuit-breaker.js";
export type { LlmCircuitBreakerOptions, CallVerdict } from "./llm/llm-circuit-breaker.js";
export { governProvider, GovernorShared, isRateLimitError, retryAfterMs } from "./llm/llm-governor.js";
export type { GovernorOptions, GovernorClock } from "./llm/llm-governor.js";
export type { LLMConfig } from "./llm/llm-config.js";
export type { LLMProvider, LLMProviderResult } from "./llm/llm-provider.js";
export { LLMHttpError, LLMError, LLMTimeoutError } from "./llm/llm-errors.js";
export { createLLMProvider } from "./llm/provider-factory.js";
// The chain builds one provider per link with its own fetch (extra headers) and env.
export { OpenAiCompatibleProvider } from "./llm/openai-compatible-provider.js";
export type { LlmTransportDeps } from "./llm/sdk-transport.js";
export { MockLLMProvider } from "./llm/mock-llm-provider.js";

export {
  buildConfiguredSimulation,
  parseSimulationConfig,
} from "./config/simulation-config.js";
export type {
  SimulationAppConfig,
  AgentConfig,
  ConfiguredSimulationHandle,
  GatewayRuntimeMetadata,
  BuildConfiguredSimulationOptions,
} from "./config/simulation-config.js";

export { compileRunInputs } from "./authoring/compile-run-inputs.js";
export { compilePersonaMarkdown } from "./authoring/persona-md-compiler.js";
export { parseMarkdown } from "./authoring/md/document.js";
export type { MdDocument } from "./authoring/md/document.js";
export type { RunInputs, CompileResult, CompileSummary, UploadedFile } from "./authoring/compile-run-inputs.js";
export type { Diagnostic } from "./authoring/diagnostics.js";
export type { RunSeeds } from "./authoring/assemble-config.js";
export { draftStory, StoryDraftError } from "./authoring/story-draft.js";
export type { DraftChain, DraftLink } from "./authoring/story-draft.js";
export type { StoryDraft } from "@perfectman/shared";

export { applySeeds } from "./http/run/seed-applier.js";
export { appraise } from "./authoring/seed-appraisal.js";
export type { PriorEvent } from "./authoring/seed-appraisal.js";
export { scrubConfigForArtifact } from "./http/run/secrets.js";
export { drainInFlight } from "./http/run/pulse-loop.js";
export type { InFlight } from "./http/run/pulse-loop.js";
export { loadPresets, defaultPresetsRoot } from "./http/run/presets.js";
export type { Preset, PresetLibrary } from "./http/run/presets.js";
export { timeboxGateway } from "./delivery/timeboxed-gateway.js";
