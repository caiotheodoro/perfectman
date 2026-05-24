// Server package entry point — populated by dev1 (agent/llm) and dev2 (socket/simulation)
// Dev3 owns: packages/server/src/persistence/

export { openDatabase, closeDatabase } from "./persistence/sqlite/database.js";
export type { DB } from "./persistence/sqlite/database.js";
export { SqliteEventRepository } from "./persistence/sqlite/event-repository.js";
export { SqliteAgentStateRepository } from "./persistence/sqlite/agent-state-repository.js";
export { SqliteMemoryRepository } from "./persistence/sqlite/memory-repository.js";
export { SqliteSimulationRepository } from "./persistence/sqlite/simulation-repository.js";
export { SqliteChannelRepository } from "./persistence/sqlite/channel-repository.js";
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
export * from "./llm/index.js";
