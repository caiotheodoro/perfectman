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
  /** The NAME of the env var that holds the key, as `LLMConfig.apiKeyEnv` requires. */
  apiKeyEnv: "PERFECTMAN_LLM_API_KEY";
  /** Allowlist; the first entry is the default (D16, D53). */
  models: string[];
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
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid sidecar configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_AUTHORING_PORT = 9101;
export const DEFAULT_HEALTH_PORT = 9100;

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

export function parseConfig(env: Env = process.env): HotelConfig {
  const problems: string[] = [];
  const enabled = flag(env["PERFECTMAN_ENABLED"], false);
  const provider = env["PERFECTMAN_LLM_PROVIDER"] === "mock" ? "mock" : "openai-compatible";
  const models = (env["PERFECTMAN_LLM_MODELS"] ?? (provider === "mock" ? "mock" : ""))
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const bind = parseBind(env["PERFECTMAN_AUTHORING_BIND"], problems);
  const secret = env["PERFECTMAN_SECRET"] ?? "";
  const directorUrl = env["PERFECTMAN_DIRECTOR_URL"] ?? "";
  const internalUrl = env["PERFECTMAN_INTERNAL_URL"] ?? "";
  const baseUrl = env["PERFECTMAN_LLM_BASE_URL"] ?? "";

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
      apiKeyEnv: "PERFECTMAN_LLM_API_KEY",
      models,
      prices: parsePrices(env["PERFECTMAN_LLM_PRICES"], problems),
      concurrency: int(env, "PERFECTMAN_LLM_CONCURRENCY", 3, problems),
      softCallsPerMin: int(env, "PERFECTMAN_LLM_SOFT_CALLS_PER_MIN", 600, problems),
      softTokensPerHour: int(env, "PERFECTMAN_LLM_SOFT_TOKENS_PER_HOUR", 5_000_000, problems),
    },
    dataDir: env["PERFECTMAN_DATA_DIR"] ?? "/data/perfectman",
    healthPort: int(env, "PERFECTMAN_HEALTH_PORT", DEFAULT_HEALTH_PORT, problems, 0),
  };

  if (enabled) {
    if (secret.length < MIN_SECRET_LENGTH) problems.push(`PERFECTMAN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
    if (!/^wss?:\/\//.test(directorUrl)) problems.push("PERFECTMAN_DIRECTOR_URL must be a ws:// or wss:// URL");
    if (!/^https?:\/\//.test(internalUrl)) problems.push("PERFECTMAN_INTERNAL_URL must be an http:// or https:// URL");
    if (models.length === 0) problems.push("PERFECTMAN_LLM_MODELS must list at least one model");
    if (provider === "openai-compatible") {
      if (!/^https?:\/\//.test(baseUrl)) problems.push("PERFECTMAN_LLM_BASE_URL must be an http(s) URL");
      if (!env["PERFECTMAN_LLM_API_KEY"]) problems.push("PERFECTMAN_LLM_API_KEY is not set");
    }
  }
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
