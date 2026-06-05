/**
 * Shared constants and helpers for all scenario configs.
 * Extracted from 4-persona-scenario.ts so each scenario file stays concise.
 */
import type { SimulationSettings } from "@perfectman/shared";
import type { LlmConfig } from "../../llm/llm-config.js";
import type { ScenarioContextBlock } from "../../agent/persona-prompt-profile.js";
import type { ScenarioConfig } from "../scenario-presets.js";
import { DEFAULT_MOCK_CONFIG } from "../../agent/persona-loader.js";
import { INTRO_BEHAVIOR_INSTRUCTION } from "../scenario-presets.js";

const USE_REAL_LLM = process.env["PERFECTMAN_LLM"] === "qwen3";

const QWEN3_CONFIG: LlmConfig = {
  providerType: "ollama",
  baseUrl: process.env["QWEN3_BASE_URL"] ?? "http://localhost:11434/v1",
  modelName: process.env["QWEN3_MODEL"] ?? "qwen3:8b",
  maxInputTokens: 4096,
  maxOutputTokens: 200,
  temperature: 0.7,
  timeoutMs: 60_000,
  retryCount: 1,
  responseFormatJson: true,
  extraBody: {
    think: false,
    options: { num_ctx: 4096 },
  },
};

export const AGENT_LLM_CONFIG: LlmConfig = USE_REAL_LLM ? QWEN3_CONFIG : DEFAULT_MOCK_CONFIG;

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: true,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 5,
  maxMessagesPerMinutePerAgent: 120,
  llmCallBudgetPerMinute: 400,
  pulseIntervalMs: 100,
  tokenBudgetPerHour: 10_000_000,
};

export function makeScenarioContext(scenario: ScenarioConfig): ScenarioContextBlock {
  return {
    roomContext: scenario.roomContext,
    startingMood: scenario.startingMood,
    introBehaviorInstruction: INTRO_BEHAVIOR_INSTRUCTION[scenario.agentIntroBehavior],
    firstMoveGuidance: scenario.firstMoveGuidance,
    customNotes: scenario.customNotes,
    hostStartingMessage: scenario.hostStartingMessage,
  };
}
