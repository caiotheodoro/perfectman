/**
 * Endpoints somebody has already got working, and what each one needs.
 *
 * The two settings under "if the model answers with nothing" are the ones
 * people get wrong, and they are not guessable: a reasoning model spends its
 * whole output budget thinking unless told not to, some models run to the token
 * cap inside schema-constrained decoding, and the key that disables reasoning
 * differs per family. Every one of those cost a debugging session to find, so
 * they are recorded here rather than left in the placeholder text.
 *
 * A route never carries a key. That is typed per run, becomes an environment
 * variable for the run's lifetime, and is never written down — which is the
 * whole reason the config stores a variable name instead.
 */
import type { StartRunRequest } from "@perfectman/shared";

export type KnownRoute = {
  id: string;
  label: string;
  note: string;
  llm: Partial<StartRunRequest["llm"]>;
  extraBodyText: string;
};

export const KNOWN_ROUTES: KnownRoute[] = [
  {
    id: "orca-qwen",
    label: "OrcaRouter · Qwen3.5 27B",
    note: "Verified. Needs json_object; no reasoning-disable field.",
    llm: {
      providerType: "openai-compatible",
      modelName: "qwen/qwen3.5-27b",
      baseUrl: "https://api.orcarouter.ai/v1",
      responseFormatJson: true,
      responseFormatJsonSchema: false,
    },
    extraBodyText: "",
  },
  {
    id: "orca-deepseek",
    label: "OrcaRouter · DeepSeek v4 Flash",
    note: "Reasons by default — the extra field switches it off, or nothing parses.",
    llm: {
      providerType: "openai-compatible",
      modelName: "deepseek/deepseek-v4-flash",
      baseUrl: "https://api.orcarouter.ai/v1",
      responseFormatJson: true,
      responseFormatJsonSchema: false,
    },
    extraBodyText: '{ "thinking": { "type": "disabled" } }',
  },
  {
    id: "ollama-local",
    label: "Ollama on this machine",
    note: "Needs the daemon running. No key.",
    llm: {
      providerType: "ollama",
      modelName: "qwen3:8b",
      baseUrl: "http://localhost:11434/v1",
      responseFormatJson: true,
      responseFormatJsonSchema: false,
    },
    extraBodyText: "",
  },
];
