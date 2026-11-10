import { readFileSync, statSync } from "node:fs";
import { parseSlimKb } from "@perfectman/shared";
import type { SlimKb } from "@perfectman/shared";

/**
 * Where the server finds the slim reference file (packages/kb README, "Slim artifact"). The path comes from `PERFECTMAN_KB_SLIM` and is optional:
 * unset, empty, missing, unreadable or not the format all mean "no KB", and nothing that reads this changes by a byte. A bad file is said once
 * (per path, size and mtime), never thrown: scene writing must not depend on a file an operator may or may not have shipped.
 *
 * Light on purpose (`node:fs` and shared only): the hotel entry (`hotel.ts`) re-exports it and must not load a heavy dependency.
 */
export const KB_SLIM_ENV = "PERFECTMAN_KB_SLIM";
/**
 * The runtime beat feed (style lines in an actor's prompt) has its own switch, off unless it is exactly `1`, whatever `PERFECTMAN_KB_SLIM`
 * says: the draft prompt's reference scenes follow the slim file alone, and an actor's prompt follows this flag and the file together.
 */
export const KB_CRAFT_ENV = "PERFECTMAN_KB_CRAFT";

export function beatCraftEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[KB_CRAFT_ENV]?.trim() === "1";
}

type Cached = { key: string; kb: SlimKb | undefined };
let cached: Cached | undefined;

export type SlimLoadOptions = { env?: NodeJS.ProcessEnv; warn?: (message: string) => void };

/** The slim KB the environment points at, or undefined. Cached by path, size and mtime, so a file replaced on disk is read again. */
export function loadSlimKbFromEnv(opts: SlimLoadOptions = {}): SlimKb | undefined {
  const file = (opts.env ?? process.env)[KB_SLIM_ENV]?.trim();
  if (file === undefined || file === "") return undefined;
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  let key: string;
  try {
    const stat = statSync(file);
    key = `${file}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    key = `${file}|missing`;
  }
  if (cached?.key === key) return cached.kb;
  const kb = readSlimKb(file, key.endsWith("|missing"), warn);
  cached = { key, kb };
  return kb;
}

function readSlimKb(file: string, missing: boolean, warn: (message: string) => void): SlimKb | undefined {
  if (missing) {
    warn(`${KB_SLIM_ENV} points at ${file}, which cannot be read: the reference KB is off`);
    return undefined;
  }
  try {
    const parsed = parseSlimKb(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.ok) {
      warn(`${KB_SLIM_ENV} ${file} is not usable (${parsed.error}): the reference KB is off`);
      return undefined;
    }
    if (parsed.dropped > 0) warn(`${KB_SLIM_ENV} ${file}: ${parsed.dropped} beats did not fit the format and were left out`);
    return parsed.kb.beats.length > 0 ? parsed.kb : undefined;
  } catch (error) {
    warn(`${KB_SLIM_ENV} ${file} could not be read (${error instanceof Error ? error.message : "unreadable"}): the reference KB is off`);
    return undefined;
  }
}

/** For tests: forget what was read. */
export function resetSlimKbCache(): void {
  cached = undefined;
}
