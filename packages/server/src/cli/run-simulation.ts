import {
  DEFAULT_SIMULATION_CONFIG_FILENAME,
  buildConfiguredSimulation,
  findDefaultSimulationConfigPath,
  loadSimulationConfig,
} from "../config/simulation-config.js";

async function main(): Promise<void> {
  const configPath = getConfigPath(process.argv.slice(2));
  const config = await loadSimulationConfig(configPath);
  const handle = await buildConfiguredSimulation(config);

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`received ${signal}, stopping simulation ${handle.simulationId}\n`);
    try {
      await handle.runtime.stop(handle.simulationId);
    } finally {
      await handle.close();
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await handle.runtime.start(handle.simulationId);
  process.stdout.write(`simulation_started ${handle.simulationId}\n`);
}

function getConfigPath(args: string[]): string {
  const configIndex = args.indexOf("--config");
  if (configIndex !== -1) {
    const value = args[configIndex + 1];
    if (!value) throw new Error("--config requires a path");
    return value;
  }

  const shortIndex = args.indexOf("-c");
  if (shortIndex !== -1) {
    const value = args[shortIndex + 1];
    if (!value) throw new Error("-c requires a path");
    return value;
  }

  if (args.length === 0) {
    return findDefaultSimulationConfigPath();
  }

  throw new Error(
    `Usage: pnpm --filter @perfectman/server run simulation -- [--config path/to/config.json]\n` +
      `Default config path: ${DEFAULT_SIMULATION_CONFIG_FILENAME}`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
