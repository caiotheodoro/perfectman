import type { AgentRuntimeContext, BuiltPrompt, LLMConfig } from "@perfectman/server/hotel";
import type { AgentRuntimeInput } from "@perfectman/shared";
import type { Clock } from "../clock/clock.js";
import type { ModelPrice } from "../config.js";
import type { NarratorLlm } from "../director/cine/narrator.js";
import type { Logger } from "../util/log.js";
import { LlmChain } from "./chain.js";
import type { MakeProvider } from "./chain.js";
import type { LlmLink } from "./chain-config.js";
import type { LlmGovernor } from "./governor.js";

/** A run asks the narrator for a handful of cards; past this many calls the rest of its cards are fallback text. */
export const NARRATOR_MAX_CALLS = 24;
/** Spend ceiling for one run's narrator, whatever the call count. */
export const NARRATOR_MAX_COST_USD = 0.02;
/** The whole narrator turn, every link it tries included. Short: the film does not wait for it. */
export const NARRATOR_CHAIN_DEADLINE_MS = 8000;
/** One link's attempt. */
export const NARRATOR_LINK_TIMEOUT_MS = 4000;
/** The narrator writes a card and a couple of asides; it never needs more than this, whatever the prompt asks. */
export const NARRATOR_MAX_OUTPUT_TOKENS = 240;
const NARRATOR_TEMPERATURE = 0.7;

export type NarratorLlmOptions = {
  /** The run's links, picked model first (the same list the actors' chain gets). Empty means no model: the mock provider. */
  links: readonly LlmLink[];
  clock: Clock;
  runId: string | number;
  governor: LlmGovernor;
  prices: Readonly<Record<string, ModelPrice>>;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  makeProvider?: MakeProvider;
  maxCalls?: number;
  maxCostUsd?: number;
};

export type RunNarratorLlm = { call: NarratorLlm; chain: LlmChain };

/**
 * The narrator's model call for one run (D19): a second `LlmChain` over the same links the actors use, so the run's
 * picked model is link 1 and the configured chain stays behind it as failover. It is its own chain on purpose: its
 * breakers and spend are not the actors', a dead narrator never trips the run, and the call is plain text (no intent
 * schema, no house rules, no output guards, which are written for an actor's JSON). Calls are capped by count and by
 * cost; past either the call rejects and the narrator falls back to its deterministic text.
 */
export function makeNarratorLlm(o: NarratorLlmOptions): RunNarratorLlm | undefined {
  if (o.links.length === 0) return undefined;
  const chain = new LlmChain({
    links: o.links.map((l) => ({ ...l, harden: false, timeoutMs: Math.min(l.timeoutMs ?? NARRATOR_LINK_TIMEOUT_MS, NARRATOR_LINK_TIMEOUT_MS) })),
    clock: o.clock,
    runId: o.runId,
    simulationId: `hotel-run-${o.runId}-narrator`,
    governor: o.governor,
    prices: o.prices,
    deadlineMs: NARRATOR_CHAIN_DEADLINE_MS,
    guards: false,
    ...(o.logger ? { logger: o.logger } : {}),
    ...(o.env ? { env: o.env } : {}),
    ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    ...(o.makeProvider ? { makeProvider: o.makeProvider } : {}),
  });
  const maxCalls = o.maxCalls ?? NARRATOR_MAX_CALLS;
  const maxCost = o.maxCostUsd ?? NARRATOR_MAX_COST_USD;
  const first = o.links[0]!;
  const base: LLMConfig = {
    providerType: "openai-compatible",
    baseUrl: first.baseUrl,
    apiKeyEnv: first.apiKeyEnv,
    modelName: first.model,
    maxInputTokens: 4000,
    maxOutputTokens: NARRATOR_MAX_OUTPUT_TOKENS,
    temperature: NARRATOR_TEMPERATURE,
    timeoutMs: NARRATOR_LINK_TIMEOUT_MS,
    retryCount: 0,
    // Plain text back: the transport's default is the actor's intent schema.
    responseFormatJson: false,
    responseFormatJsonSchema: false,
  };
  let started = 0;
  const call: NarratorLlm = async (req, signal) => {
    if (signal.aborted) throw new Error("narrator call aborted");
    const spent = chain.snapshot().links.reduce((n, l) => n + l.costUsd, 0);
    if (started >= maxCalls || spent >= maxCost) throw new Error(`narrator budget spent (${started} calls, $${spent.toFixed(4)})`);
    started++;
    const prompt: BuiltPrompt = {
      system: req.system,
      user: req.user,
      inputTokensEstimate: Math.ceil((req.system.length + req.user.length) / 4),
      purpose: "action_intent",
      version: "narrator",
      templateVersion: "narrator-1",
    };
    const result = await chain
      .provider({ ...base, maxOutputTokens: Math.min(req.maxTokens, NARRATOR_MAX_OUTPUT_TOKENS) }, "narrator")
      .generateIntent({} as AgentRuntimeInput, {} as AgentRuntimeContext, prompt);
    return result.content;
  };
  return { call, chain };
}
