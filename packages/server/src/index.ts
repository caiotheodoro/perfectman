// Server package entry point — populated by dev1 (agent/llm) and dev2 (socket/simulation)
// Dev3 owns: packages/server/src/persistence/

export { openDatabase, closeDatabase } from "./persistence/sqlite/database.js";
export type { DB } from "./persistence/sqlite/database.js";
export { SqliteEventRepository } from "./persistence/sqlite/event-repository.js";
export { SqliteAgentStateRepository } from "./persistence/sqlite/agent-state-repository.js";
export { SqliteMemoryRepository } from "./persistence/sqlite/memory-repository.js";
export { SqliteSimulationRepository } from "./persistence/sqlite/simulation-repository.js";
export { SqliteChannelRepository } from "./persistence/sqlite/channel-repository.js";
export { SqliteGoalRegistryRepository } from "./persistence/sqlite/goal-registry-repository.js";
export type { GoalSelfVerdictEntry } from "./persistence/sqlite/goal-registry-repository.js";
export type {
  IEventRepository,
  IAgentStateRepository,
  IMemoryRepository,
  ISimulationRepository,
  IChannelRepository,
  CreateSimulationInput,
} from "./persistence/repositories.js";

// Dev1 - Agent Runtime & LLM Cognition Exports
export * from "./agent/agent-runtime.js";
export * from "./agent/agent-runtime.types.js";
export * from "./agent/intent-parser.js";
export * from "./agent/persona-prompt-profile.js";
export * from "./agent/persona-loader.js";
export * from "./agent/agent-config-registry.js";
export * from "./agent/repetition-guard.js";
export * from "./agent/engine-motive.js";
export * from "./llm/index.js";
export * from "./delivery/index.js";

// Dev2 - Simulation Runtime Exports
export { SimulationRuntime } from "./simulation/simulation-runtime.js";
export type {
  ConfiguredInitialChannel,
  SimulationRuntimeConfig,
  SimulationRuntimeRepositories,
} from "./simulation/simulation-runtime.js";
export type {
  IDeliveryGateway,
  DeliveryMessage,
  DeliveryMessageMeta,
  IBodyGateway,
} from "./simulation/scheduler-contracts.js";
// Hotel runtime API (types and frozen constants only; ADR-0020 to 0025).
export * from "./simulation/hotel-runtime-api.js";
export type { AgentContext } from "./simulation/pulse-scheduler.js";
export type { HotelSimulationOptions, AgentCommitInfo, OnAgentCommitted } from "./simulation/hotel-options.js";
export { RoomSpeechArbiter, DEFAULT_ARBITER_CONFIG, ROOM_CHANNEL_PREFIX, roomIdOfChannel } from "./simulation/room-speech-arbiter.js";
export { computeActorAudibility, WHISPER_NOTICE_TILES } from "./simulation/actor-audibility.js";
export { parseMentionedAgentIds, bodyCommandNames } from "./simulation/intent-resolver.js";
export type { ResolvedIntent, ResolvedBody, AudibilityResult } from "./simulation/intent-resolver.js";
export { WallClockPulseLoop, systemLoopClock } from "./simulation/wall-clock-pulse-loop.js";
export type { LoopClock, LoopState, WallClockPulseLoopOptions } from "./simulation/wall-clock-pulse-loop.js";
export { AgentLocks, GenerateSemaphore, sampleLandingDelayMs, LANDING_DELAY_CAP_MS, TYPING_MS_PER_CHAR } from "./simulation/split-pulse-support.js";
export { sanitizeUntrustedText, quoteUntrusted, safeDisplayName, UNTRUSTED_LIMITS } from "./agent/untrusted-text.js";

// Dev2 - Goal-layer eval surface (additive exports only; the eval harness
// wires GoalLayerRuntime directly per the goal-end-to-end test recipe)
export {
  WorldEvaluator,
  deriveMeaningMade,
  resolveGoalLayerConfig,
} from "./simulation/world/world-evaluator.js";
export type {
  GoalLayerRuntime,
  GoalLayerRuntimeConfig,
  WorldLLMRuntime,
  WorldReview,
} from "./simulation/world/world-evaluator.js";
export { GoalLayerLLMClient } from "./simulation/world/goal-layer-llm.js";
export type {
  GoalLayerLLMClientParams,
  GoalLayerCallInput,
  GoalLayerLLMOutcome,
  GoalLayerLLMResult,
} from "./simulation/world/goal-layer-llm.js";
export type { GoalLayerClientFactory } from "./simulation/world/goal-synthesizer.js";
export { GoalRegistry } from "./simulation/world/goal-registry.js";
export { ChannelRegistry } from "./simulation/channel-registry.js";
export {
  InMemoryEventRepository,
  InMemoryAgentStateRepository,
  InMemorySimulationRepository,
  InMemoryChannelRepository,
  InMemoryMemoryRepository,
} from "./simulation/in-memory-stores.js";
export type { InMemoryEventRepositoryOptions } from "./simulation/in-memory-stores.js";

// Dev3 - Config composition root (used by eval harness and CLI)
export {
  buildConfiguredSimulation,
  parseSimulationConfig,
  findDefaultSimulationConfigPath,
  loadSimulationConfig,
  DEFAULT_SIMULATION_CONFIG_FILENAME,
  inflatePersonaConfig,
} from "./config/simulation-config.js";
export {
  parseJudgeConfig,
  loadJudgeConfig,
  loadJudgeSectionFromSimulationConfig,
} from "./config/judge-config.js";
export { getJudgeConfigPath } from "./cli/config-path.js";
export type {
  SimulationAppConfig,
  AgentConfig,
  ConfiguredSimulationHandle,
  BuildConfiguredSimulationOptions,
  ConfigPersona,
} from "./config/simulation-config.js";
