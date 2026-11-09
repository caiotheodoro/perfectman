/**
 * Transport for the drama judge: config from the environment and an adapter
 * from `DramaJudgeProvider` onto the shared `chatCompletion` (the same SDK-backed
 * path the hotel judge and narrator use), with the hotel judge's spend meter.
 *
 * There is no default model: a vision judge that needs a paid key must be chosen
 * on purpose (`DRAMA_JUDGE_MODEL` or `--model`). Keys are read from the
 * environment variables the hotel judge already reads and are never logged.
 */
import { randomBytes } from "node:crypto";
import { chatCompletionDetailed, type ChatCompletionOptions, type ChatCompletionResult } from "../llm/chat-completion-error.js";
import { DEFAULT_HOTEL_JUDGE_BASE_URL, SpendMeter, extraBodyFor } from "../hotel/hotel-judge.js";
import { DEFAULT_DRAMA_JUDGE_MAX_TOKENS, type DramaJudgeCompletion, type DramaJudgeProvider } from "./drama-judge.js";

export type DramaJudgeConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  maxTokens: number;
  /** Static extra request headers (`DRAMA_JUDGE_HEADERS`). Never credentials. Values are never logged. */
  headers?: Record<string, string>;
  /** Name of a header that carries this process's session id (`DRAMA_JUDGE_SESSION_HEADER`, e.g. `x-opencode-session`). */
  sessionHeader?: string;
  /** Hard spend cap for this process, USD (estimated from the hotel judge's price table). */
  maxUsd: number;
};

/** Rough input size of one contact sheet for the spend estimate (about 1500 tokens at 4 chars per token). */
const IMAGE_CHARS_ESTIMATE = 6000;

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : d;
};

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/** Set by the transport or the key; a judge setting may not override them. */
const FORBIDDEN_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "content-type", "content-length", "host"]);

/** Throws naming `variable` and the header name, never a value. */
function checkHeaderName(variable: string, name: string): void {
  if (!HEADER_NAME.test(name)) throw new Error(`${variable}: ${JSON.stringify(name)} is not a valid header name`);
  if (FORBIDDEN_HEADERS.has(name.toLowerCase())) throw new Error(`${variable}: the "${name}" header is not allowed (the key and the body headers are set by the judge itself)`);
}

function parseHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const bad = "DRAMA_JUDGE_HEADERS must be a JSON object of string values, like {\"x-title\": \"perfectman\"}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(bad);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(bad);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    checkHeaderName("DRAMA_JUDGE_HEADERS", name);
    if (typeof value !== "string") throw new Error(`DRAMA_JUDGE_HEADERS: the value of "${name}" must be a string`);
    if (/[\r\n]/.test(value)) throw new Error(`DRAMA_JUDGE_HEADERS: the value of "${name}" has a newline`);
    headers[name] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function parseSessionHeader(raw: string | undefined): string | undefined {
  const name = raw?.trim();
  if (name === undefined || name === "") return undefined;
  checkHeaderName("DRAMA_JUDGE_SESSION_HEADER", name);
  return name;
}

export function loadDramaJudgeConfig(env: NodeJS.ProcessEnv = process.env, overrides: { model?: string } = {}): DramaJudgeConfig {
  const model = overrides.model || env["DRAMA_JUDGE_MODEL"];
  if (!model) throw new Error("no judge model: set DRAMA_JUDGE_MODEL or pass --model");
  const apiKey = env["DRAMA_JUDGE_API_KEY"] || env["HOTEL_JUDGE_API_KEY"] || env["OPENROUTER_API_KEY"] || undefined;
  const headers = parseHeaders(env["DRAMA_JUDGE_HEADERS"]);
  const sessionHeader = parseSessionHeader(env["DRAMA_JUDGE_SESSION_HEADER"]);
  return {
    baseUrl: env["DRAMA_JUDGE_BASE_URL"] || env["HOTEL_JUDGE_BASE_URL"] || DEFAULT_HOTEL_JUDGE_BASE_URL,
    model,
    ...(apiKey ? { apiKey } : {}),
    timeoutMs: num(env["DRAMA_JUDGE_TIMEOUT_MS"], 120_000),
    maxTokens: num(env["DRAMA_JUDGE_MAX_TOKENS"], DEFAULT_DRAMA_JUDGE_MAX_TOKENS),
    ...(headers ? { headers } : {}),
    ...(sessionHeader ? { sessionHeader } : {}),
    maxUsd: num(env["DRAMA_JUDGE_MAX_USD"], 1),
  };
}

export type ChatCompletionProviderDeps = {
  /** Test seam: the transport. Default is the shared SDK-backed chat completion. */
  complete?: (opts: ChatCompletionOptions) => Promise<string | ChatCompletionResult>;
  meter?: SpendMeter;
  /** Test seam: the session id. Default is `pm-judge-<random>`, drawn once per provider. */
  sessionId?: string;
};

export function createChatCompletionProvider(config: DramaJudgeConfig, deps: ChatCompletionProviderDeps = {}): DramaJudgeProvider {
  const complete = deps.complete ?? chatCompletionDetailed;
  // One id for every call of this provider, so one CLI run is one session at the endpoint.
  const headers: Record<string, string> = {
    ...config.headers,
    ...(config.sessionHeader ? { [config.sessionHeader]: deps.sessionId ?? `pm-judge-${randomBytes(6).toString("hex")}` } : {}),
  };
  return {
    model: config.model,
    maxTokens: config.maxTokens,
    async complete(request): Promise<DramaJudgeCompletion> {
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
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });
      const content = typeof reply === "string" ? reply : reply.content;
      deps.meter?.record(config.model, inputChars, content.length);
      return typeof reply === "string" || reply.finishReason === undefined ? content : { content, finishReason: reply.finishReason };
    },
  };
}
