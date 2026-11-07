import type { ActionIntent, AgentState, BodyHandleMap, BodyIntent, CommittedEvent, PairedActAbortedPayload, RoomId, SimulationEvent, SpaceView, SpeechMode } from "@perfectman/shared";
import {
  AgentRuntime,
  MockLLMProvider,
  applySeeds,
  buildConfiguredSimulation,
  createLLMProvider,
  scrubConfigForArtifact,
} from "@perfectman/server/hotel";
import type { AgentCommitInfo, ConfiguredSimulationHandle, HotelSimulationOptions, LLMConfig, LLMProvider, OnConsult, ResolvedBody, SimulationAppConfig } from "@perfectman/server/hotel";
import { join } from "node:path";
import { withMockBody } from "../llm/mock-body.js";
import { WallClockPulseLoop } from "../clock/wall-clock-pulse-loop.js";
import type { Clock, TimerHandle } from "../clock/clock.js";
import { sleepOn } from "../clock/clock.js";
import { linksOf } from "../config.js";
import type { HotelConfig } from "../config.js";
import type { HotelFrame, PauseCause, RunMode, RunState, SidecarEndReason, SidecarMsg } from "../director/index.js";
import { BodyExecutor } from "../embodiment/body-executor.js";
import type { PairInfo } from "../embodiment/body-executor.js";
import { chooseSpeechMode, plan, updateMemory } from "../embodiment/plan.js";
import { pickTile } from "../embodiment/tiles.js";
import type { PlannedCommand, PlannerMemory } from "../embodiment/types.js";
import { HotelGateway } from "../gateway/hotel-gateway.js";
import type { CastEntry, GatewayTiming } from "../gateway/hotel-gateway.js";
import { GuestIngestor } from "../ingest/guest-ingestor.js";
import { BreakerDriver } from "../llm/breaker.js";
import { COST_HEADER, LlmChain } from "../llm/chain.js";
import { GENERATE_DEADLINE_MS, hostLlmConfig, pingLlm } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";
import { LlmMeter } from "../llm/meter.js";
import { tileKey } from "../space/geometry.js";
import type { HotelSpaceMirror } from "../space/space-mirror.js";
import type { Logger } from "../util/log.js";
import { bodyDigest } from "../authoring/authoring-service.js";
import { NdjsonEventSink, writeRunArtifacts } from "./artifacts.js";
import type { WrittenArtifacts } from "./artifacts.js";
import { FrameLogRecorder } from "./frame-log.js";
import { createRuntimePort } from "./runtime-port.js";
import type { RuntimePort } from "./runtime-port.js";
import { HOST_MODEL_PLACEHOLDER, parseScenarioBody } from "./scenario-body.js";
import type { ScenarioBody } from "./scenario-body.js";

export type RunStartParams = {
  run: number;
  lease: number;
  mode: RunMode;
  room: number;
  scenarioVersion: number;
  admin: { id: number; name: string };
  capActors: number;
};

/** What a run needs from the connection (implemented by the manager). */
export interface RunLink {
  send(msg: SidecarMsg): boolean;
  readonly connected: boolean;
  nextCid(run: number): number;
  leaseOf(run: number): number | undefined;
  trackRun(run: number): void;
  untrackRun(run: number): void;
  subscribe(room: RoomId, resnapshot?: boolean): void;
  /** Resolves when the room's snapshot has been applied. */
  waitForRoom(room: RoomId, timeoutMs: number): Promise<boolean>;
  /** Resolves with the hotel's answer to a spawn `cid`. */
  expectCid(cid: number, timeoutMs: number): Promise<HotelFrame>;
  fetchScenarioVersion(id: number): Promise<unknown>;
  registerArtifacts(run: number, artifacts: WrittenArtifacts): Promise<void>;
}

export type RunTiming = {
  baseIntervalMs?: number;
  coalesceMs?: number;
  gateway?: Partial<GatewayTiming>;
  spawnIntervalMs?: number;
  spawnTimeoutMs?: number;
  walkOutTimeoutMs?: number;
  /** Sidecar-side drain bound for an in-flight pulse. */
  drainTimeoutMs?: number;
  /** First half-open delay of the LLM breaker; 15 s in production. */
  breakerInitialBackoffMs?: number;
};

export type RunDeps = {
  hotel: HotelConfig;
  clock: Clock;
  rng: () => number;
  logger: Logger;
  mirror: HotelSpaceMirror;
  link: RunLink;
  governor: LlmGovernor;
  timing?: RunTiming;
  onEnded(run: Run, reason: SidecarEndReason): void;
};

export type PrepareResult = { ok: true } | { ok: false; code: string; message: string };

type PendingSpeech = { intent: ActionIntent; walkPlans: Set<string>; timer: TimerHandle };

const SPAWN_DEFAULTS = { spawnIntervalMs: 200, spawnTimeoutMs: 5000, walkOutTimeoutMs: 10_000 } as const;

/**
 * One hotel run: a built simulation, its gateway and body, and the lifecycle of
 * hotel-package.md 6. The hotel is the authority on state; this is the
 * sidecar's view, reported in `run_status`.
 */
export class Run {
  state: RunState = "starting";
  pauseCause: PauseCause | undefined;
  readonly home: RoomId;
  readonly id: number;

  private body!: ScenarioBody;
  private hostLlm!: LLMConfig;
  private handle: ConfiguredSimulationHandle | undefined;
  private port!: RuntimePort;
  private gateway!: HotelGateway;
  private executor!: BodyExecutor;
  private ingestor!: GuestIngestor;
  private loop!: WallClockPulseLoop;
  private breaker!: BreakerDriver;
  private unsubscribeBudget: (() => void) | undefined;
  private readonly meter: LlmMeter;
  /** The provider chain (failover, per-link breakers, per-link usage); absent for the mock provider. */
  private readonly chain: LlmChain | undefined;
  private readonly frames: FrameLogRecorder;
  /** Events the in-memory log evicted, streamed to `events.jsonl` so a long run stays complete without growing. */
  private eventSink: NdjsonEventSink | undefined;
  private readonly mockConsults = new Map<string, number>();
  private readonly agents = new Map<string, { name: string; spawned: boolean; gone: boolean }>();
  private readonly memory = new Map<string, PlannerMemory>();
  private readonly arousal = new Map<string, number>();
  private readonly noOpStreak = new Map<string, number>();
  /** Actors the planner already ran for during the current pulse (the idle sweep skips them). */
  private readonly plannedThisPulse = new Set<string>();
  /** Lines held back until their speaker reaches the addressee (`move_then_speak`), by agent. */
  private readonly pending = new Map<string, PendingSpeech>();
  /** Rooms whose channel (`room:<id>`) the runtime knows. */
  private readonly rooms = new Set<RoomId>();
  /** Room channel changes apply in the order the doors were taken. */
  private roomOps: Promise<void> = Promise.resolve();
  private linkDown = false;
  private goneWaiters = new Set<string>();
  private goneResolve: (() => void) | undefined;
  private stopping: Promise<void> | undefined;
  private startedAt = 0;
  private pulseErrors = 0;
  private drained = true;
  private pendingEnd: SidecarEndReason | undefined;
  readonly homeChannelId: string;

  constructor(readonly params: RunStartParams, private readonly d: RunDeps) {
    this.id = params.run;
    this.home = String(params.room);
    this.homeChannelId = `room:${params.room}`;
    this.meter = new LlmMeter(d.hotel.llm.prices);
    const links = linksOf(d.hotel.llm);
    this.chain = links.length > 0
      ? new LlmChain({ links, clock: d.clock, runId: params.run, simulationId: `hotel-run-${params.run}`, governor: d.governor, prices: d.hotel.llm.prices, logger: d.logger, onCap: (cap) => this.setPromptCap(cap) })
      : undefined;
    this.frames = new FrameLogRecorder(d.clock);
  }

  /** The built simulation; undefined until `launch` has built it. */
  get simulation(): ConfiguredSimulationHandle | undefined {
    return this.handle;
  }

  get agentIds(): string[] {
    return [...this.agents.keys()];
  }

  get actorCount(): number {
    return this.agents.size;
  }

  get frameLog() {
    return this.frames.log;
  }

  /** The run's rooms: home plus every room holding one of its actors. */
  roomsInUse(): RoomId[] {
    const rooms = new Set<RoomId>([this.home]);
    for (const ref of this.agents.keys()) {
      const r = this.d.mirror.roomOfRef(ref);
      if (r) rooms.add(r);
    }
    return [...rooms];
  }

  holdsActorIn(room: RoomId): boolean {
    return [...this.agents.keys()].some((ref) => this.d.mirror.roomOfRef(ref) === room);
  }

  // ---- stage A: validate ------------------------------------------------------

  async prepare(): Promise<PrepareResult> {
    const { hotel, link } = this.d;
    if (this.params.mode !== "default") return { ok: false, code: "unsupported_mode", message: "cinematic runs are not supported yet" };
    let raw: unknown;
    try {
      raw = await link.fetchScenarioVersion(this.params.scenarioVersion);
    } catch (err) {
      return { ok: false, code: "scenario_unavailable", message: (err as Error).message };
    }
    const parsed = parseScenarioBody(extractBody(raw));
    if (!parsed.ok) return { ok: false, code: "bad_scenario", message: parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; ") };
    this.body = parsed.body;
    if (this.body.config.agents.length > this.params.capActors) {
      return { ok: false, code: "actor_limit", message: `scenario has ${this.body.config.agents.length} characters, the cap is ${this.params.capActors}` };
    }
    // A scenario that names a model outside the allowlist is rejected (D16, D53).
    for (const a of this.body.config.agents) {
      const named = a.llm.modelName;
      if (named !== HOST_MODEL_PLACEHOLDER && hotel.llm.provider !== "mock" && !hotel.llm.models.includes(named)) {
        return { ok: false, code: "model_not_allowed", message: `model "${named}" is not in the allowlist` };
      }
    }
    try {
      this.hostLlm = hostLlmConfig(hotel.llm);
    } catch (err) {
      return { ok: false, code: "model_not_allowed", message: (err as Error).message };
    }
    const healthy = await this.pingProvider();
    if (!healthy) return { ok: false, code: "llm_unavailable", message: "the model endpoint did not answer a health check" };
    return { ok: true };
  }

  // ---- stage B: build, spawn, start -------------------------------------------

  async launch(): Promise<void> {
    const { clock, link, mirror, hotel } = this.d;
    const cfg = this.hotelConfig();
    for (const a of cfg.agents) this.agents.set(a.id, { name: a.promptProfile.displayName, spawned: false, gone: false });
    this.startedAt = clock.now();
    link.trackRun(this.id);

    this.executor = new BodyExecutor({
      run: this.id,
      clock,
      rng: this.d.rng,
      mirror,
      lease: () => link.leaseOf(this.id),
      nextCid: () => link.nextCid(this.id),
      send: (m) => link.send(m),
      logger: this.d.logger,
      record: this.frames.record,
      hooks: {
        blocked: (agentId, reasons) => void this.appendBodyEvent("body_blocked", agentId, { reasons: reasons as unknown as never }, false),
        arrived: (agentId, plan, tile, room) => void this.onArrived(agentId, plan.id, tile, room),
        movedRoom: (agentId, from, to) => this.onMovedRoom(agentId, from, to),
        pairAborted: (info) => void this.onPairAborted(info),
        pairOutcome: (info) => void this.onPairOutcome(info),
      },
    });

    const cast = new Map<string, CastEntry>();
    for (const [id, a] of this.agents) cast.set(id, { name: a.name, responseDelayMs: this.body.responseDelays?.[id] ?? [600, 2500] });
    this.gateway = new HotelGateway({
      clock,
      rng: this.d.rng,
      executor: this.executor,
      cast,
      roomOfChannel: (c) => /^room:(\d+)$/.exec(c)?.[1],
      roomOfAgent: (a) => mirror.roomOfRef(a),
      togetherForHuddle: (a, b) => {
        const va = mirror.view(a, clock.now())?.self;
        const vb = mirror.view(b, clock.now())?.self;
        return !!va && !!vb && mirror.roomOfRef(a) === mirror.roomOfRef(b) && Math.max(Math.abs(va.tile[0] - vb.tile[0]), Math.abs(va.tile[1] - vb.tile[1])) <= 2;
      },
      chooseMode: (agentId, content, committed) => this.chooseMode(agentId, content, committed),
      timing: this.d.timing?.gateway ?? {},
      // The scenario's own ending (goal_end_offered) stops the runtime; the run follows it.
      onStopped: (_id, reason) => {
        if (reason === "goal_end_offered" && this.state === "running") void this.stop("completed");
      },
    });

    this.breaker = new BreakerDriver({
      clock,
      simulationId: cfg.simulation.id ?? `hotel-run-${this.id}`,
      ...(this.d.timing?.breakerInitialBackoffMs !== undefined ? { initialBackoffMs: this.d.timing.breakerInitialBackoffMs } : {}),
      probe: () => this.pingProvider(),
      // An admin pause already holds the run: the breaker then does not own it and will not resume it.
      onOpen: () => {
        this.pause("breaker");
        return this.state === "paused" && this.pauseCause === "breaker";
      },
      onClose: (pausedRun) => {
        if (pausedRun) this.resume("breaker");
      },
      notice: (code) => this.notice(code, code === "llm_circuit_open" ? "warn" : "info"),
    });

    const onConsult: OnConsult = (info) => this.gateway.noteConsult(info.agentId, clock.now());
    // The runtime's own hotel mode (ADR-0020 to 0025): split pulse with a reserved focus slot, the
    // room speech arbiter, bounded reads, the mirror as the source of each actor's `SpaceView`, and
    // the planner seam. The LLM budget registers per simulation in warn mode (`budget`), D11.
    const hotelOptions: HotelSimulationOptions = {
      pulseMode: "split",
      generateConcurrency: hotel.llm.concurrency,
      generateDeadlineMs: GENERATE_DEADLINE_MS,
      onConsult,
      arbiter: {},
      spaceMirror: mirror,
      onAgentCommitted: (info) => this.onCommitted(info),
      clock: () => clock.now(),
      budget: { callsPerMinute: hotel.llm.softCallsPerMin, tokensPerHour: hotel.llm.softTokensPerHour },
      ...this.retention(),
    };
    const options = {
      agentRuntimeFactory: (registry: ConstructorParameters<typeof AgentRuntime>[1]) =>
        new AgentRuntime(undefined, registry, (llm: LLMConfig, agentId: string) => this.provider(llm, agentId)),
      extraGateways: { hotel: () => this.gateway, breaker: () => this.breaker.gateway },
      hotel: hotelOptions,
    };
    this.handle = await buildConfiguredSimulation(cfg, options);
    this.port = createRuntimePort(this.handle);
    this.rooms.add(this.home);
    const simulationId = this.handle.simulationId;
    this.unsubscribeBudget = this.handle.budget.onWarning((event) => {
      if (event.simulationId === simulationId) this.notice("llm_budget_warning", "warn");
    });
    this.ingestor = new GuestIngestor({
      mirror,
      clock,
      simulationId,
      names: Object.fromEntries([...this.agents].map(([id, a]) => [id, a.name])),
      homeRoom: this.home,
      channelIdForRoom: (room) => (this.rooms.has(room) ? this.roomChannel(room) : undefined),
      guests: this.port.guests,
      noteHumanLine: (channel, line) => this.port.noteHumanLine(channel, line),
      requestFocused: (ids) => this.requestFocused(ids),
      logger: this.d.logger,
    });
    await applySeeds(this.handle, this.body.seeds);

    this.loop = new WallClockPulseLoop({
      clock,
      rng: this.d.rng,
      runPulse: (o) => this.pulse(o),
      ...(this.d.timing?.baseIntervalMs !== undefined ? { baseIntervalMs: this.d.timing.baseIntervalMs } : {}),
      ...(this.d.timing?.coalesceMs !== undefined ? { coalesceMs: this.d.timing.coalesceMs } : {}),
      ...(this.d.timing?.drainTimeoutMs !== undefined ? { drainTimeoutMs: this.d.timing.drainTimeoutMs } : {}),
      onError: (err, reason) => {
        this.pulseErrors++;
        this.d.logger.error("pulse failed", { run: this.id, reason, error: err instanceof Error ? err.message : String(err) });
        if (this.pulseErrors >= 5) void this.stop("failed", "5 pulses failed in a row");
      },
    });

    link.subscribe(this.home);
    if (!(await link.waitForRoom(this.home, 10_000))) throw new Error("the home room did not sync");
    await this.spawnCast();
    this.enterRoom();
    this.state = "running";
    this.loop.start();
    this.d.logger.info("run running", { run: this.id, actors: this.agents.size });
  }

  /** The config handed to the server: host LLM, in-memory, one room channel, the 6 s pulse. */
  private hotelConfig(): SimulationAppConfig {
    const cfg = this.body.config;
    const def = cfg.channels.find((c) => c.default) ?? cfg.channels.find((c) => c.type === "public_channel") ?? cfg.channels[0];
    const simId = `hotel-run-${this.id}`;
    return {
      ...cfg,
      simulation: {
        ...cfg.simulation,
        id: simId,
        settings: { ...cfg.simulation.settings, pulseIntervalMs: 6000 },
      },
      persistence: { type: "memory" },
      deliveryGateways: [],
      channels: cfg.channels.map((c) => (c === def ? { ...c, id: this.homeChannelId, default: true } : c)),
      agents: cfg.agents.map((a) => ({ ...a, llm: this.hostLlm })),
    };
  }

  /** True when any link of the chain answers (the lone provider when there is no chain). */
  private pingProvider(): Promise<boolean> {
    return this.chain ? this.chain.ping() : pingLlm(this.hostLlm, process.env[this.d.hotel.llm.apiKeyEnv]);
  }

  /** The runtime renders prompts with the config every actor was given (shared by reference), so moving its cap moves the trim. */
  private setPromptCap(cap: number): void {
    if (this.hostLlm) this.hostLlm.maxInputTokens = cap;
  }

  /** Per-link usage, cost and latency, and which link served: the chain's view of this run (empty for the mock provider). */
  llmChain(): LlmChain | undefined {
    return this.chain;
  }

  private provider(llm: LLMConfig, agentId: string): LLMProvider {
    if (this.chain && llm.providerType !== "mock") {
      return this.chain.provider(llm, agentId, {
        onSuccess: (r) => {
          const billed = r.responseHeaders?.[COST_HEADER];
          this.meter.recordSuccess(this.d.hotel.llm.prices[r.model] ? r.model : llm.modelName, r.usage.inputTokens, r.usage.outputTokens, r.latencyMs, billed !== undefined ? Number(billed) : undefined);
        },
        onFailure: () => this.meter.recordFailure(),
      });
    }
    const inner: LLMProvider = llm.providerType === "mock" ? withMockBody(new MockLLMProvider(), this.mockConsults) : createLLMProvider(llm, agentId);
    return this.d.governor.wrap(inner, {
      onSuccess: (r) => {
        this.meter.recordSuccess(this.d.hotel.llm.prices[r.model] ? r.model : llm.modelName, r.usage.inputTokens, r.usage.outputTokens, r.latencyMs);
      },
      // The breaker counts failures from the operator stream, not from here (it also sees a call that threw before the provider).
      onFailure: () => this.meter.recordFailure(),
    });
  }

  private async spawnCast(): Promise<void> {
    const { link, mirror, clock } = this.d;
    const t = { ...SPAWN_DEFAULTS, ...this.d.timing };
    for (const [ref, a] of this.agents) {
      const lease = link.leaseOf(this.id);
      if (lease === undefined) throw new Error("lease lost before spawn");
      const cid = link.nextCid(this.id);
      const look = this.body.looks?.[ref];
      const answer = link.expectCid(cid, t.spawnTimeoutMs);
      link.send({ t: "actor_spawn", cid, run: this.id, lease, ref, name: a.name, figure: look?.figure ?? "", ...(look?.effect ? { effect: look.effect } : {}), room: this.params.room, tile: null });
      const frame = await answer;
      if (frame.t === "actor_error") throw new Error(`spawn of ${a.name} refused: ${frame.code}${frame.detail ? ` (${frame.detail})` : ""}`);
      if (frame.t !== "actor_spawned") throw new Error(`unexpected answer to spawn of ${a.name}: ${frame.t}`);
      mirror.registerActor({ ref, id: frame.actor, run: this.id, name: a.name }, String(frame.room), clock.now());
      a.spawned = true;
      await sleepOn(clock, t.spawnIntervalMs);
    }
  }

  /** Four actors walk in: each to a distinct, uncrowded tile near the middle of the room. */
  private enterRoom(): void {
    const { mirror, clock } = this.d;
    const taken = new Set<string>();
    const cmds = [];
    for (const ref of this.agents.keys()) {
      const view = mirror.view(ref, clock.now());
      const room = view?.room;
      if (!room) continue;
      const centre = room.zones.find((z) => z.kind === "middle")?.center ?? [Math.floor(room.w / 2), Math.floor(room.h / 2)];
      const to = pickTile({ room, self: ref, near: [centre[0], centre[1]], radius: 4, rng: this.d.rng, avoid: taken });
      if (!to) continue;
      taken.add(tileKey(to));
      cmds.push({ agentId: ref, cmd: "walk" as const, to, plan: `${ref}:enter` });
    }
    this.executor.send(cmds);
  }

  // ---- pulses and the body ----------------------------------------------------

  private async pulse(opts: Parameters<RuntimePort["runPulse"]>[0]): Promise<void> {
    if (this.state !== "running") return;
    this.gateway.notePulseStart(this.d.clock.now());
    await this.port.runPulse(opts);
    this.pulseErrors = 0;
    this.frames.snapshot(this.d.mirror);
    // Actors the model was not consulted for still fidget, face the speaker and drift (embodiment.md 7.1).
    if (opts.reason === "base") await this.sweepIdle();
  }

  requestFocused(ids: string[], reason: "human_chat" | "body_arrived" = "human_chat"): void {
    if (this.state === "running" && !this.linkDown) this.loop.requestFocused(ids, reason);
  }

  private chooseMode(agentId: string, content: string, committed: SpeechMode): SpeechMode {
    const mem = this.memory.get(agentId) ?? {};
    const choice = chooseSpeechMode(this.arousal.get(agentId) ?? 0, content, mem, this.d.clock.now(), committed);
    if (choice.mode === "shout") this.memory.set(agentId, { ...mem, lastShoutAt: this.d.clock.now() });
    return choice.mode;
  }

  /**
   * The planner seam (hotel-package.md 7, embodiment.md 7): the runtime calls this
   * right after one actor's intent was resolved and appended, with the validated
   * `body` block and the view it decided from. Nothing here awaits.
   */
  onCommitted(info: AgentCommitInfo): void {
    const ref = info.agentId;
    if (!this.agents.has(ref) || this.state === "stopping" || this.state === "ended") return;
    const mine = info.committedEvents.filter((e) => e.actorId === ref);
    if (mine.some((e) => e.type === "message_sent" || e.type === "reply_sent")) this.noOpStreak.set(ref, 0);
    else if (mine.some((e) => e.type === "no_op_recorded")) this.noOpStreak.set(ref, (this.noOpStreak.get(ref) ?? 0) + 1);
    this.arousal.set(ref, info.agentState.coreMood.arousal);
    const space = info.space ?? this.d.mirror.view(ref, this.d.clock.now());
    if (!space) return;
    const body = info.body;
    const cmds = this.planFor(ref, info.agentState, mine, space, body ? { intent: info.intent, bodyIntent: body.accepted, handles: body.targets as BodyHandleMap } : undefined);
    if (body?.deferral) this.holdSpeech(ref, info.intent, body.deferral, cmds);
  }

  /** Runs the planner for one actor and hands the commands to the executor. */
  private planFor(
    ref: string,
    agentState: AgentState,
    committedEvents: CommittedEvent[],
    space: SpaceView,
    carried?: { intent: ActionIntent; bodyIntent: BodyIntent; handles: BodyHandleMap },
  ): PlannedCommand[] {
    const now = this.d.clock.now();
    this.plannedThisPulse.add(ref);
    const mem = this.memory.get(ref) ?? {};
    const cmds = plan({
      space,
      agentState,
      committedEvents,
      now,
      rng: this.d.rng,
      memory: mem,
      noOpStreak: this.noOpStreak.get(ref) ?? 0,
      ...(carried ?? {}),
    });
    if (cmds.length === 0) return cmds;
    this.memory.set(ref, updateMemory(mem, cmds, now, space.self?.tile ?? [0, 0]));
    this.executor.send(cmds);
    return cmds;
  }

  /** After a base pulse: the automatic body rules for every actor the planner has not run for. */
  private async sweepIdle(): Promise<void> {
    const handle = this.handle;
    const planned = new Set(this.plannedThisPulse);
    this.plannedThisPulse.clear();
    if (!handle) return;
    const now = this.d.clock.now();
    for (const ref of this.agents.keys()) {
      if (planned.has(ref) || this.state !== "running") continue;
      const state: AgentState | null = await handle.repositories.agentStateRepo.get(handle.simulationId, ref);
      const space = this.d.mirror.view(ref, now);
      if (!state || !space) continue;
      this.arousal.set(ref, state.coreMood.arousal);
      this.planFor(ref, state, [], space);
    }
    this.plannedThisPulse.clear();
  }

  // ---- held speech (move_then_speak) ------------------------------------------

  /**
   * The resolver held the line back until the speaker reaches the addressee
   * (`ResolvedBody.deferral`). The hotel keeps it; the walk's arrival releases it
   * through `resolveDeferred`, and a deadline drops it (embodiment.md 6.3).
   */
  private holdSpeech(ref: string, intent: ActionIntent, deferral: NonNullable<ResolvedBody["deferral"]>, cmds: PlannedCommand[]): void {
    this.dropPending(ref);
    const walkPlans = new Set<string>();
    for (const c of cmds) if (c.cmd === "walk" && c.plan) walkPlans.add(c.plan);
    const wait = Math.max(0, deferral.expiresAt - this.d.clock.now());
    const timer = this.d.clock.setTimer(() => void this.expireSpeech(ref, intent.id), wait);
    this.pending.set(ref, { intent, walkPlans, timer });
    // The typing bubble would hang over a walk; it comes back at arrival.
    this.gateway.stopTyping(ref);
  }

  private dropPending(ref: string): PendingSpeech | undefined {
    const held = this.pending.get(ref);
    held?.timer.cancel();
    this.pending.delete(ref);
    return held;
  }

  private async expireSpeech(ref: string, intentId: string): Promise<void> {
    if (this.pending.get(ref)?.intent.id !== intentId) return;
    this.pending.delete(ref);
    await this.appendBodyEvent("body_blocked", ref, { intentId, reasons: [{ code: "not_in_earshot", part: "speech" }] }, false);
  }

  private async releaseSpeech(ref: string): Promise<void> {
    const held = this.dropPending(ref);
    if (!held || this.state === "stopping" || this.state === "ended") return;
    // Typing again, so the line lands after the persona's delay, as any other reply.
    this.gateway.noteConsult(ref, this.d.clock.now());
    try {
      const resolved = await this.port.resolveDeferred(ref, held.intent);
      if (!resolved.committedEvents.some((e) => e.type === "message_sent" || e.type === "reply_sent")) this.gateway.stopTyping(ref);
    } catch (err) {
      this.gateway.stopTyping(ref);
      this.d.logger.warn("deferred line not resolved", { run: this.id, agent: ref, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- doors and arrivals -----------------------------------------------------

  private roomChannel(room: RoomId): string {
    return `room:${room}`;
  }

  /** The actor went through a door: its channel membership and default channel follow (embodiment.md 6.4). */
  private onMovedRoom(agentId: string, from: RoomId, to: RoomId): void {
    this.roomOps = this.roomOps.then(async () => {
      if (this.state === "stopping" || this.state === "ended" || !this.handle) return;
      try {
        if (!this.rooms.has(to)) {
          await this.port.registerRoomChannel({ id: this.roomChannel(to), name: `Room ${to}` });
          this.rooms.add(to);
        }
        if (this.rooms.has(from)) await this.port.removeChannelMember(this.roomChannel(from), agentId);
        await this.port.addChannelMember(this.roomChannel(to), agentId);
        await this.appendBodyEvent("moved_room", agentId, { from, to }, true, this.roomChannel(to));
      } catch (err) {
        this.d.logger.warn("room channel not updated", { run: this.id, agent: agentId, from, to, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  private async onArrived(agentId: string, planId: string, tile: readonly [number, number], room: RoomId): Promise<void> {
    await this.appendBodyEvent("body_arrived", agentId, { planId, room, tile: [tile[0], tile[1]] }, true);
    // A held line is released when the walk that was taking its speaker to the addressee ends.
    if (this.pending.get(agentId)?.walkPlans.has(planId)) {
      await this.releaseSpeech(agentId);
      return;
    }
    // A salient wake: the actor looks around on arrival (reason body_arrived).
    this.requestFocused([agentId], "body_arrived");
  }

  /** Body events are appended through the event log; types the engine does not know yet are tolerated by the repo. */
  private async appendBodyEvent(type: SimulationEvent["type"], agentId: string, payload: SimulationEvent["payload"], visible: boolean, channelId = this.homeChannelId): Promise<void> {
    if (!this.handle || this.state === "ended") return;
    try {
      await this.port.appendEvents([
        {
          simulationId: this.handle.simulationId,
          channelId,
          actorId: agentId,
          type,
          payload,
          pulseIndex: this.port.pulseIndex(),
          sourceEventIds: [],
          emotionalSalience: "low",
          visibility: visible
            ? { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "body" }
            : { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "operator_only" },
        },
      ]);
    } catch (err) {
      this.d.logger.warn("body event not appended", { type, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async onPairAborted(info: PairInfo & { cause: PairedActAbortedPayload["cause"] }): Promise<void> {
    await this.appendBodyEvent("paired_act_aborted", info.agentId, { pairId: info.pair, kind: info.kind, with: info.withRef, cause: info.cause }, true);
  }

  /**
   * D31: a pair act on a human is free, and what the human does with the chip
   * has consequences. The outcome becomes a witnessed event and a memory with an
   * emotional tone on the actor; mood follows from the memory in the engine.
   */
  private async onPairOutcome(info: PairInfo & { outcome: string }): Promise<void> {
    const refused = info.outcome === "dodge" || info.outcome === "push";
    if (refused) {
      await this.onPairAborted({ ...info, cause: info.outcome as "dodge" | "push" });
    } else {
      await this.appendBodyEvent("body_action_committed", info.agentId, { intentId: info.pair, commands: ["pair"] }, true);
    }
    const handle = this.handle;
    if (!handle) return;
    const state = await handle.repositories.agentStateRepo.get(handle.simulationId, info.agentId);
    if (!state) return;
    const humiliating = info.outcome === "dodge" || info.outcome === "push";
    state.memories.push({
      id: `pair_${info.pair}`,
      agentId: info.agentId,
      simulationId: handle.simulationId,
      type: humiliating ? "emotional_residue" : "relationship",
      subjectAgentIds: info.withHuman ? [] : [info.withRef],
      sourceEventIds: [],
      summary: humiliating
        ? `I went in for a ${info.kind} and was ${info.outcome === "dodge" ? "dodged" : "pushed away"}.`
        : `A ${info.kind} was returned warmly.`,
      emotionalTone: humiliating ? "embarrassed" : "warm",
      confidence: 0.9,
      intensity: humiliating ? 0.7 : 0.5,
      unresolved: humiliating,
      createdAt: this.port.pulseIndex(),
      lastReinforcedAt: this.port.pulseIndex(),
    });
    await handle.repositories.agentStateRepo.upsert(state);
  }

  // ---- inbound ----------------------------------------------------------------

  async handleHumanChat(frame: Extract<HotelFrame, { t: "human_chat" }>): Promise<void> {
    if (!this.ingestor) return;
    if (this.state !== "running" && this.state !== "paused") return;
    try {
      await this.ingestor.handleHumanChat(frame);
    } catch (err) {
      this.d.logger.error("ingest failed", { run: this.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  handleFrame(frame: HotelFrame): void {
    if (frame.t === "actor_gone") {
      const ref = this.d.mirror.refOfAvatar(frame.actor);
      const a = this.agents.get(ref);
      if (a) a.gone = true;
      this.goneWaiters.delete(ref);
      if (this.goneWaiters.size === 0) this.goneResolve?.();
      // The executor clears its plans by ref, so it must see the frame before the ref is unregistered.
      this.executor?.handleFrame(frame);
      this.d.mirror.unregisterActor(ref);
      return;
    }
    this.executor?.handleFrame(frame);
  }

  mirrorMoved(ref: string): void {
    this.executor?.onMoved(ref);
  }

  mirrorLeft(ref: string): void {
    this.executor?.onLeft(ref);
  }

  humanTyping(room: RoomId, typing: boolean, at: number): void {
    if (this.rooms.has(room)) this.port?.noteHumanTyping(this.roomChannel(room), typing, at);
  }

  // ---- lifecycle --------------------------------------------------------------

  /** The link to the hotel went down or came back; the run holds still, it does not pause. */
  setLinkDown(down: boolean): void {
    this.linkDown = down;
    if (!this.loop) return;
    if (down) this.loop.pause();
    else if (this.state === "running") this.loop.resume();
  }

  pause(cause: PauseCause): void {
    if (this.state !== "running" && this.state !== "paused") return;
    // An admin pause outranks an idle one and cancels its end timer (hotel side); so does an open breaker.
    if (this.state === "paused" && !((cause === "admin" || cause === "breaker") && this.pauseCause === "idle")) return;
    this.state = "paused";
    this.pauseCause = cause;
    this.loop?.pause();
  }

  /** Resume rules (D46, D49): admin resumes anything but an open breaker; `auto` only idle; the breaker only itself. */
  resume(source: "admin" | "auto" | "breaker"): boolean {
    if (this.state !== "paused") return false;
    const cause = this.pauseCause;
    if (source === "auto" && cause !== "idle") return false;
    if (source === "breaker" && cause !== "breaker") return false;
    if (source === "admin" && cause === "breaker" && this.breaker.getState().phase !== "closed") {
      this.notice("llm_circuit_open", "warn");
      return false;
    }
    this.state = "running";
    this.pauseCause = undefined;
    if (!this.linkDown) this.loop.resume();
    return true;
  }

  status(loopLagMs?: number): Extract<SidecarMsg, { t: "run_status" }> {
    const m = this.meter.snapshot();
    const b = this.breaker?.getState();
    return {
      t: "run_status",
      run: this.id,
      state: this.state,
      ...(this.pauseCause ? { pause_cause: this.pauseCause } : {}),
      pulse: this.port?.pulseIndex() ?? 0,
      llm_calls: m.calls,
      tokens_in: m.tokensIn,
      tokens_out: m.tokensOut,
      cost_usd: m.costUsd,
      undelivered_committed: this.gateway?.undeliveredCommitted ?? 0,
      ...(b ? { breaker: b.phase === "closed" ? "closed" : "open" } : {}),
      // D53: the live LLM latency of the run; `lag_ms` is the sidecar's own event-loop lag.
      ...(m.p50Ms !== undefined ? { llm_p50_ms: Math.round(m.p50Ms) } : {}),
      ...(m.p95Ms !== undefined ? { llm_p95_ms: Math.round(m.p95Ms) } : {}),
      ...(loopLagMs !== undefined ? { lag_ms: Math.round(loopLagMs) } : {}),
    };
  }

  /** True when the live p95 passed the allowlist budget; the manager raises a notice once. */
  get p95Drift(): boolean {
    return this.meter.snapshot().p95Drift;
  }

  /** `eventRetention` plus the NDJSON sink its evictions go to (0 keeps every event in memory, as before). */
  private retention(): Pick<HotelSimulationOptions, "eventRetention"> {
    const { hotel, logger } = this.d;
    const max = hotel.eventRetention ?? 0;
    if (max <= 0) return {};
    const sink = new NdjsonEventSink(join(hotel.dataDir, "runs", String(this.id), "events.jsonl"), (err) =>
      logger.warn("event sink write failed", { run: this.id, error: err instanceof Error ? err.message : String(err) }));
    this.eventSink = sink;
    return { eventRetention: { maxRetained: max, onEvict: (_sim, evicted) => sink.push(evicted) } };
  }

  notice(code: string, kind: "info" | "warn" | "error", text?: string): void {
    this.d.link.send({ t: "ui_push", run: this.id, to: { admin: this.params.admin.id }, ui: { k: "notice", code, kind, ...(text ? { text } : {}) } });
  }

  /**
   * Teardown order follows the HTTP controller: drain the in-flight pulse
   * (bounded), walk the actors out, stop the runtime, write artifacts, close
   * handles, publish the final state. Idempotent.
   */
  stop(reason: SidecarEndReason, summary?: string, opts: { byHotel?: boolean } = {}): Promise<void> {
    this.stopping ??= this.teardown(reason, summary, opts);
    return this.stopping;
  }

  private async teardown(reason: SidecarEndReason, summary: string | undefined, opts: { byHotel?: boolean }): Promise<void> {
    const { link, mirror, clock, hotel } = this.d;
    this.state = "stopping";
    this.pendingEnd = reason;
    try {
      this.breaker?.dispose();
      this.unsubscribeBudget?.();
      for (const ref of [...this.pending.keys()]) this.dropPending(ref);
      this.drained = (await this.loop?.stop()) ?? true;

      // Walk-out (bounded). When the hotel ended the run it walks them out itself; a dead link cannot.
      if (!opts.byHotel && link.connected) await this.walkOut();
      this.gateway?.dispose();
      this.executor?.dispose();

      let events: CommittedEvent[] = [];
      try {
        events = (await this.port?.getEvents()) ?? [];
        await this.port?.stop();
      } catch (err) {
        this.d.logger.warn("runtime stop failed", { run: this.id, error: err instanceof Error ? err.message : String(err) });
      }
      const m = this.meter.snapshot();
      if (this.chain) this.d.logger.info("run llm usage", { run: this.id, calls: m.calls, costUsd: m.costUsd, p50Ms: m.p50Ms, p95Ms: m.p95Ms, chain: this.chain.snapshot() });
      try {
        const written = await writeRunArtifacts(hotel.dataDir, this.id, events, this.frames.log, {
          run: this.id,
          simulationId: this.handle?.simulationId ?? `hotel-run-${this.id}`,
          scenarioVersion: this.params.scenarioVersion,
          scenarioSha256: bodyDigest(this.body ? scrubConfigForArtifact(this.body.config) : null),
          finalState: reason === "failed" ? "failed" : "ended",
          stopReason: reason,
          startedAt: this.startedAt,
          endedAt: clock.now(),
          pulse: this.port?.pulseIndex() ?? 0,
          counters: { llm_calls: m.calls, llm_failures: m.failures, ...(this.chain?.counters() ?? {}), undelivered_committed: this.gateway?.undeliveredCommitted ?? 0, commands_sent: this.executor?.stats.sent ?? 0 },
          ...(this.drained ? {} : { dirty: true as const }),
        }, this.eventSink);
        await link.registerArtifacts(this.id, written);
      } catch (err) {
        this.d.logger.warn("artifacts not written", { run: this.id, error: err instanceof Error ? err.message : String(err) });
      }
      await this.handle?.close();
    } finally {
      for (const ref of this.agents.keys()) mirror.unregisterActor(ref);
      link.untrackRun(this.id);
      this.state = reason === "failed" ? "failed" : "ended";
      if (!opts.byHotel) link.send({ t: "run_end", run: this.id, reason, ...(summary ? { summary } : {}) });
      this.d.onEnded(this, reason);
    }
  }

  private async walkOut(): Promise<void> {
    const { link, clock } = this.d;
    const timeout = this.d.timing?.walkOutTimeoutMs ?? SPAWN_DEFAULTS.walkOutTimeoutMs;
    const lease = link.leaseOf(this.id);
    if (lease === undefined) return;
    const live = [...this.agents].filter(([, a]) => a.spawned && !a.gone);
    if (live.length === 0) return;
    const done = new Promise<void>((resolve) => {
      this.goneResolve = resolve;
    });
    for (const [ref] of live) {
      const id = this.d.mirror.avatarId(ref);
      if (id === undefined) continue;
      this.goneWaiters.add(ref);
      link.send({ t: "actor_despawn", cid: link.nextCid(this.id), run: this.id, lease, actor: id, mode: "walk_out" });
    }
    if (this.goneWaiters.size === 0) return;
    await Promise.race([done, sleepOn(clock, timeout)]);
    // Whoever has not left by the deadline is removed at once.
    for (const ref of [...this.goneWaiters]) {
      const id = this.d.mirror.avatarId(ref);
      if (id !== undefined) link.send({ t: "actor_despawn", cid: link.nextCid(this.id), run: this.id, lease, actor: id, mode: "now" });
    }
  }

  /** Drops the run without touching the hotel: the hotel already interrupted it (sidecar restart, hello without it). */
  async abandon(): Promise<void> {
    await this.stop("failed", "interrupted", { byHotel: true });
  }

  /** Admin text steering (`inject`, `whisper`): trusted, so it is not run through guest ingestion. */
  async steer(text: string, to?: string): Promise<boolean> {
    const handle = this.handle;
    if (!handle || (this.state !== "running" && this.state !== "paused")) return false;
    const targets = to ? [to] : [...this.agents.keys()];
    await this.port.appendEvents([
      {
        simulationId: handle.simulationId,
        channelId: this.homeChannelId,
        actorId: "host",
        type: "message_sent",
        payload: { content: text.slice(0, 400) },
        sourceIntentId: "host-admin",
        pulseIndex: this.port.pulseIndex(),
        sourceEventIds: [],
        emotionalSalience: "high",
        visibility: { visibleToAgents: targets, visibleToSpectators: true, visibleToOperators: true, visibilityReason: to ? "admin_whisper" : "admin_inject" },
      },
    ]);
    if (to) this.requestFocused([to]);
    return true;
  }

  /** `"Ana Clara" hello` or the first unambiguous cast-name prefix (D51). */
  resolveWhisperTarget(args: string): { agentId: string; text: string } | undefined {
    const quoted = /^"([^"]+)"\s+(.+)$/s.exec(args.trim());
    const entries = [...this.agents].map(([id, a]) => ({ id, name: a.name }));
    if (quoted?.[1] && quoted[2]) {
      const hit = entries.find((e) => e.name.toLowerCase() === quoted[1]?.toLowerCase());
      return hit ? { agentId: hit.id, text: quoted[2] } : undefined;
    }
    const lower = args.trim().toLowerCase();
    const matches = entries.filter((e) => lower.startsWith(`${e.name.toLowerCase()} `));
    const best = matches.sort((a, b) => b.name.length - a.name.length)[0];
    return best ? { agentId: best.id, text: args.trim().slice(best.name.length).trim() } : undefined;
  }

  statusText(): string {
    const m = this.meter.snapshot();
    return `${this.state}${this.pauseCause ? ` (${this.pauseCause})` : ""}, pulse ${this.port?.pulseIndex() ?? 0}, ${m.calls} calls, $${m.costUsd.toFixed(4)}, p95 ${m.p95Ms ?? "n/a"} ms${this.chain ? `, served ${this.chain.snapshot().links.map((l) => `${l.name} ${l.served}`).join(" / ")}` : ""}`;
  }

  get endReason(): SidecarEndReason | undefined {
    return this.pendingEnd;
  }
}

/** The hotel stores `body TEXT`; the version endpoint may wrap it. */
function extractBody(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object" && "body" in raw) return (raw as { body: unknown }).body;
  return raw;
}
