import { readFile } from "node:fs/promises";
import {
  JudgeAppConfigSchema,
  type JudgeAppConfig,
} from "@perfectman/shared";
import { findDefaultSimulationConfigPath } from "./simulation-config.js";

export function parseJudgeConfig(input: unknown, path = "judge"): JudgeAppConfig {
  const parsed = JudgeAppConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function loadJudgeConfig(path: string): Promise<JudgeAppConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`Unable to read judge config at ${path}: ${errorMessage(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid judge config JSON at ${path}: ${errorMessage(err)}`,
    );
  }
  try {
    return parseJudgeConfig(parsed, path);
  } catch (err) {
    throw new Error(`Invalid judge config at ${path}: ${errorMessage(err)}`);
  }
}

/**
 * The eval fallback file source: the `judge` section of the walk-up
 * `config/index.json` (the same file that describes the agents). Only the
 * section is read — persona hydration belongs to the simulation runner.
 * Absent config file OR absent section both resolve to undefined so the
 * caller falls through to the env tier.
 */
export async function loadJudgeSectionFromSimulationConfig(
  startDir = process.cwd(),
): Promise<JudgeAppConfig | undefined> {
  let configPath: string;
  try {
    configPath = findDefaultSimulationConfigPath(startDir);
  } catch {
    return undefined;
  }

  const raw = await readFile(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid simulation config JSON at ${configPath}: ${errorMessage(err)}`,
    );
  }
  const root = parsed as Record<string, unknown>;
  if (root["judge"] === undefined) return undefined;
  return parseJudgeConfig(root["judge"], "judge");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}