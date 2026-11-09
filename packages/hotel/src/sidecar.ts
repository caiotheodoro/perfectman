import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { AuthoringServer } from "./authoring/authoring-server.js";
import { AuthoringService } from "./authoring/authoring-service.js";
import { systemClock } from "./clock/clock.js";
import type { Clock } from "./clock/clock.js";
import type { HotelConfig } from "./config.js";
import type { NarratorLlm } from "./director/cine/index.js";
import { HotelHttpClient } from "./director/http-client.js";
import type { FetchLike } from "./director/http-client.js";
import { nodeSocketFactory } from "./director/transport.js";
import type { SocketFactory } from "./director/transport.js";
import { startHealth } from "./health.js";
import type { DramaFrameSink } from "./run/drama-frame-sink.js";
import { RunManager } from "./run/run-manager.js";
import type { RunTiming } from "./run/run.js";
import { consoleLogger } from "./util/log.js";
import type { Logger } from "./util/log.js";

export type SidecarOptions = {
  clock?: Clock;
  rng?: () => number;
  logger?: Logger;
  socketFactory?: SocketFactory;
  fetchImpl?: FetchLike;
  timing?: RunTiming;
  statusIntervalMs?: number;
  /** Overrides the narrator's model call (D19); without it each cinematic run builds its own from the provider chain. */
  narratorLlm?: NarratorLlm;
  /** Where the drama frames go (act-contract.md 11.2); without one they are read and dropped. */
  dramaSink?: DramaFrameSink;
};

export type Sidecar = {
  manager: RunManager | undefined;
  authoringPort: number | undefined;
  healthPort: number;
  close(): Promise<void>;
};

/** SHA-256 of the vendored schema, sent in `hello_ack` so the hotel can warn on drift. */
function schemaSha(): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(new URL("../schema/director.schema.json", import.meta.url))).digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * Startup (hotel-package.md 4): health and the authoring listener first, then
 * the Director connection. Authoring works without a Director connection; run
 * starts do not. Disabled (`PERFECTMAN_ENABLED=0`): health only, no connection,
 * nothing started (D35).
 */
export async function startSidecar(config: HotelConfig, o: SidecarOptions = {}): Promise<Sidecar> {
  const clock = o.clock ?? systemClock;
  const logger = o.logger ?? consoleLogger;
  const rng = o.rng ?? Math.random;
  let manager: RunManager | undefined;
  const health = await startHealth(config.healthPort, () => ({ enabled: config.enabled, connected: manager?.connected ?? false, runs: manager?.runCount ?? 0 }));
  let authoring: AuthoringServer | undefined;
  let authoringPort: number | undefined;

  if (config.enabled) {
    const service = new AuthoringService({ llm: config.llm, apiKey: process.env[config.llm.apiKeyEnv], drama: config.drama === true, ...(process.env["PERFECTMAN_PRESETS_DIR"] ? { presetsRoot: process.env["PERFECTMAN_PRESETS_DIR"] } : {}) });
    authoring = new AuthoringServer({ service, secret: config.secret, host: config.authoringHost, port: config.authoringPort, logger });
    authoringPort = await authoring.listen();
    const http = new HotelHttpClient({ baseUrl: config.internalUrl, secret: config.secret, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) });
    const sha = schemaSha();
    manager = new RunManager({
      config,
      clock,
      rng,
      logger,
      socketFactory: o.socketFactory ?? nodeSocketFactory,
      http,
      sidecar: { version: "0.0.0", build: process.env["PERFECTMAN_BUILD"] ?? "dev", ...(sha ? { schema_sha256: sha } : {}) },
      ...(o.timing ? { timing: o.timing } : {}),
      ...(o.narratorLlm ? { narratorLlm: o.narratorLlm } : {}),
      ...(o.dramaSink ? { dramaSink: o.dramaSink } : {}),
      ...(o.statusIntervalMs !== undefined ? { statusIntervalMs: o.statusIntervalMs } : {}),
    });
    manager.start();
    if (config.dramaWarning) logger.warn(config.dramaWarning);
    logger.info("sidecar started", { authoringPort, directorUrl: config.directorUrl, drama: config.drama === true });
  } else {
    logger.info("PERFECTMAN_ENABLED is off: serving the health check only");
  }

  return {
    manager,
    authoringPort,
    healthPort: health.port,
    async close() {
      await manager?.shutdown();
      await authoring?.close();
      await closeServer(health.server);
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
