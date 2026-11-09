import { parseDramaEnv } from "./director/dialect.js";
import { KNOWN_PRICES, legacyLink, parseChain } from "./llm/chain-config.js";
import type { LlmLink } from "./llm/chain-config.js";

/**
 * Sidecar configuration from the environment (docs/plans/hotel-package.md 4).
 * Fails fast, naming every problem at once, when the sidecar is enabled and
 * something it cannot run without is missing.
 */
export type ModelPrice = { inUsdPerMTok: number; outUsdPerMTok: number };

export type LlmEnv = {
  /** `mock` is for dev and tests: no URL, no key, no network. */
  provider: "openai-compatible" | "mock";
  baseUrl: string;
  /** The NAME of the env var that holds the first link's key, as `LLMConfig.apiKeyEnv` requires. */
  apiKeyEnv: string;
  /** Allowlist; the first entry is the default (D16, D53). With a chain it is the chain's models, in order. */
  models: string[];
  /**
   * The provider chain, in failover order (`PERFECTMAN_LLM_CHAIN`). Absent or empty means the
   * legacy single link built from `baseUrl`, `apiKeyEnv` and `models[0]`: see `linksOf`.
   */
  chain?: LlmLink[];
  prices: Record<string, ModelPrice>;
  /** Generate concurrency across both pulse lanes; one slot is reserved for addressed replies. */
  concurrency: number;
  softCallsPerMin: number;
  softTokensPerHour: number;
};

export type HotelConfig = {
  enabled: boolean;
  secret: string;
  directorUrl: string;
  internalUrl: string;
  authoringHost: string;
  authoringPort: number;
  maxRuns: number;
  llm: LlmEnv;
  dataDir: string;
  healthPort: number;
  /** In-memory events kept per run; older ones go to the run's `events.jsonl` as they fall out. 0 keeps everything. */
  eventRetention?: number;
  /** `PERFECTMAN_DRAMA` (SAFE-1): the sidecar offers the drama dialect only when this is on. Absent means off. */
  drama?: boolean;
  /** Why `PERFECTMAN_DRAMA` was read as off though it was set (a typo); logged at start. */
  dramaWarning?: string;
};

/** The links a run calls, first = default. Mock has none. */
export function linksOf(llm: LlmEnv): LlmLink[] {
  if (llm.provider === "mock") return [];
  if (llm.chain && llm.chain.length > 0) return llm.chain;
  const model = llm.models[0];
  return model ? [legacyLink(llm.baseUrl, llm.apiKeyEnv, model)] : [];
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid sidecar configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_AUTHORING_PORT = 9101;
export const DEFAULT_HEALTH_PORT = 9100;
export const DEFAULT_EVENT_RETENTION = 5000;

type Env = Readonly<Record<string, string | undefined>>;

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function int(env: Env, name: string, fallback: number, problems: string[], min = 1): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    problems.push(`${name} must be an integer >= ${min} (got "${raw}")`);
    return fallback;
  }
  return n;
}

function parsePrices(raw: string | undefined, problems: string[]): Record<string, ModelPrice> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    const out: Record<string, ModelPrice> = {};
    for (const [model, value] of Object.entries(parsed)) {
      const price = value as Partial<ModelPrice> | null;
      if (!price || typeof price.inUsdPerMTok !== "number" || typeof price.outUsdPerMTok !== "number") {
        throw new Error(`"${model}" needs inUsdPerMTok and outUsdPerMTok numbers`);
      }
      out[model] = { inUsdPerMTok: price.inUsdPerMTok, outUsdPerMTok: price.outUsdPerMTok };
    }
    return out;
  } catch (err) {
    problems.push(`PERFECTMAN_LLM_PRICES is not valid: ${(err as Error).message}`);
    return {};
  }
}

/** `host:port`, `:port` or `port`; the host defaults to loopback. */
export function parseBind(raw: string | undefined, problems: string[]): { host: string; port: number } {
  const fallback = { host: "127.0.0.1", port: DEFAULT_AUTHORING_PORT };
  if (!raw) return fallback;
  const at = raw.lastIndexOf(":");
  const host = at > 0 ? raw.slice(0, at) : at === 0 ? "127.0.0.1" : fallback.host;
  const port = Number(at >= 0 ? raw.slice(at + 1) : raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    problems.push(`PERFECTMAN_AUTHORING_BIND must be host:port (got "${raw}")`);
    return fallback;
  }
  return { host, port };
}

function knownPrices(chain: readonly LlmLink[]): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  for (const link of chain) {
    const price = KNOWN_PRICES[link.model];
    if (price) out[link.model] = price;
  }
  return out;
}

export function parseConfig(env: Env = process.env): HotelConfig {
  const problems: string[] = [];
  const enabled = flag(env["PERFECTMAN_ENABLED"], false);
  const provider = env["PERFECTMAN_LLM_PROVIDER"] === "mock" ? "mock" : "openai-compatible";
  const rawChain = provider === "mock" ? "" : (env["PERFECTMAN_LLM_CHAIN"] ?? "").trim();
  // A disabled sidecar never reads its chain: a half-written PERFECTMAN_LLM_CHAIN must not stop a host that does not run it.
  const chain = enabled && rawChain ? parseChain(rawChain, problems) : [];
  // A chain names its own models: they ARE the allowlist, and PERFECTMAN_LLM_MODELS is not consulted.
  const models = (chain.length > 0 ? chain.map((l) => l.model) : (env["PERFECTMAN_LLM_MODELS"] || (provider === "mock" ? "mock" : "")).split(",").map((m) => m.trim()))
    .filter(Boolean);
  const bind = parseBind(env["PERFECTMAN_AUTHORING_BIND"], problems);
  const secret = env["PERFECTMAN_SECRET"] ?? "";
  const directorUrl = env["PERFECTMAN_DIRECTOR_URL"] ?? "";
  const internalUrl = env["PERFECTMAN_INTERNAL_URL"] ?? "";
  const baseUrl = chain[0]?.baseUrl ?? env["PERFECTMAN_LLM_BASE_URL"] ?? "";
  const drama = parseDramaEnv(env["PERFECTMAN_DRAMA"]);

  const config: HotelConfig = {
    enabled,
    secret,
    directorUrl,
    internalUrl,
    authoringHost: bind.host,
    authoringPort: bind.port,
    maxRuns: int(env, "PERFECTMAN_MAX_RUNS", 3, problems),
    llm: {
      provider,
      baseUrl,
      apiKeyEnv: chain[0]?.apiKeyEnv ?? "PERFECTMAN_LLM_API_KEY",
      models,
      ...(chain.length > 0 ? { chain } : {}),
      prices: { ...(chain.length > 0 ? knownPrices(chain) : {}), ...parsePrices(env["PERFECTMAN_LLM_PRICES"], problems) },
      concurrency: int(env, "PERFECTMAN_LLM_CONCURRENCY", 3, problems),
      softCallsPerMin: int(env, "PERFECTMAN_LLM_SOFT_CALLS_PER_MIN", 600, problems),
      softTokensPerHour: int(env, "PERFECTMAN_LLM_SOFT_TOKENS_PER_HOUR", 5_000_000, problems),
    },
    dataDir: env["PERFECTMAN_DATA_DIR"] ?? "/data/perfectman",
    healthPort: int(env, "PERFECTMAN_HEALTH_PORT", DEFAULT_HEALTH_PORT, problems, 0),
    eventRetention: int(env, "PERFECTMAN_EVENT_RETENTION", DEFAULT_EVENT_RETENTION, problems, 0),
    // Off unless set, so a config built without it (or with drama off) is exactly today's.
    ...(drama.on ? { drama: true } : {}),
    ...(drama.warning ? { dramaWarning: drama.warning } : {}),
  };

  if (enabled) {
    if (secret.length < MIN_SECRET_LENGTH) problems.push(`PERFECTMAN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
    if (!/^wss?:\/\//.test(directorUrl)) problems.push("PERFECTMAN_DIRECTOR_URL must be a ws:// or wss:// URL");
    if (!/^https?:\/\//.test(internalUrl)) problems.push("PERFECTMAN_INTERNAL_URL must be an http:// or https:// URL");
    if (models.length === 0) problems.push("PERFECTMAN_LLM_MODELS must list at least one model");
    if (provider === "openai-compatible") {
      // A model with no price would be metered at $0 and the cost cap would never see it. Subscription links declare 0/0.
      const unpriced = chain.length > 0 ? chain.filter((l) => !config.llm.prices[l.model]).map((l) => `link "${l.name}" (model ${l.model})`) : models.filter((m) => !config.llm.prices[m]).map((m) => `model ${m}`);
      for (const what of unpriced) problems.push(`${what} has no price: add it to PERFECTMAN_LLM_PRICES as {"<model>":{"inUsdPerMTok":n,"outUsdPerMTok":n}}; a subscription link must declare 0 explicitly`);
    }
    if (provider === "openai-compatible" && chain.length > 0) {
      for (const link of chain) if (!env[link.apiKeyEnv]) problems.push(`${link.apiKeyEnv} is not set (PERFECTMAN_LLM_CHAIN link "${link.name}")`);
    } else if (provider === "openai-compatible" && !rawChain) {
      if (!/^https?:\/\//.test(baseUrl)) problems.push("PERFECTMAN_LLM_BASE_URL must be an http(s) URL");
      if (!env["PERFECTMAN_LLM_API_KEY"]) problems.push("PERFECTMAN_LLM_API_KEY is not set");
    }
  }
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
