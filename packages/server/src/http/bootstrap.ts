/**
 * Entry point for `pnpm --filter @perfectman/server web`.
 *
 * Unlike `cli/run-simulation.ts`, this process outlives any single run, so it
 * installs no signal handler that calls `process.exit` mid-pulse — shutdown
 * goes through the controller's teardown, which drains the in-flight pulse and
 * writes the artifacts first.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../cli/env.js";
import { createWebServer } from "./server.js";
import { defaultRunsRoot } from "./run/run-artifacts.js";

const DEFAULT_PORT = 4317;

async function main(): Promise<void> {
  loadEnvFile();

  // `PORT` is what container hosts set; the perfectman-specific name wins when
  // both are present so a local override still works inside a container.
  const port = Number(process.env["PERFECTMAN_WEB_PORT"] ?? process.env["PORT"] ?? DEFAULT_PORT);
  const runsRoot = process.env["PERFECTMAN_RUNS_DIR"] ?? defaultRunsRoot();
  const staticDir = process.env["PERFECTMAN_WEB_STATIC"] ?? defaultStaticDir();
  const presetsRoot = process.env["PERFECTMAN_PRESETS_DIR"] ?? resolveFromPackage("../../../../examples/presets");

  const web = createWebServer({
    runsRoot,
    presetsRoot,
    ...(existsSync(staticDir) ? { staticDir } : {}),
  });

  const actual = await web.listen(port);
  process.stdout.write(`perfectman web runner on http://localhost:${actual}\n`);
  process.stdout.write(`runs are written to ${runsRoot}\n`);
  if (!existsSync(staticDir)) {
    process.stdout.write(
      "no built UI found — run `pnpm --filter @perfectman/web dev` for the interface\n",
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\nreceived ${signal}, finishing the current pulse before exiting\n`);
    web.controller.stop();
    await web.controller.completion();
    await web.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * Resolved from this file, not `process.cwd()`: `pnpm --filter` runs the script
 * with the package as the working directory, so a cwd-relative path looks for
 * the bundle inside `packages/server/`.
 */
function defaultStaticDir(): string {
  return resolveFromPackage("../../../web/dist");
}

/** dist/http/bootstrap.js -> dist -> packages/server -> packages -> repo root */
function resolveFromPackage(relative: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), relative);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
