#!/usr/bin/env node
import { ConfigError, parseConfig } from "./config.js";
import { startSidecar } from "./sidecar.js";
import { consoleLogger } from "./util/log.js";

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const sidecar = await startSidecar(config);
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    consoleLogger.info("shutting down", { signal });
    // Compose grants 20 s; run teardown is bounded to 10 s.
    sidecar.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) console.error(err.message);
  else console.error(err);
  process.exit(1);
});
