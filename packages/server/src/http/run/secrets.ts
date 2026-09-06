/**
 * Per-run API keys, and keeping them out of everything that gets written down.
 *
 * The config schema takes `apiKeyEnv` — the *name* of an environment variable,
 * never a key — and the judge schema rejects inline `apiKey`/`token` outright.
 * That invariant is worth preserving, so a key pasted into the browser becomes
 * a process env var for the life of the run and the config only ever carries
 * its name.
 */
import type { SimulationAppConfig } from "../../config/simulation-config.js";

/** Env vars this module owns. The prefix is what makes them recognizable to the scrubber. */
const RUN_KEY_PREFIX = "PERFECTMAN_RUN_";

export function runKeyEnvName(runId: string): string {
  return `${RUN_KEY_PREFIX}${runId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_KEY`;
}

/** Sets the key and returns the variable name to put in the config. */
export function setRunKey(runId: string, apiKey: string): string {
  const name = runKeyEnvName(runId);
  process.env[name] = apiKey;
  return name;
}

/** Always call this in teardown's `finally` — a leaked key outlives the run otherwise. */
export function clearRunKey(runId: string): void {
  delete process.env[runKeyEnvName(runId)];
}

/**
 * Redacts anything key-shaped before a config is written to disk.
 *
 * Two layers, because either alone would be a single point of failure: the
 * per-run env var name is rewritten so the artifact does not even hint at how
 * to find the key, and any string value that *looks* like a credential is
 * replaced wherever it appears in the tree — which covers a key that reached
 * the config through a path this module does not know about.
 */
export function scrubConfigForArtifact(config: SimulationAppConfig): SimulationAppConfig {
  return scrubValue(config) as SimulationAppConfig;
}

const REDACTED = "<redacted>";
const PER_RUN_KEY_NOTE = "<per-run key, not persisted>";

/** Shapes common to the providers this repo talks to, plus generic long tokens. */
const KEY_SHAPED = [
  /^sk-[A-Za-z0-9_-]{8,}$/,
  /^Bearer\s+\S+$/i,
  /^gsk_[A-Za-z0-9]{8,}$/,
  /^[A-Za-z0-9_-]{40,}$/,
];

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === "apiKeyEnv" && typeof inner === "string" && inner.startsWith(RUN_KEY_PREFIX)) {
        out[key] = PER_RUN_KEY_NOTE;
        continue;
      }
      // A key should never be here at all — the schema rejects it — but an
      // artifact is the wrong place to find out that something slipped through.
      if (key === "apiKey" || key === "token" || key === "botToken") {
        out[key] = REDACTED;
        continue;
      }
      out[key] = scrubValue(inner);
    }
    return out;
  }
  if (typeof value === "string" && KEY_SHAPED.some((pattern) => pattern.test(value))) {
    return REDACTED;
  }
  return value;
}
