/**
 * Transport for the drama judge: config from the environment and an adapter
 * from `DramaJudgeProvider` onto the shared `chatCompletion` (the same SDK-backed
 * path the hotel judge and narrator use), with the hotel judge's spend meter.
 *
 * There is no default model: a vision judge that needs a paid key must be chosen
 * on purpose (`DRAMA_JUDGE_MODEL` or `--model`). Keys are read from the
 * environment variables the hotel judge already reads and are never logged.
 */
import { chatCompletion } from "../llm/chat-completion-error.js";
import { DEFAULT_HOTEL_JUDGE_BASE_URL, SpendMeter, extraBodyFor, type CompleteFn } from "../hotel/hotel-judge.js";
import type { DramaJudgeProvider } from "./drama-judge.js";

export type DramaJudgeConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxTokens: number;
  /** Hard spend cap for this process, USD (estimated from the hotel judge's price table). */
  maxUsd: number;
};

/** Rough input size of one contact sheet for the spend estimate (about 1500 tokens at 4 chars per token). */
const IMAGE_CHARS_ESTIMATE = 6000;

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : d;
};

export function loadDramaJudgeConfig(env: NodeJS.ProcessEnv = process.env, overrides: { model?: string } = {}): DramaJudgeConfig {
  const model = overrides.model || env["DRAMA_JUDGE_MODEL"];
  if (!model) throw new Error("no judge model: set DRAMA_JUDGE_MODEL or pass --model");
  const apiKey = env["DRAMA_JUDGE_API_KEY"] || env["HOTEL_JUDGE_API_KEY"] || env["OPENROUTER_API_KEY"] || undefined;
  return {
    baseUrl: env["DRAMA_JUDGE_BASE_URL"] || env["HOTEL_JUDGE_BASE_URL"] || DEFAULT_HOTEL_JUDGE_BASE_URL,
    model,
    ...(apiKey ? { apiKey } : {}),
    timeoutMs: num(env["DRAMA_JUDGE_TIMEOUT_MS"], 120_000),
    maxTokens: num(env["DRAMA_JUDGE_MAX_TOKENS"], 900),
    maxUsd: num(env["DRAMA_JUDGE_MAX_USD"], 1),
  };
}

export type ChatCompletionProviderDeps = { complete?: CompleteFn; meter?: SpendMeter };

export function createChatCompletionProvider(config: DramaJudgeConfig, deps: ChatCompletionProviderDeps = {}): DramaJudgeProvider {
  const complete = deps.complete ?? chatCompletion;
  return {
    model: config.model,
    async complete(request) {
      const inputChars = request.system.length + request.user.length + request.images.length * IMAGE_CHARS_ESTIMATE;
      deps.meter?.reserve(config.model, inputChars, request.maxTokens);
      const reply = await complete({
        baseUrl: config.baseUrl,
        model: config.model,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        label: "drama judge",
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user, images: request.images },
        ],
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        timeoutMs: config.timeoutMs,
        extraBody: extraBodyFor(config.model),
      });
      deps.meter?.record(config.model, inputChars, reply.length);
      return reply;
    },
  };
}
