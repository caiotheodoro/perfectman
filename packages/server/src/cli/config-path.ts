import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import {
  DEFAULT_SIMULATION_CONFIG_FILENAME,
  findDefaultConfigPath,
} from "../config/simulation-config.js";

const JUDGE_CONFIG_USAGE =
  "Usage: --judge-config path/to/judge.json (or the judge section of config/index.json)\n" +
  `Default config path: ${DEFAULT_SIMULATION_CONFIG_FILENAME}`;

/**
 * Shared resolution for `getConfigPath` / `getJudgeConfigPath`: an explicit
 * flag wins (loud error on a missing value), `defaultFile` provides the
 * walk-up fallback when no other positional args are present, and a missing
 * flag with no default yields `undefined` (the next source tier decides).
 */
function resolveConfigPath(
  args: string[],
  options: {
    flag: string;
    shortFlag?: string;
    defaultFile?: string;
    requiredWhenArgsPresent: boolean;
    usage: string;
  },
  startDir: string,
): string | undefined {
  for (const flag of options.shortFlag ? [options.flag, options.shortFlag] : [options.flag]) {
    const flagIndex = args.indexOf(flag);
    if (flagIndex !== -1) {
      const value = args[flagIndex + 1];
      if (!value) throw new Error(`${flag} requires a path`);
      return resolveExplicitConfigPath(value, startDir);
    }
  }

  if (args.length === 0 && options.defaultFile !== undefined) {
    return findDefaultConfigPath(options.defaultFile, startDir);
  }
  if (options.requiredWhenArgsPresent) {
    throw new Error(options.usage);
  }
  return undefined;
}

export function getConfigPath(
  args: string[],
  startDir = process.cwd(),
): string {
  return resolveConfigPath(
    args,
    {
      flag: "--config",
      shortFlag: "-c",
      defaultFile: DEFAULT_SIMULATION_CONFIG_FILENAME,
      requiredWhenArgsPresent: true,
      usage:
        `Usage: pnpm --filter @perfectman/server run simulation -- [--config path/to/config.json]\n` +
        `Default config path: ${DEFAULT_SIMULATION_CONFIG_FILENAME}`,
    },
    startDir,
  )!;
}

/** `--judge-config <path>`; absent → undefined (the config section / env tiers decide). */
export function getJudgeConfigPath(
  args: string[],
  startDir = process.cwd(),
): string | undefined {
  return resolveConfigPath(
    args,
    {
      flag: "--judge-config",
      requiredWhenArgsPresent: false,
      usage: JUDGE_CONFIG_USAGE,
    },
    startDir,
  );
}

export function resolveExplicitConfigPath(
  path: string,
  startDir = process.cwd(),
): string {
  if (isAbsolute(path)) return path;

  const direct = resolve(startDir, path);
  if (existsSync(direct)) return direct;

  let current = startDir;
  const root = parse(current).root;

  while (true) {
    const candidate = join(current, path);
    if (existsSync(candidate)) return candidate;
    if (current === root) break;
    current = dirname(current);
  }

  return direct;
}