import {
  buildConfiguredSimulation,
  loadSimulationConfig,
} from "../config/simulation-config.js";
import { getConfigPath } from "./config-path.js";
import { loadEnvFile } from "./env.js";
import { assertRequiredLLMServicesAvailable } from "./llm-health-check.js";

async function main(): Promise<void> {
  loadEnvFile();
  const configPath = getConfigPath(process.argv.slice(2));
  const config = await loadSimulationConfig(configPath);
  await assertRequiredLLMServicesAvailable(config);
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

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
