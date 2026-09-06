/**
 * `out/runs/<runId>/` — everything needed to look at a run again later.
 *
 * The replay is the artifact that matters: agent thinking and per-pulse emotion
 * are operator events, which are never persisted anywhere, so a replay rebuilt
 * from the database alone would have the transcript and nothing else. It is
 * also a valid input to `pnpm video`, which reads this exact shape.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { SimulationAppConfig } from "../../config/simulation-config.js";
import type { SimulationReplay } from "../../html/replay-types.js";
import type { Diagnostic } from "../../authoring/diagnostics.js";
import { scrubConfigForArtifact } from "./secrets.js";

export type RunManifest = {
  runId: string;
  simulationId: string;
  name: string;
  state: string;
  startedAt: number;
  endedAt?: number;
  pulsesRun: number;
  maxPulses: number;
  stopReason?: string;
  /** True when an in-flight pulse never settled, so the replay may be short. */
  dirty?: boolean;
  counters: { llmFailures: number; gatewayTimeouts: number; framesDropped: number };
  diagnostics: Diagnostic[];
};

export class RunArtifacts {
  readonly dir: string;

  constructor(rootDir: string, readonly runId: string) {
    this.dir = join(rootDir, runId);
  }

  async writeInputs(files: Array<{ filename: string; text: string }>): Promise<void> {
    for (const file of files) {
      // Written before anything else runs, so a run that fails to compile is
      // still reproducible from its own directory.
      await this.write(join("inputs", safeName(file.filename)), file.text);
    }
  }

  async writeConfig(config: SimulationAppConfig): Promise<void> {
    await this.write("config.json", JSON.stringify(scrubConfigForArtifact(config), null, 2));
  }

  async writeReplay(replay: SimulationReplay): Promise<void> {
    await this.write("replay.json", JSON.stringify(replay));
  }

  async writeManifest(manifest: RunManifest): Promise<void> {
    await this.write("run.json", JSON.stringify(manifest, null, 2));
  }

  private async write(relative: string, contents: string): Promise<void> {
    const path = join(this.dir, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

export async function readReplay(rootDir: string, runId: string): Promise<SimulationReplay | null> {
  return readJson<SimulationReplay>(join(rootDir, safeName(runId), "replay.json"));
}

export async function readManifest(rootDir: string, runId: string): Promise<RunManifest | null> {
  return readJson<RunManifest>(join(rootDir, safeName(runId), "run.json"));
}

/** Finished runs, newest first. */
export async function listRuns(rootDir: string): Promise<RunManifest[]> {
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch {
    return [];
  }
  const manifests: RunManifest[] = [];
  for (const entry of entries) {
    const manifest = await readManifest(rootDir, entry);
    if (manifest) manifests.push(manifest);
  }
  return manifests.sort((a, b) => b.startedAt - a.startedAt);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Run ids and uploaded filenames both reach the filesystem, and both come from
 * outside. Collapse anything that could climb out of the run directory.
 */
export function safeName(name: string): string {
  const cleaned = name.replace(/[/\\]/g, "_").replace(/^\.+/, "_");
  return cleaned.length > 0 ? cleaned : "unnamed";
}

/** Resolves the artifact root, defaulting to `out/runs` at the workspace root. */
export function defaultRunsRoot(cwd = process.cwd()): string {
  return resolve(cwd, "out", "runs");
}
