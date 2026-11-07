import { BodyIntentSchema } from "@perfectman/shared";
import type { AgentState, BodyHandleMap, BodyIntent, CommittedEvent, PairedActAbortedPayload, RoomId, SimulationEvent, SpeechMode } from "@perfectman/shared";
import {
  AgentRuntime,
  MockLLMProvider,
  applySeeds,
  buildConfiguredSimulation,
  createLLMProvider,
  scrubConfigForArtifact,
} from "@perfectman/server/hotel";
import type { ConfiguredSimulationHandle, LLMConfig, LLMProvider, OnConsult, SimulationAppConfig, SplitPulseConfig } from "@perfectman/server/hotel";
import { WallClockPulseLoop } from "../clock/wall-clock-pulse-loop.js";
import type { Clock } from "../clock/clock.js";
import { sleepOn } from "../clock/clock.js";
import type { HotelConfig } from "../config.js";
import type { HotelFrame, PauseCause, RunMode, RunState, SidecarEndReason, SidecarMsg } from "../director/index.js";
import { BodyExecutor } from "../embodiment/body-executor.js";
import type { PairInfo } from "../embodiment/body-executor.js";
import { chooseSpeechMode, plan, updateMemory } from "../embodiment/plan.js";
import { pickTile } from "../embodiment/tiles.js";
import type { PlannerMemory } from "../embodiment/types.js";
import { HotelGateway } from "../gateway/hotel-gateway.js";
import type { CastEntry, GatewayTiming } from "../gateway/hotel-gateway.js";
import { GuestIngestor } from "../ingest/guest-ingestor.js";
import { LlmCircuitBreaker } from "../llm/breaker.js";
import { hostLlmConfig, pingLlm } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";
import { LlmMeter } from "../llm/meter.js";
import { tileKey } from "../space/geometry.js";
import type { HotelSpaceMirror } from "../space/space-mirror.js";
import type { Logger } from "../util/log.js";
import { bodyDigest } from "../authoring/authoring-service.js";
import { writeRunArtifacts } from "./artifacts.js";
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
  /** "tick": the sidecar plans after each pulse. "server": L3 calls `dispatch` with planned commands. */
  plannerHook?: "tick" | "server";
  onEnded(run: Run, reason: SidecarEndReason): void;
};

export type PrepareResult = { ok: true } | { ok: false; code: string; message: string };

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
  private breaker!: LlmCircuitBreaker;
  private readonly meter: LlmMeter;
  private readonly frames: FrameLogRecorder;
  private readonly agents = new Map<string, { name: string; spawned: boolean; gone: boolean }>();
  private readonly memory = new Map<string, PlannerMemory>();
  private readonly arousal = new Map<string, number>();
  private readonly noOpStreak = new Map<string, number>();
  private lastTickEventId: string | undefined;
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
    this.frames = new FrameLogRecorder(d.clock);
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
    const healthy = await pingLlm(this.hostLlm, process.env[hotel.llm.apiKeyEnv]);
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
      notice: (code, kind) => this.notice(code, kind),
      // The scenario's own ending (goal_end_offered) stops the runtime; the run follows it.
      onStopped: (_id, reason) => {
        if (reason === "goal_end_offered" && this.state === "running") void this.stop("completed");
      },
    });

    this.breaker = new LlmCircuitBreaker({
      clock,
      ...(this.d.timing?.breakerInitialBackoffMs !== undefined ? { initialBackoffMs: this.d.timing.breakerInitialBackoffMs } : {}),
      probe: () => pingLlm(this.hostLlm, process.env[hotel.llm.apiKeyEnv]),
      onOpen: () => {
        this.pause("breaker");
        this.notice("llm_circuit_open", "warn");
      },
      onClose: () => {
        this.notice("llm_circuit_closed", "info");
        this.resume("breaker");
      },
    });

    const onConsult: OnConsult = (info) => this.gateway.noteConsult(info.agentId, clock.now());
    const split: SplitPulseConfig = { pulseMode: "split", generateConcurrency: hotel.llm.concurrency, onConsult };
    // `splitPulse` is read by the L3 runtime; the current one ignores it.
    // No injected `llmBudget`: `canCall` reads the module singleton, which the build registers from
    // `settings` (set effectively unbounded below, D11). L3 replaces this with warn mode (ADR-0025).
    const options = {
      agentRuntimeFactory: (registry: ConstructorParameters<typeof AgentRuntime>[1]) =>
        new AgentRuntime(undefined, registry, (llm: LLMConfig, agentId: string) => this.provider(llm, agentId)),
      extraGateways: { hotel: () => this.gateway },
      splitPulse: split,
    };
    this.handle = await buildConfiguredSimulation(cfg, options);
    this.port = createRuntimePort(this.handle);
    this.ingestor = new GuestIngestor({
      mirror,
      clock,
      simulationId: this.handle.simulationId,
      names: Object.fromEntries([...this.agents].map(([id, a]) => [id, a.name])),
      homeRoom: this.home,
      channelIdForRoom: (room) => (room === this.home ? this.homeChannelId : undefined),
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
    this.d.logger.info("run running", { run: this.id, actors: this.agents.size, caps: this.port.capabilities });
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
        settings: { ...cfg.simulation.settings, pulseIntervalMs: 6000, llmCallBudgetPerMinute: 1_000_000, tokenBudgetPerHour: 2_000_000_000 },
      },
      persistence: { type: "memory" },
      deliveryGateways: [],
      channels: cfg.channels.map((c) => (c === def ? { ...c, id: this.homeChannelId, default: true } : c)),
      agents: cfg.agents.map((a) => ({ ...a, llm: this.hostLlm })),
    };
  }

  private provider(llm: LLMConfig, agentId: string): LLMProvider {
    const inner: LLMProvider = llm.providerType === "mock" ? new MockLLMProvider() : createLLMProvider(llm, agentId);
    return this.d.governor.wrap(inner, {
      onSuccess: (r) => {
        this.meter.recordSuccess(this.d.hotel.llm.prices[r.model] ? r.model : llm.modelName, r.usage.inputTokens, r.usage.outputTokens, r.latencyMs);
        this.breaker.recordSuccess();
      },
      onFailure: () => {
        this.meter.recordFailure();
        this.breaker.recordFailure();
      },
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
    const now = this.d.clock.now();
    this.gateway.notePulseStart(now);
    // Without the runtime's `onConsult`, a focused pulse is the only place we know who is about to answer.
    if (!this.port.capabilities.hotelApi) for (const id of opts.focusAgentIds ?? []) this.gateway.noteConsult(id, now);
    await this.port.runPulse(opts);
    this.pulseErrors = 0;
    this.frames.snapshot(this.d.mirror);
    if ((this.d.plannerHook ?? "tick") === "tick") await this.bodyTick();
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

  /** Plans body commands for every actor from what each committed this pulse. */
  private async bodyTick(): Promise<void> {
    const handle = this.handle;
    if (!handle) return;
    const now = this.d.clock.now();
    const events = await this.port.getEventsAfter(this.lastTickEventId);
    const last = events.at(-1);
    if (last) this.lastTickEventId = last.id;
    for (const ref of this.agents.keys()) {
      const mine = events.filter((e) => e.actorId === ref);
      if (mine.some((e) => e.type === "message_sent" || e.type === "reply_sent")) this.noOpStreak.set(ref, 0);
      else if (mine.some((e) => e.type === "no_op_recorded")) this.noOpStreak.set(ref, (this.noOpStreak.get(ref) ?? 0) + 1);
      const state: AgentState | null = await handle.repositories.agentStateRepo.get(handle.simulationId, ref);
      const space = this.d.mirror.view(ref, now);
      if (!state || !space) continue;
      this.arousal.set(ref, state.coreMood.arousal);
      const carried = readBodyIntent(mine);
      const mem = this.memory.get(ref) ?? {};
      const cmds = plan({
        space,
        agentState: state,
        committedEvents: mine,
        now,
        rng: this.d.rng,
        memory: mem,
        noOpStreak: this.noOpStreak.get(ref) ?? 0,
        ...(carried ? { bodyIntent: carried.bodyIntent, handles: carried.handles } : {}),
      });
      if (cmds.length === 0) continue;
      this.memory.set(ref, updateMemory(mem, cmds, now, space.self?.tile ?? [0, 0]));
      this.executor.send(cmds);
    }
  }

  private async onArrived(agentId: string, planId: string, tile: readonly [number, number], room: RoomId): Promise<void> {
    await this.appendBodyEvent("body_arrived", agentId, { planId, room, tile: [tile[0], tile[1]] }, true);
    // A salient wake: the actor looks around on arrival (reason body_arrived).
    this.requestFocused([agentId], "body_arrived");
  }

  /** Body events are appended through the event log; types the engine does not know yet are tolerated by the repo. */
  private async appendBodyEvent(type: SimulationEvent["type"], agentId: string, payload: SimulationEvent["payload"], visible: boolean): Promise<void> {
    if (!this.handle || this.state === "ended") return;
    try {
      await this.port.appendEvents([
        {
          simulationId: this.handle.simulationId,
          channelId: this.homeChannelId,
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
    if (room === this.home) this.port?.noteHumanTyping(this.homeChannelId, typing, at);
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
    // An admin pause outranks an idle one and cancels its end timer (hotel side).
    if (this.state === "paused" && !(cause === "admin" && this.pauseCause === "idle")) return;
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

  status(): Extract<SidecarMsg, { t: "run_status" }> {
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
      // `lag_ms` carries the live LLM p95 (D53); the schema has no p50 field.
      ...(m.p95Ms !== undefined ? { lag_ms: Math.round(m.p95Ms) } : {}),
    };
  }

  /** True when the live p95 passed the allowlist budget; the manager raises a notice once. */
  get p95Drift(): boolean {
    return this.meter.snapshot().p95Drift;
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
          counters: { llm_calls: m.calls, llm_failures: m.failures, undelivered_committed: this.gateway?.undeliveredCommitted ?? 0, commands_sent: this.executor?.stats.sent ?? 0 },
          ...(this.drained ? {} : { dirty: true as const }),
        });
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
    return `${this.state}${this.pauseCause ? ` (${this.pauseCause})` : ""}, pulse ${this.port?.pulseIndex() ?? 0}, ${m.calls} calls, $${m.costUsd.toFixed(4)}, p95 ${m.p95Ms ?? "n/a"} ms`;
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

/** Reads a validated `body` block the engine may carry on a committed event (L3 contract; absent today). */
function readBodyIntent(events: readonly CommittedEvent[]): { bodyIntent: BodyIntent; handles: BodyHandleMap } | undefined {
  for (const e of [...events].reverse()) {
    const raw = e.payload["body"];
    if (raw === undefined) continue;
    const parsed = BodyIntentSchema.safeParse(raw);
    if (!parsed.success) continue;
    const handles = e.payload["bodyHandles"];
    return { bodyIntent: parsed.data, handles: (handles && typeof handles === "object" ? handles : {}) as unknown as BodyHandleMap };
  }
  return undefined;
}
