import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import {
  DEFAULT_SIMULATION_CONFIG_FILENAME,
  findDefaultSimulationConfigPath,
} from "../config/simulation-config.js";

export function getConfigPath(
  args: string[],
  startDir = process.cwd(),
): string {
  const configIndex = args.indexOf("--config");
  if (configIndex !== -1) {
    const value = args[configIndex + 1];
    if (!value) throw new Error("--config requires a path");
    return resolveExplicitConfigPath(value, startDir);
  }

  const shortIndex = args.indexOf("-c");
  if (shortIndex !== -1) {
    const value = args[shortIndex + 1];
    if (!value) throw new Error("-c requires a path");
    return resolveExplicitConfigPath(value, startDir);
  }

  if (args.length === 0) {
    return findDefaultSimulationConfigPath(startDir);
  }

  throw new Error(
    `Usage: pnpm --filter @perfectman/server run simulation -- [--config path/to/config.json]\n` +
      `Default config path: ${DEFAULT_SIMULATION_CONFIG_FILENAME}`,
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
