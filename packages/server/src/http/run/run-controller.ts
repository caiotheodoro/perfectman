/**
 * The single live run: compile → validate → health check → build → seed →
 * pulse loop → teardown.
 *
 * One run at a time, deliberately. `better-sqlite3` is synchronous and the
 * scheduler re-reads the whole event log every pulse, so concurrent runs would
 * block each other and the HTTP server with them. A local tool does not need
 * the machinery that would take to fix.
 */
import type {
  LiveChannel,
  LiveEvent,
  RunState,
  RunStatus,
} from "@perfectman/shared";
import { HtmlSnapshotGateway } from "../../delivery/html-snapshot-gateway.js";
import { SseDeliveryGateway } from "../../delivery/sse-delivery-gateway.js";
import { timeboxGateway, type TimeboxCounter } from "../../delivery/timeboxed-gateway.js";
import { messageFromCommitted } from "../../delivery/live-frame-assembly.js";
import { buildConfiguredSimulation } from "../../config/simulation-config.js";
import type { ConfiguredSimulationHandle, SimulationAppConfig } from "../../config/simulation-config.js";
import { assertRequiredLLMServicesAvailable } from "../../cli/llm-health-check.js";
import type { RunSeeds } from "../../authoring/assemble-config.js";
import type { Diagnostic } from "../../authoring/diagnostics.js";
import { SseHub } from "../sse-hub.js";
import { drainInFlight, runPulseLoop, type InFlight } from "./pulse-loop.js";
import { applySeeds } from "./seed-applier.js";
import { RunArtifacts, type RunManifest } from "./run-artifacts.js";
import { clearRunKey } from "./secrets.js";

/** Frames kept for a client that connects just after the run starts. */
const SSE_BACKLOG = 256;
/** How long a gateway may hold up one pulse before it is abandoned. */
const GATEWAY_TIMEOUT_MS = 2_000;
/** How long teardown waits for an in-flight pulse before giving up on it. */
const DRAIN_TIMEOUT_MS = 30_000;

export type StartRunParams = {
  runId: string;
  config: SimulationAppConfig;
  seeds: RunSeeds;
  maxPulses: number;
  wallClockCapMs: number;
  diagnostics: Diagnostic[];
  inputFiles: Array<{ filename: string; text: string }>;
  /** Skipped for the mock provider, which talks to nothing. */
  skipHealthCheck?: boolean;
};

export class RunAlreadyActiveError extends Error {
  constructor() {
    super("A run is already active; stop it before starting another.");
    this.name = "RunAlreadyActiveError";
  }
}

export class RunController {
  private status: RunStatus = idleStatus();
  /**
   * One hub for the controller's life, not one per run: the browser opens its
   * EventSource *after* `POST /api/runs` returns, so a per-run hub would drop
   * every frame published in between — `hello` included. The backlog covers
   * that gap; resetting it is what a new run needs, not a new hub.
   */
  private readonly hub = new SseHub(SSE_BACKLOG);
  private abort = new AbortController();
  private inFlight: InFlight = { current: null };
  private handle: ConfiguredSimulationHandle | null = null;
  private artifacts: RunArtifacts | null = null;
  private finished: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly runsRoot: string) {}

  getStatus(): RunStatus {
    return { ...this.status };
  }

  currentHub(): SseHub {
    return this.hub;
  }

  isActive(): boolean {
    return ACTIVE_STATES.has(this.status.state);
  }

  /** Resolves when the run has fully torn down — the handle tests await. */
  completion(): Promise<void> {
    return this.finished ?? Promise.resolve();
  }

  async start(params: StartRunParams): Promise<RunStatus> {
    if (this.isActive()) throw new RunAlreadyActiveError();

    this.hub.resetBacklog();
    this.abort = new AbortController();
    this.inFlight = { current: null };
    this.stopped = false;
    this.artifacts = new RunArtifacts(this.runsRoot, params.runId);
    this.status = {
      runId: params.runId,
      simulationId: params.config.simulation.id ?? params.runId,
      state: "validating",
      pulseIndex: 0,
      pulsesRun: 0,
      maxPulses: params.maxPulses,
      startedAt: Date.now(),
      counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 },
    };

    // Written first, so a run that fails later is still reproducible from its
    // own directory.
    await this.artifacts.writeInputs(params.inputFiles);
    await this.artifacts.writeConfig(params.config);

    this.finished = this.run(params).catch(() => undefined);
    return this.getStatus();
  }

  /** Idempotent: a second stop, or a stop after the run ended, is a no-op. */
  stop(): RunStatus {
    if (this.isActive() && !this.abort.signal.aborted) {
      this.abort.abort();
      this.setState("stopping");
    }
    return this.getStatus();
  }

  private async run(params: StartRunParams): Promise<void> {
    const gatewayCounter: TimeboxCounter = { timeouts: 0 };
    let replayGateway: HtmlSnapshotGateway | null = null;
    let sseGateway: SseDeliveryGateway | null = null;

    try {
      if (!params.skipHealthCheck) {
        this.setState("health_check");
        // Its errors are already written for a human — surfaced verbatim.
        await assertRequiredLLMServicesAvailable(params.config);
      }

      this.setState("building");
      const handle = await buildConfiguredSimulation(params.config, {
        extraGateways: {
          replay: (meta) => {
            replayGateway = new HtmlSnapshotGateway(meta, `${this.artifacts?.dir}/snapshot.html`);
            return replayGateway;
          },
          web: (meta) => {
            sseGateway = new SseDeliveryGateway(this.hub, meta);
            return timeboxGateway(sseGateway, GATEWAY_TIMEOUT_MS, gatewayCounter);
          },
        },
      });
      this.handle = handle;

      const applied = await applySeeds(handle, params.seeds);
      for (const warning of applied.warnings) {
        this.hub.publish({ type: "notice", data: noticeEvent("seed_warning", warning) });
      }

      this.hub.publish({
        type: "hello",
        data: helloEvent(params, handle, applied.priorEvents.map(messageFromCommitted)),
      });

      this.setState("running");
      const outcome = await runPulseLoop(
        {
          runtime: handle.runtime,
          simulationId: handle.simulationId,
          maxPulses: params.maxPulses,
          wallClockCapMs: params.wallClockCapMs,
          signal: this.abort.signal,
          onPulse: (result) => {
            this.status.pulseIndex = result.pulseIndex;
            this.status.pulsesRun += 1;
            sseGateway?.commitPulse(result);
            this.publishStatus();
          },
        },
        this.inFlight,
      );

      this.status.stopReason = outcome.reason;
      if (outcome.error) {
        this.status.error = { message: outcome.error.message };
      }
      await this.teardown(params, replayGateway, gatewayCounter, outcome.reason === "error" ? "failed" : "done");
    } catch (err) {
      const error = err as Error;
      this.status.error = { message: error.message };
      this.status.stopReason = "error";
      this.hub.publish({ type: "error", data: { type: "error", message: error.message } satisfies LiveEvent });
      await this.teardown(params, replayGateway, gatewayCounter, "failed");
    }
  }

  /**
   * Order matters and is the whole point of this method.
   *
   * `runtime.stop()` clears the scheduler's timer but cannot cancel a pulse
   * already running, and `handle.close()` closes the database without stopping
   * anything. Doing these in the wrong order means events arriving after the
   * artifact is written, or a pulse writing to a closed connection.
   */
  private async teardown(
    params: StartRunParams,
    replayGateway: HtmlSnapshotGateway | null,
    gatewayCounter: TimeboxCounter,
    finalState: RunState,
  ): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.setState("stopping");

    // 1. Let the in-flight pulse finish before touching anything it may write to.
    const drained = await drainInFlight(this.inFlight, DRAIN_TIMEOUT_MS);

    // 2. Stop the runtime. This is what fans `onSimulationStopped` out to the
    //    gateways, which is what makes the snapshot gateway write its file.
    try {
      if (this.handle) await this.handle.runtime.stop(this.handle.simulationId);
    } catch {
      // Already stopped, or never started; neither changes what happens next.
    }

    // 3. Artifacts, from the receiver that has been accumulating all along.
    let replayWritten = false;
    try {
      if (replayGateway && this.artifacts) {
        await this.artifacts.writeReplay(replayGateway.toReplay());
        replayWritten = true;
      }
    } catch (err) {
      this.status.error ??= { message: `Failed to write replay: ${(err as Error).message}` };
    }

    this.status.counters.gatewayTimeouts = gatewayCounter.timeouts;
    this.status.counters.framesDropped = this.hub.droppedTotal();
    this.status.endedAt = Date.now();
    this.setState(finalState);

    await this.artifacts?.writeManifest(this.manifest(params, drained));

    // 4. Tell the clients, now that the replay URL resolves.
    if (replayWritten) {
      this.hub.publish({
        type: "stopped",
        data: {
          type: "stopped",
          ...(this.status.stopReason ? { stopReason: this.status.stopReason } : {}),
          replayUrl: `/api/runs/${params.runId}/replay`,
        } satisfies LiveEvent,
      });
    }
    this.hub.closeAll();

    // 5. The key must not outlive the run.
    clearRunKey(params.runId);

    try {
      await this.handle?.close();
    } catch {
      // Memory persistence has nothing to close.
    }
    this.handle = null;
  }

  private manifest(params: StartRunParams, drained: boolean): RunManifest {
    return {
      runId: params.runId,
      simulationId: this.status.simulationId ?? params.runId,
      name: params.config.simulation.name,
      state: this.status.state,
      startedAt: this.status.startedAt ?? Date.now(),
      ...(this.status.endedAt ? { endedAt: this.status.endedAt } : {}),
      // The count, not `pulseIndex` — a 12-pulse run ends on index 11, and a
      // manifest reading "11 of 12" says the run stopped a pulse short.
      pulsesRun: this.status.pulsesRun,
      maxPulses: params.maxPulses,
      ...(this.status.stopReason ? { stopReason: this.status.stopReason } : {}),
      ...(drained ? {} : { dirty: true }),
      counters: this.status.counters,
      diagnostics: params.diagnostics,
    };
  }

  private setState(state: RunState): void {
    this.status.state = state;
    this.publishStatus();
  }

  private publishStatus(): void {
    this.hub.publish({
      type: "status",
      data: { type: "status", status: this.getStatus() } satisfies LiveEvent,
      coalesceKey: "status",
    });
  }
}

const ACTIVE_STATES = new Set<RunState>([
  "compiling",
  "validating",
  "health_check",
  "building",
  "running",
  "stopping",
]);

function idleStatus(): RunStatus {
  return {
    runId: null,
    simulationId: null,
    state: "idle",
    pulseIndex: 0,
    pulsesRun: 0,
    maxPulses: 0,
    counters: { llmFailures: 0, gatewayTimeouts: 0, framesDropped: 0 },
  };
}

function noticeEvent(type: string, detail: string): LiveEvent {
  return { type: "notice", notice: { type, detail } };
}

function helloEvent(
  params: StartRunParams,
  handle: ConfiguredSimulationHandle,
  priorEvents: ReturnType<typeof messageFromCommitted>[],
): LiveEvent {
  const channels: LiveChannel[] = params.config.channels.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    memberAgentIds: c.memberAgentIds,
  }));
  return {
    type: "hello",
    runId: params.runId,
    simulationId: handle.simulationId,
    simulationName: params.config.simulation.name,
    agents: params.config.agents.map((a) => ({
      id: a.id,
      displayName: a.promptProfile.displayName,
      archetype: a.persona.archetype,
    })),
    channels,
    maxPulses: params.maxPulses,
    priorEvents,
  };
}
