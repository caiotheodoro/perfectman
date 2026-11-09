import type { ModelPrice } from "../config.js";

export type PromptStyle = "full" | "compact";

/** A window this small cannot hold the full hotel prompt (about 4.6K real tokens) and gets the compact one. */
export const COMPACT_WINDOW_TOKENS = 4096;

/**
 * One link of the LLM provider chain (docs/plans/hotel-llm-chain.md). Parsed from
 * `PERFECTMAN_LLM_CHAIN`, a JSON array; the first link is the default model and
 * the rest are failovers, in order.
 */
export type LlmLink = {
  /** Unique label: logs, per-link usage, breaker and governor state. */
  name: string;
  baseUrl: string;
  /** The NAME of the env var holding this link's key (never the key). */
  apiKeyEnv: string;
  model: string;
  /** The model's context window. Absent means "large enough": the link never rejects a prompt for size. */
  maxContextTokens?: number;
  /** Header that carries the run id (OpenCode Go requires `x-opencode-session`). */
  sessionHeader?: string;
  /** Extra static headers. Never credentials: the key comes from `apiKeyEnv`. */
  headers?: Record<string, string>;
  /** Per-attempt deadline; defaults to {@link DEFAULT_LINK_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Real tokens per token the prompt builder counts (it counts chars/4). Above 1 for tokenizers
   * that split pt-BR finer; the input budget shrinks by it. Defaults to the measured value for
   * known models, else 1.
   */
  tokenRatio?: number;
  /**
   * Which hotel prompt this link is sent: "compact" (terse persona card, top memories, near-only body
   * block, short event window) or "full". Absent means by window: compact for 4096 tokens or less.
   */
  promptStyle?: PromptStyle;
  /**
   * Extra fields merged into this link's request body (a reasoning switch, for a model that thinks
   * before it answers: `{"thinking":{"type":"disabled"}}`). Set by the code that builds the link (the
   * picked model's reasoning switch) or read from the link's `extraBody` in `PERFECTMAN_LLM_CHAIN`, a
   * plain JSON object that may not set a field in {@link RESERVED_EXTRA_BODY_KEYS}. The link's own
   * replaces the base config's, and the sampling fields (`frequencyPenalty`, `presencePenalty`) go on top.
   */
  extraBody?: Record<string, unknown>;
  /**
   * OpenAI-style decoding penalties sent with every call to this link, in -2..2 (0 sends none). They make a token the
   * model already used less likely (frequency, by how often; presence, at all), which is what keeps a small model from
   * giving the same sentence turn after turn. Absent means the model's entry in {@link KNOWN_SAMPLING}, else none.
   * A retry of a near-duplicate adds {@link RETRY_PENALTY_BOOST} on top.
   */
  frequencyPenalty?: number;
  presencePenalty?: number;
  /** Append the house rules (short in-world rules against echoing, admitting, leaking) to the system prompt. Default true. */
  harden?: boolean;
};

/** The model's answer is capped here; the rest of the window is the prompt's. */
export const LINK_MAX_OUTPUT_TOKENS = 400;
/**
 * The prompt builder counts chars/4. A real tokenizer disagrees (more so on pt-BR),
 * so a link only gets this share of the window left over after the answer.
 * 4096 -> (4096 - 400) * 0.92 = 3400.
 */
export const LINK_INPUT_SAFETY = 0.92;
/** Prompt cap when the link does not say how big its window is (the legacy default). */
export const DEFAULT_MAX_INPUT_TOKENS = 6000;
export const DEFAULT_LINK_TIMEOUT_MS = 5000;

/** The prompt style a link is sent: its own setting, else by window size (compact at 4K or less). */
export function linkPromptStyle(link: Pick<LlmLink, "maxContextTokens" | "promptStyle">): PromptStyle {
  if (link.promptStyle !== undefined) return link.promptStyle;
  return link.maxContextTokens !== undefined && link.maxContextTokens <= COMPACT_WINDOW_TOKENS ? "compact" : "full";
}

/** What a link may be sent, in the prompt builder's own (chars/4) token unit. */
export function linkInputBudget(link: Pick<LlmLink, "maxContextTokens" | "tokenRatio">, maxOutputTokens = LINK_MAX_OUTPUT_TOKENS): number {
  if (link.maxContextTokens === undefined) return DEFAULT_MAX_INPUT_TOKENS;
  return Math.max(256, Math.floor(((link.maxContextTokens - maxOutputTokens) * LINK_INPUT_SAFETY) / (link.tokenRatio ?? 1)));
}

/**
 * Real prompt tokens over the builder's chars/4 estimate, measured on the pt-BR hotel prompt
 * (docs/plans/hotel-llm-chain.md): MythoMax's Llama-2 tokenizer 1.25, Lunaris's Llama-3 one 1.07
 * (rounded up). A model missing here counts 1.
 */
export const KNOWN_TOKEN_RATIOS: Readonly<Record<string, number>> = {
  "gryphe/mythomax-l2-13b": 1.25,
  "sao10k/l3-lunaris-8b": 1.1,
};

/**
 * Known prices in USD per million tokens. A model missing here costs 0 in the
 * meter, and an enabled sidecar refuses to start with one; `PERFECTMAN_LLM_PRICES`
 * overrides any entry. A flat-subscription link (OpenCode Go) must declare 0/0 there
 * explicitly, so a forgotten price is never mistaken for a free model.
 */
export const KNOWN_PRICES: Readonly<Record<string, ModelPrice>> = {
  "gryphe/mythomax-l2-13b": { inUsdPerMTok: 0.08, outUsdPerMTok: 0.11 },
  "sao10k/l3-lunaris-8b": { inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 },
};

/** Decoding penalties that measured as cutting repetition without hurting the JSON (docs/plans/hotel-llm-chain.md, fourth pass). */
export const KNOWN_SAMPLING: Readonly<Record<string, { frequencyPenalty: number; presencePenalty: number }>> = {
  "gryphe/mythomax-l2-13b": { frequencyPenalty: 0.5, presencePenalty: 0.5 },
  "sao10k/l3-lunaris-8b": { frequencyPenalty: 0.5, presencePenalty: 0.5 },
};
/** Added to both penalties on the retry of a near-duplicate, on top of the link's own, capped at 2. */
export const RETRY_PENALTY_BOOST = 0.4;

/** Added to the temperature on the retry of a near-duplicate, up to {@link RETRY_TEMPERATURE_MAX}: the same sampling gave the same sentence. */
export const RETRY_TEMPERATURE_BOOST = 0.25;
export const RETRY_TEMPERATURE_MAX = 1.1;

/**
 * The penalties a call to this link carries; `retry` is the regeneration of a near-duplicate. A penalty the link sets to 0
 * is off, retry included; one it does not set takes the model's {@link KNOWN_SAMPLING} entry, else none.
 */
export function linkSampling(link: Pick<LlmLink, "model" | "frequencyPenalty" | "presencePenalty">, retry: boolean): Record<string, number> {
  const known = KNOWN_SAMPLING[link.model];
  const one = (own: number | undefined, fallback: number | undefined): number | undefined => {
    const base = own ?? fallback;
    if (base === undefined || base === 0) return undefined;
    return Math.round(Math.max(-2, Math.min(2, base + (retry ? RETRY_PENALTY_BOOST : 0))) * 100) / 100;
  };
  const frequency = one(link.frequencyPenalty, known?.frequencyPenalty);
  const presence = one(link.presencePenalty, known?.presencePenalty);
  return { ...(frequency !== undefined ? { frequency_penalty: frequency } : {}), ...(presence !== undefined ? { presence_penalty: presence } : {}) };
}

/**
 * Request-body fields a link's `extraBody` may not set. The first group is what the request builder
 * (`buildOpenAiCompatibleRequestBody` and the AI SDK chat model under it) writes itself, so an extra
 * would swap the model, the prompt, the answer cap or the decode grammar from under the runtime;
 * the penalties belong to `frequencyPenalty`/`presencePenalty`, which the retry logic adjusts.
 */
export const RESERVED_EXTRA_BODY_KEYS: readonly string[] = [
  "model",
  "messages",
  "stream",
  "stream_options",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "tools",
  "tool_choice",
  "functions",
  "function_call",
  "n",
  "response_format",
  "frequency_penalty",
  "presence_penalty",
];

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const FORBIDDEN_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "content-type", "content-length", "host"]);

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Parses and validates `PERFECTMAN_LLM_CHAIN`. Every problem is pushed (not
 * thrown) so the config loader can name them all at once. Returns `[]` on any
 * problem: a half-parsed chain would run a different model than the operator wrote.
 */
export function parseChain(raw: string, problems: string[]): LlmLink[] {
  const before = problems.length;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    problems.push(`PERFECTMAN_LLM_CHAIN is not valid JSON: ${(err as Error).message}`);
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    problems.push("PERFECTMAN_LLM_CHAIN must be a non-empty JSON array");
    return [];
  }
  const links: LlmLink[] = [];
  const names = new Set<string>();
  parsed.forEach((entry, i) => {
    const at = `PERFECTMAN_LLM_CHAIN[${i}]`;
    if (!isRecord(entry)) {
      problems.push(`${at} must be an object`);
      return;
    }
    const str = (key: string): string => {
      const v = entry[key];
      if (typeof v !== "string" || v.trim() === "") {
        problems.push(`${at}.${key} must be a non-empty string`);
        return "";
      }
      return v.trim();
    };
    const name = str("name");
    const baseUrl = str("baseUrl");
    const apiKeyEnv = str("apiKeyEnv");
    const model = str("model");
    if (name && names.has(name)) problems.push(`${at}.name "${name}" is used twice`);
    names.add(name);
    if (baseUrl && !/^https?:\/\//.test(baseUrl)) problems.push(`${at}.baseUrl must be an http(s) URL`);
    if (apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) problems.push(`${at}.apiKeyEnv must be an env var NAME (got a value?)`);

    const link: LlmLink = { name, baseUrl, apiKeyEnv, model };
    const numeric = (key: "maxContextTokens" | "timeoutMs", min: number): void => {
      const v = entry[key];
      if (v === undefined || v === null) return;
      if (typeof v !== "number" || !Number.isInteger(v) || v < min) problems.push(`${at}.${key} must be an integer >= ${min}`);
      else link[key] = v;
    };
    numeric("maxContextTokens", 1024);
    numeric("timeoutMs", 1000);
    const ratio = entry["tokenRatio"];
    if (ratio !== undefined && ratio !== null) {
      if (typeof ratio !== "number" || !(ratio >= 0.5 && ratio <= 3)) problems.push(`${at}.tokenRatio must be a number between 0.5 and 3`);
      else link.tokenRatio = ratio;
    } else if (KNOWN_TOKEN_RATIOS[model] !== undefined) link.tokenRatio = KNOWN_TOKEN_RATIOS[model];

    for (const key of ["frequencyPenalty", "presencePenalty"] as const) {
      const v = entry[key];
      if (v === undefined || v === null) continue;
      if (typeof v !== "number" || !(v >= -2 && v <= 2)) problems.push(`${at}.${key} must be a number between -2 and 2`);
      else link[key] = v;
    }
    const style = entry["promptStyle"];
    if (style !== undefined && style !== null) {
      if (style !== "full" && style !== "compact") problems.push(`${at}.promptStyle must be "full" or "compact"`);
      else link.promptStyle = style;
    }
    if (entry["harden"] !== undefined && entry["harden"] !== null) {
      if (typeof entry["harden"] !== "boolean") problems.push(`${at}.harden must be true or false`);
      else link.harden = entry["harden"];
    }
    const session = entry["sessionHeader"];
    if (session !== undefined && session !== null) {
      if (typeof session !== "string" || !HEADER_NAME.test(session) || FORBIDDEN_HEADERS.has(session.toLowerCase())) problems.push(`${at}.sessionHeader must be a header name`);
      else link.sessionHeader = session;
    }
    const extra = entry["extraBody"];
    if (extra !== undefined && extra !== null) {
      if (!isRecord(extra)) problems.push(`${at}.extraBody must be a JSON object`);
      else {
        const reserved = Object.keys(extra).filter((k) => RESERVED_EXTRA_BODY_KEYS.includes(k));
        for (const k of reserved) problems.push(`${at}.extraBody.${k} is set by the runtime and cannot be overridden`);
        // The SDK builds its own reasoning_effort after the extras, so only the camelCase option reaches the wire.
        const dropped = "reasoning_effort" in extra;
        if (dropped) problems.push(`${at}.extraBody.reasoning_effort is dropped by the transport; write "reasoningEffort"`);
        if (reserved.length === 0 && !dropped) link.extraBody = extra;
      }
    }
    const headers = entry["headers"];
    if (headers !== undefined && headers !== null) {
      if (!isRecord(headers)) problems.push(`${at}.headers must be an object of strings`);
      else {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(headers)) {
          if (typeof v !== "string" || !HEADER_NAME.test(k)) problems.push(`${at}.headers.${k} must be a string value under a valid header name`);
          else if (FORBIDDEN_HEADERS.has(k.toLowerCase())) problems.push(`${at}.headers.${k} is not allowed (keys come from apiKeyEnv)`);
          else out[k] = v;
        }
        link.headers = out;
      }
    }
    links.push(link);
  });
  return problems.length > before ? [] : links;
}

/** The single link the legacy `PERFECTMAN_LLM_*` variables describe. */
export function legacyLink(baseUrl: string, apiKeyEnv: string, model: string): LlmLink {
  return { name: "default", baseUrl, apiKeyEnv, model };
}

/** OpenRouter asks for attribution headers; they never override what a link set itself. */
export function defaultHeadersFor(baseUrl: string): Record<string, string> {
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return {};
  }
  if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) return { "HTTP-Referer": "https://habbo.avenza.cloud", "X-Title": "CMB" };
  return {};
}

/** The headers a call to this link carries besides authorization: defaults, the link's own, and the run id. */
export function linkHeaders(link: LlmLink, sessionId: string | number): Record<string, string> {
  return {
    ...defaultHeadersFor(link.baseUrl),
    ...link.headers,
    ...(link.sessionHeader ? { [link.sessionHeader]: String(sessionId) } : {}),
  };
}
