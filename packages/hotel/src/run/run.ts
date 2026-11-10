import type { ActionEmotions, ActionIntent, AgentRuntimeInput, AgentState, BlockedReason, BodyHandleMap, BodyIntent, CommittedEvent, Memory, PairedActAbortedPayload, RoomId, SimulationEvent, SpaceView, SpeechMode } from "@perfectman/shared";
import { BeatCraft, SCRIPT_NORMS, normsFor } from "@perfectman/shared";
import type { ScriptScore } from "@perfectman/shared";
import {
  AgentRuntime,
  MockLLMProvider,
  PromptBuilder,
  applySeeds,
  buildConfiguredSimulation,
  beatCraftEnabled,
  createLLMProvider,
  loadSlimKbFromEnv,
  scrubConfigForArtifact,
} from "@perfectman/server/hotel";
import type { AgentCommitInfo, BuiltPrompt, ConfiguredSimulationHandle, GuardKind, HotelSimulationOptions, LLMConfig, LLMProvider, OnConsult, ResolvedBody, SimulationAppConfig } from "@perfectman/server/hotel";
import { join } from "node:path";
import { MockActMemory, withMockBody } from "../llm/mock-body.js";
import type { MockDrama } from "../llm/mock-body.js";
import { WallClockPulseLoop } from "../clock/wall-clock-pulse-loop.js";
import type { Clock, TimerHandle } from "../clock/clock.js";
import { sleepOn } from "../clock/clock.js";
import { linksOf } from "../config.js";
import type { HotelConfig, ModelPrice } from "../config.js";
import { CinematicDirector, MirrorCineWorld, Narrator, TrackFileSink, moodOfState } from "../director/cine/index.js";
import type { CineConfig, NarratorLlm } from "../director/cine/index.js";
import type { HotelFrame, PauseCause, RunMode, RunState, SidecarEndReason, SidecarMsg } from "../director/index.js";
import { resolveRunDrama, summarizeRunDrama } from "../authoring/scenario-drama.js";
import type { ScenarioBeat } from "../authoring/scenario-beats.js";
import type { RunDrama } from "../authoring/scenario-drama.js";
import { BeatPlayer, DramaDirector, composeDramaSinks, mirrorWorld } from "../director/drama/index.js";
import type { DramaDecisionPort, DramaHost, SceneAdvance } from "../director/drama/index.js";
import { BodyExecutor } from "../embodiment/body-executor.js";
import type { PairInfo } from "../embodiment/body-executor.js";
import { DramaBody } from "../embodiment/drama-body.js";
import { chooseSpeechMode, leaveDirective, namedIn, noteExchange, planFacing, updateMemory } from "../embodiment/plan.js";
import { pickTile } from "../embodiment/tiles.js";
import type { PlannedCommand, PlannerMemory } from "../embodiment/types.js";
import { HotelGateway } from "../gateway/hotel-gateway.js";
import type { CastEntry, GatewayExecutor, GatewayTiming } from "../gateway/hotel-gateway.js";
import { GuestIngestor } from "../ingest/guest-ingestor.js";
import { BreakerDriver } from "../llm/breaker.js";
import { COST_HEADER, LlmChain } from "../llm/chain.js";
import { AMBIENT_QUIET_MS, GENERATE_DEADLINE_MS, hostLlmConfig, pingLlm } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";
import { NARRATOR_CHAIN_DEADLINE_MS, makeNarratorLlm } from "../llm/narrator-llm.js";
import type { RunNarratorLlm } from "../llm/narrator-llm.js";
import { EXPERIMENTAL_CAST_WARN } from "../llm/chain-config.js";
import type { ModelTier } from "../llm/chain-config.js";
import { pickTier, pricesWithPick, withPickedModel } from "../llm/run-model.js";
import type { PickedModel } from "../llm/run-model.js";
import { LlmMeter } from "../llm/meter.js";
import { chebyshev, tileKey } from "../space/geometry.js";
import { SAY_CLEAR_TILES } from "../space/hearing.js";
import type { HotelSpaceMirror } from "../space/space-mirror.js";
import type { ScopedMirror } from "../space/scoped-mirror.js";
import type { Logger } from "../util/log.js";
import { bodyDigest } from "../authoring/authoring-service.js";
import { NdjsonEventSink, TRACK_FILE, writeRunArtifacts } from "./artifacts.js";
import type { ReplayManifest } from "./artifacts.js";
import { MEMORY_ID_PREFIX, PlayerMemory } from "./player-memory.js";
import { SceneRecorder, SceneSpine, buildSceneSpine, sceneSpineEnabled, scriptGuardEnabled, scriptLikenessManifest } from "./scene-recorder.js";
import type { MemoryStore } from "./player-memory.js";
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
  /** The model the admin picked for this run (D54): link 1 of its chain, the configured chain behind it. */
  model?: PickedModel | null;
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
  /** The hotel's player-memory rows (D21); absent without an internal HTTP client. */
  readonly memoryStore?: MemoryStore | undefined;
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
  /** Cinematic mode pacing and thresholds (director/cine/types.ts); tests scale them down. */
  cine?: Partial<CineConfig>;
  /** The natural gap between two cast members who walk in one after another, `[min, max]` ms; 1 to 3 s in production. */
  arrivalStaggerMs?: readonly [number, number];
  /** Replays (replay-run.ts): how long the picture stays after the last recorded thing (1.5 s), and a speed that overrides the command's. */
  replayTailMs?: number;
  replaySpeed?: number;
  /** How often changed player-memory rows are written back while a run goes; 2 min in production. */
  memoryFlushEveryMs?: number;
};

export type RunDeps = {
  hotel: HotelConfig;
  clock: Clock;
  rng: () => number;
  logger: Logger;
  mirror: HotelSpaceMirror;
  link: RunLink;
  governor: LlmGovernor;
  /** The drama director's link and hub (act-contract.md 11.2); absent only for a run built without a manager (tests); a dialect 1 link leaves it inert. */
  drama?: DramaHost;
  timing?: RunTiming;
  /** Overrides the narrator's model call (D19). Absent: a cinematic run builds its own from the provider chain; with the mock provider cards and captions are the deterministic fallback text. */
  narratorLlm?: NarratorLlm;
  onEnded(run: Run, reason: SidecarEndReason): void;
};

/**
 * `byHotel`: the hotel ended the run (or already interrupted it), so it walks the actors out and is told nothing.
 * `interrupted`: the sidecar is going away (SIGTERM). The actors are walked out and the artifacts written as for a stop,
 * but no `run_end` is sent, so the hotel records the run as `interrupted` and not as a deliberate stop (D41).
 */
export type StopOptions = { byHotel?: boolean; interrupted?: boolean };

export type PrepareResult = { ok: true } | { ok: false; code: string; message: string };

type PendingSpeech = { intent: ActionIntent; targetRef: string; walkPlans: Set<string>; timer: TimerHandle; rewalks: number };

/** `{ [key]: value }` when there is a value, `{}` when there is none (exact optional properties). */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

/** The hotel's limits on an actor name (hotel-package.md 6): short, and neither a ref separator nor a mention. */
export const MAX_ACTOR_NAME_CHARS = 16;
/** `hr-100-61.hd-180-1`: dot-separated parts of a two-letter slot and numeric ids. */
const FIGURE_RE = /^[a-z]{1,3}-\d+(?:-\d+)*(?:\.[a-z]{1,3}-\d+(?:-\d+)*)*$/;

export function actorNameError(name: string): string | undefined {
  if (name.trim().length === 0) return "the name is empty";
  if ([...name].length > MAX_ACTOR_NAME_CHARS) return `the name is longer than ${MAX_ACTOR_NAME_CHARS} characters`;
  if (/[:@]/.test(name)) return "the name may not contain ':' or '@'";
  return undefined;
}

/** The most a stop waits for the last player-memory writes. */
const MEMORY_FLUSH_BOUND_MS = 8000;
const SPAWN_DEFAULTS = { spawnIntervalMs: 200, spawnTimeoutMs: 5000, walkOutTimeoutMs: 10_000 } as const;
/** Cast members with no entrance time of their own walk in this far apart (a natural trickle, not a crowd at the door). */
export const DEFAULT_ARRIVAL_STAGGER_MS: readonly [number, number] = [1000, 3000];
/** One pulse is 6 s, so a scenario's `arrivalPulse: 4` is a 24 s entrance. */
const PULSE_MS = 6000;

export type Arrival = { ref: string; atMs: number };

/**
 * When each cast member walks in, ms after the run starts, earliest first (the earliest is always 0). A time the
 * scenario gives wins (the builder's "after N s", else the persona's `arrivalPulse`); everyone else walks in
 * one after another with a natural gap, so twelve people do not appear in the doorway at once.
 */
export function arrivalSchedule(
  agents: ReadonlyArray<{ id: string; arrivalPulse?: number | null }>,
  arrivals: Readonly<Record<string, number>> | undefined,
  stagger: readonly [number, number],
  rng: () => number,
): Arrival[] {
  const [lo, hi] = stagger;
  let auto: number | undefined;
  const out: Arrival[] = agents.map((a) => {
    const fixed = arrivals?.[a.id] ?? (typeof a.arrivalPulse === "number" && a.arrivalPulse > 0 ? a.arrivalPulse * PULSE_MS : undefined);
    if (fixed !== undefined) return { ref: a.id, atMs: fixed };
    auto = auto === undefined ? 0 : auto + lo + rng() * Math.max(0, hi - lo);
    return { ref: a.id, atMs: Math.round(auto) };
  });
  const first = Math.min(...out.map((a) => a.atMs));
  return out.map((a) => ({ ref: a.ref, atMs: a.atMs - first })).sort((x, y) => x.atMs - y.atMs);
}

/**
 * One hotel run: a built simulation, its gateway and body, and the lifecycle of
 * hotel-package.md 6. The hotel is the authority on state; this is the
 * sidecar's view, reported in `run_status`.
 */
/** A line released after a walk is typed "this long ago", so it lands at once (the gateway caps typing at 4 s). */
const DEFERRED_TYPING_HEAD_START_MS = 3500;
/** The walk for a held line ends where the addressee stood when it was planned; if they have moved off, it is planned again this many times. */
const MAX_HELD_REWALKS = 2;
/** How long a held line waits for a re-planned walk. */
const REWALK_GRACE_MS = 6000;

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
  private director: DramaDirector | undefined;
  /** The scenario's authored beats, on this run's clock (errata P4-01); absent without drama or without a script. */
  private beatPlayer: BeatPlayer | undefined;
  /** What became of the authored beats, for the run summary: how many played, and how many were dropped for each reason (`beats_dropped_<why>`). */
  private readonly beatOutcomes = { played: 0, dropped: new Map<string, number>() };
  private loop!: WallClockPulseLoop;
  private breaker!: BreakerDriver;
  private unsubscribeBudget: (() => void) | undefined;
  private readonly meter: LlmMeter;
  /** The configured prices plus the picked model's listed one. */
  private readonly prices: Record<string, ModelPrice>;
  /** The provider chain (failover, per-link breakers, per-link usage); absent for the mock provider. */
  private readonly chain: LlmChain | undefined;
  /** Cinematic mode: the narrator's own chain over the same links (picked model first); absent for the mock provider. */
  private narratorChain: RunNarratorLlm | undefined;
  private narrator: Narrator | undefined;
  private readonly frames: FrameLogRecorder;
  /** Cinematic mode only: holds speech for the playback clock and films the run (director/cine). */
  private cine: CinematicDirector | undefined;
  private cineWorld: MirrorCineWorld | undefined;
  private trackSink: TrackFileSink | undefined;
  /** Where body commands go: the executor, or the Director's wrapper of it in cinematic mode. */
  private out!: GatewayExecutor;
  /** Events the in-memory log evicted, streamed to `events.jsonl` so a long run stays complete without growing. */
  private eventSink: NdjsonEventSink | undefined;
  private readonly mockConsults = new Map<string, number>();
  private readonly mockActs = new MockActMemory();
  /** What the characters remember about the people they meet (D21, D47); absent when the hotel did not name the scenario. */
  private playerMemory: PlayerMemory | undefined;
  private scenarioId: number | undefined;
  /** The model the admin picked, its tier and the size of the cast it was picked for: what the manifest says about the pick. */
  private pickNote: { model: string; tier: ModelTier; actors: number } | undefined;
  private readonly agents = new Map<string, { name: string; spawned: boolean; gone: boolean }>();
  private readonly memory = new Map<string, PlannerMemory>();
  private readonly arousal = new Map<string, number>();
  private readonly noOpStreak = new Map<string, number>();
  /** What the repetition and output guards did this run (rejected repeats, garbles, stall nudges, over-long lines), for the run's artifact counters. */
  private readonly guardHits = new Map<GuardKind, number>();
  /** The actors' lines and moves as the script-likeness metrics read them: the run's score at the end, and the progress the scene spine gates on. */
  private scene: SceneRecorder | undefined;
  /** The spine of a scene with no authored beats (scene-recorder.ts); absent when the scene has beats, drama is off, or the cast is one. */
  private spine: SceneSpine | undefined;
  /** The run's script-likeness once it has ended, for the manifest and the log. */
  private scriptScore: ScriptScore | undefined;
  /** The run clock when the scene started (the cast is in): what the recorder's times and the spine's seconds count from. */
  private sceneStart = 0;
  /** Each actor's last 15 action tendencies, from the commit seam (computed, never persisted): the planner's reading of the whole emotion model. */
  private readonly tendencies = new Map<string, ActionEmotions>();
  /** The planner side of the drama contract (packet P3): the act lock, the reactions owed, the dead pool, the memory of acts. Inert until a dialect 2 session says drama is on. */
  readonly dramaSink: DramaBody;
  /** Actors the planner already ran for during the current pulse (the idle sweep skips them). */
  private readonly plannedThisPulse = new Set<string>();
  /** The run's counts of what the body did about lines and handles (errata P7), for `bodyCounters`. */
  private readonly earshot = { approaches: 0, drops: 0, stripped: 0, dropped: new Map<string, number>() };
  /** The scenario's drama as the run enforces it, read once the body is built. */
  private runDrama: RunDrama | undefined;
  /** Lines held back until their speaker reaches the addressee (`move_then_speak`), by agent. */
  private readonly pending = new Map<string, PendingSpeech>();
  /** Rooms whose channel (`room:<id>`) the runtime knows. */
  private readonly rooms = new Set<RoomId>();
  /** Room channel changes apply in the order the doors were taken. */
  private roomOps: Promise<void> = Promise.resolve();
  private linkDown = false;
  /** Cast members who have not walked in yet, with the timers that will bring them (staggered arrival). */
  private readonly pendingArrivals = new Set<string>();
  private readonly arrivalTimers = new Set<TimerHandle>();
  private arrivalChain: Promise<void> = Promise.resolve();
  /** Tiles already promised to an entering actor, so each one gets its own spot even when they arrive apart. */
  private readonly enterTaken = new Set<string>();
  private goneWaiters = new Set<string>();
  private goneResolve: (() => void) | undefined;
  private stopping: Promise<void> | undefined;
  private startedAt = 0;
  private pulseErrors = 0;
  private drained = true;
  private pendingEnd: SidecarEndReason | undefined;
  readonly homeChannelId: string;
  /** The shared mirror as this run sees it: its own plain refs in, run-scoped keys inside (space/scoped-mirror.ts). */
  private readonly space: ScopedMirror;

  constructor(readonly params: RunStartParams, private readonly d: RunDeps) {
    this.id = params.run;
    this.space = d.mirror.scoped(params.run);
    this.home = String(params.room);
    this.homeChannelId = `room:${params.room}`;
    this.prices = pricesWithPick(d.hotel.llm.prices, params.model);
    this.meter = new LlmMeter(this.prices);
    const links = withPickedModel(linksOf(d.hotel.llm), params.model);
    this.chain = links.length > 0
      ? new LlmChain({ links, clock: d.clock, runId: params.run, simulationId: `hotel-run-${params.run}`, governor: d.governor, prices: this.prices, logger: d.logger, onCap: (cap, style) => this.setPromptCap(cap, style), addressed: (id) => this.waitingOn.has(id), rebuild: (req) => this.rebuildPrompt(req) })
      : undefined;
    this.frames = new FrameLogRecorder(d.clock);
    this.dramaSink = new DramaBody({
      run: params.run,
      clock: d.clock,
      mirror: this.space,
      executor: { send: (cmds) => this.out.send([...cmds]) },
      port: () => this.dramaPort,
      isOwn: (ref) => this.agents.has(ref),
      names: (ref) => this.agents.get(ref)?.name,
      lang: "pt-BR",
      pool: { defer: (ref) => void this.port?.deferActor(ref), admit: (ref) => void this.port?.admitActor(ref), retire: (ref) => void this.port?.retireActor(ref) },
      store: {
        get: async (ref) => (this.handle ? await this.handle.repositories.agentStateRepo.get(this.handle.simulationId, ref) : null),
        upsert: async (state) => void (await this.handle?.repositories.agentStateRepo.upsert(state)),
      },
      ghostVoice: d.hotel.dramaGhostVoice === true && params.mode === "cinematic",
      hooks: { blocked: (agentId, reasons) => void this.appendBodyEvent("body_blocked", agentId, { reasons: reasons as unknown as never }, false) },
      provocation: { allow: (observer, offender) => this.mayProvoke(observer, offender) },
      // The model's next prompt says a refused move is not yet earned (errata P7): the body's `lastBlocked` is what the prompt's blocked line reads.
      note: (agentId, reasons) => {
        this.space.bodyOf(agentId, this.d.clock.now()).lastBlocked = [...reasons];
      },
    });
    this.space.setFallen((ref) => this.dramaSink.ledger.fallenKind(ref));
    this.space.setDrama(() => this.dramaSink.active);
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
    for (const [ref, a] of this.agents) {
      if (a.gone) continue;
      const r = this.space.roomOfRef(ref);
      if (r) rooms.add(r);
    }
    return [...rooms];
  }

  holdsActorIn(room: RoomId): boolean {
    return [...this.agents].some(([ref, a]) => !a.gone && this.space.roomOfRef(ref) === room);
  }

  // ---- stage A: validate ------------------------------------------------------

  /**
   * The stage step's rooms: the cast may walk into those and back home, nowhere else. A room that is not in the
   * hotel's `hello` menu (another player's) is taught to the mirror here so it has a door, and a name for "go to the Quarto".
   * A scenario with no stage keeps every room the hotel names.
   */
  private limitTravel(body: ScenarioBody): void {
    const stage = body.stage;
    if (!stage) return;
    this.d.mirror.noteKnownRooms(stage.rooms.map((r) => ({ id: String(r.id), ...(r.name ? { name: r.name } : {}) })));
    this.space.restrictTravel([this.home, ...stage.rooms.map((r) => String(r.id))]);
  }

  async prepare(): Promise<PrepareResult> {
    const { hotel, link } = this.d;
    let raw: unknown;
    try {
      raw = await link.fetchScenarioVersion(this.params.scenarioVersion);
    } catch (err) {
      return { ok: false, code: "scenario_unavailable", message: (err as Error).message };
    }
    const parsed = parseScenarioBody(extractBody(raw));
    if (!parsed.ok) return { ok: false, code: "bad_scenario", message: parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; ") };
    this.body = parsed.body;
    this.limitTravel(parsed.body);
    this.scenarioId = scenarioIdOf(raw);
    if (this.body.config.agents.length > this.params.capActors) {
      return { ok: false, code: "actor_limit", message: `scenario has ${this.body.config.agents.length} characters, the cap is ${this.params.capActors}` };
    }
    // An experimental pick (8B, or a window of 8K or less) is still allowed, for any cast; the run says so in its log and manifest.
    if (this.params.model) {
      this.pickNote = { model: this.params.model.id, tier: pickTier(this.params.model), actors: this.body.config.agents.length };
      if (this.pickNote.tier === "experimental" && this.pickNote.actors >= EXPERIMENTAL_CAST_WARN) {
        this.d.logger.warn(`run ${this.id}: the picked model ${this.pickNote.model} is experimental and the cast is ${this.pickNote.actors}`, { run: this.id, ...this.pickNote });
      }
    }
    // Names and looks go to the hotel as they are: refuse what it would refuse, before any model call or spawn.
    for (const a of this.body.config.agents) {
      const name = a.promptProfile.displayName;
      const nameError = actorNameError(name);
      if (nameError) return { ok: false, code: "bad_scenario", message: `character "${name}": ${nameError}` };
      const figure = this.body.looks?.[a.id]?.figure;
      if (figure !== undefined && figure !== "" && !FIGURE_RE.test(figure)) {
        return { ok: false, code: "bad_scenario", message: `character "${name}": the figure is not a valid figure string` };
      }
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
    // The prompt is sized for link 1, which is the picked model when the admin picked one (D54).
    if (this.params.model && this.chain?.promptCap !== undefined && this.chain.promptStyle !== undefined) this.setPromptCap(this.chain.promptCap, this.chain.promptStyle);
    const healthy = await this.pingProvider();
    if (!healthy) return { ok: false, code: "llm_unavailable", message: "the model endpoint did not answer a health check" };
    return { ok: true };
  }

  // ---- stage B: build, spawn, start -------------------------------------------

  async launch(): Promise<void> {
    const { clock, link, hotel } = this.d;
    const mirror = this.space;
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
      isDead: (ref) => this.dramaSink.isDead(ref),
      lockOf: (ref) => this.dramaSink.ledger.lockOf(ref),
      ghostVoice: this.d.hotel.dramaGhostVoice === true && this.params.mode === "cinematic",
      hooks: {
        gone: (ref) => this.dramaSink.actorGone(ref),
        // DEATH-5: the ghost voice stays on this side of the wire (the hotel refuses a dead actor's thought); it is kept in the run's frame log.
        ghost: (agentId, text) => this.frames.record("out", this.space.roomOfRef(agentId), "ghost_thought", { agentId, text }),
        blocked: (agentId, reasons) => void this.appendBodyEvent("body_blocked", agentId, { reasons: reasons as unknown as never }, false),
        arrived: (agentId, plan, tile, room) => void this.onArrived(agentId, plan.id, tile, room),
        movedRoom: (agentId, from, to) => this.onMovedRoom(agentId, from, to),
        pairAborted: (info) => void this.onPairAborted(info),
        pairOutcome: (info) => void this.onPairOutcome(info),
      },
    });

    this.startDrama();
    this.out = this.executor;
    if (this.params.mode === "cinematic") this.out = this.startCinematic(this.out);

    const cast = new Map<string, CastEntry>();
    for (const [id, a] of this.agents) cast.set(id, { name: a.name, responseDelayMs: this.body.responseDelays?.[id] ?? [600, 2500] });
    this.gateway = new HotelGateway({
      clock,
      rng: this.d.rng,
      executor: this.out,
      cast,
      roomOfChannel: (c) => /^room:(\d+)$/.exec(c)?.[1],
      roomOfAgent: (a) => mirror.roomOfRef(a),
      togetherForHuddle: (a, b) => {
        const va = mirror.view(a, clock.now())?.self;
        const vb = mirror.view(b, clock.now())?.self;
        return !!va && !!vb && mirror.roomOfRef(a) === mirror.roomOfRef(b) && Math.max(Math.abs(va.tile[0] - vb.tile[0]), Math.abs(va.tile[1] - vb.tile[1])) <= 2;
      },
      onLine: (line) => this.noteLine(line),
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

    const onConsult: OnConsult = (info) => {
      if (info.addressed) this.waitingOn.add(info.agentId);
      else this.waitingOn.delete(info.agentId);
      this.gateway.noteConsult(info.agentId, clock.now());
    };
    // The runtime's own hotel mode (ADR-0020 to 0025): split pulse with a reserved focus slot, the
    // room speech arbiter, bounded reads, the mirror as the source of each actor's `SpaceView`, and
    // the planner seam. The LLM budget registers per simulation in warn mode (`budget`), D11.
    const hotelOptions: HotelSimulationOptions = {
      pulseMode: "split",
      generateConcurrency: hotel.llm.concurrency,
      generateDeadlineMs: GENERATE_DEADLINE_MS,
      onConsult,
      // A second "say something" for an actor in a room where nothing new happened only gives the first one again.
      ambientGate: { quietMs: AMBIENT_QUIET_MS },
      // Decided once, where the hearing is stamped, so what the room hears matches what is delivered.
      chooseMode: (agentId, content, committed) => this.chooseMode(agentId, content, committed),
      wouldShout: (agentId, content) => chooseSpeechMode(this.arousal.get(agentId) ?? 0, content, this.memory.get(agentId) ?? {}, this.d.clock.now(), "say").mode === "shout",
      arbiter: {},
      spaceMirror: mirror,
      onAgentCommitted: (info) => this.onCommitted(info),
      clock: () => clock.now(),
      budget: { callsPerMinute: hotel.llm.softCallsPerMin, tokensPerHour: hotel.llm.softTokensPerHour },
      ...this.retention(),
    };
    const options = {
      agentRuntimeFactory: (registry: ConstructorParameters<typeof AgentRuntime>[1]) => {
        this.registry = registry;
        return new AgentRuntime(undefined, registry, (llm: LLMConfig, agentId: string) => this.provider(llm, agentId), { maxRetries: 2, roomThreshold: 0.7, strict: true, script: scriptGuardEnabled(), onGuard: (kind) => this.guardHits.set(kind, (this.guardHits.get(kind) ?? 0) + 1) });
      },
      extraGateways: { hotel: () => this.gateway, breaker: () => this.breaker.gateway },
      hotel: hotelOptions,
    };
    const built = await buildConfiguredSimulation(cfg, options);
    // The run was stopped while the simulation was being built (the hotel's run_end): nothing else may start.
    if (this.stopping) {
      await built.close().catch(() => undefined);
      return;
    }
    this.handle = built;
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
    if (this.stopping) return;
    this.startPlayerMemory();
    // Who is here already is known before anyone speaks: their rows seed the characters now.
    await this.playerMemory?.load(this.humansHere());
    if (this.stopping) return;
    // The title card covers the cast arriving and the first pulse's model latency.
    this.cine?.start();
    // Staggered arrival: whoever is due now spawns and walks in before the first pulse; the rest are out of the
    // schedule (never consulted) until their turn, when they spawn at the door and walk in like anyone else.
    const schedule = this.arrivalSchedule();
    const now = schedule.filter((a) => a.atMs <= 0).map((a) => a.ref);
    const later = schedule.filter((a) => a.atMs > 0);
    for (const a of later) {
      this.port.deferActor(a.ref);
      this.pendingArrivals.add(a.ref);
    }
    await this.spawnCast(now);
    if (this.stopping) {
      await this.walkOut();
      for (const ref of this.agents.keys()) this.space.unregisterActor(ref);
      return;
    }
    this.enterRoom(now);
    this.state = "running";
    this.loop.start();
    this.startBeats();
    this.startSpine();
    this.scheduleArrivals(later);
    this.d.logger.info("run running", { run: this.id, actors: this.agents.size, arriving_later: later.length });
  }

  /**
   * The drama director of this run (packet P2): built whenever the manager gives the run a host, and inert until the link
   * negotiated `drama.v1` and the hotel said the room's state. The scenario's `drama` block, or free play without one, is its law.
   */
  private startDrama(): void {
    // Whether the scene has the conservative default, an author's block, `off` or none is told once, here and in the run summary.
    this.d.logger.info("scenario drama", { run: this.id, ...summarizeRunDrama(resolveRunDrama(this.body)) });
    const host = this.d.drama;
    if (!host) return;
    const world = mirrorWorld(this.space, () => [...this.agents].filter(([, a]) => !a.gone).map(([ref]) => ref), () => this.d.clock.now());
    this.director = new DramaDirector({
      run: this.id,
      clock: this.d.clock,
      link: host.link,
      world,
      scenario: resolveRunDrama(this.body),
      session: host.hub.lastSession ?? null,
      logger: this.d.logger,
      record: this.frames.record,
    });
    // One mechanism: the hub hands every frame of this run to the director first, then to the planner side (ledger, reactions, memory of acts).
    host.hub.attach(this.id, composeDramaSinks(this.director, this.dramaSink));
  }

  /**
   * The scenario's script starts when the cast is in and the run is live: its seconds count from here. Each beat goes through the director as a
   * scenario-origin act, so every gate still applies (SCN-3, SCN-4); nothing is played when drama is not negotiated, and a replay builds no player.
   */
  private startBeats(): void {
    const beats = this.body.beats ?? [];
    if (!this.director || beats.length === 0) return;
    const startedAt = this.d.clock.now();
    this.startBeatCraft(beats, startedAt);
    this.beatPlayer = new BeatPlayer({
      clock: this.d.clock,
      startedAt,
      port: () => this.director,
      beats,
      drama: resolveRunDrama(this.body),
      wireOf: (ref) => this.space.avatarId(ref),
      walkCloser: (actor, target) => {
        const cmds = this.dramaSink.approach(actor, target, this.space.view(actor, this.d.clock.now())?.room, this.d.rng);
        if (cmds.length > 0) this.out.send(cmds);
        return cmds.length > 0;
      },
      logger: this.d.logger,
      onReport: (r) => {
        if (r.outcome === "played") this.beatOutcomes.played += 1;
        else this.beatOutcomes.dropped.set(r.why, (this.beatOutcomes.dropped.get(r.why) ?? 0) + 1);
        this.d.logger.info("authored beat", { run: this.id, beat: r.beat.id, kind: r.beat.kind, outcome: r.outcome, why: r.why, ...(r.detail ? { detail: r.detail } : {}) });
      },
    });
    this.beatPlayer.start();
  }

  /**
   * The scene spine (docs/plans/script-likeness.md): a scene with no authored beats gets a four-step arc worked out here, once, from what its
   * scenario already carries, shown to each actor as one steering note while its step is current. Inert when the scene has beats (their own
   * craft feed owns the slot), when drama is off or not negotiated (the notes ride the drama block of the prompt), with one actor, or with
   * `PERFECTMAN_SCENE_SPINE=0`. The recorder runs either way: it is what the run's script-likeness score is read from.
   */
  private startSpine(): void {
    const cast = this.body.config.agents;
    this.sceneStart = this.d.clock.now();
    this.scene = new SceneRecorder(cast.map((a) => a.promptProfile.displayName));
    if (!sceneSpineEnabled() || !this.director || (this.body.beats ?? []).length > 0 || resolveRunDrama(this.body).off) return;
    const language = cast[0]?.promptProfile.language === "en" ? "en" : "pt-BR";
    const built = buildSceneSpine({
      language,
      situation: cast[0]?.promptProfile.scenarioContext?.roomContext,
      cast: cast.map((a) => ({ id: a.id, name: a.promptProfile.displayName, objective: a.promptProfile.hiddenObjective })),
    });
    if (!built) return;
    this.spine = new SceneSpine(built, this.scene, this.sceneStart);
    const spine = this.spine;
    this.space.setCraft((agent, now) => spine.textFor(agent, now));
    this.d.logger.info("scene spine", { run: this.id, steps: built.steps.length, roles: built.roles });
  }

  /**
   * The slim KB's runtime feed (packages/kb README): when `PERFECTMAN_KB_CRAFT=1` (off by default, and independent of the draft prompt) and
   * `PERFECTMAN_KB_SLIM` points at a slim file, each authored beat that stands for a tactic gets up to two short style lines in the run's own
   * language, worked out here once and shown to that beat's actor only while the beat is near. Kept in memory for the run: never in the body,
   * the frame log or an artifact. Flag off, no file, no line in the run's language, or a file that does not read: nothing happens and no prompt changes.
   */
  private startBeatCraft(beats: readonly ScenarioBeat[], startedAt: number): void {
    if (!beatCraftEnabled()) return;
    const kb = loadSlimKbFromEnv({ warn: (message) => this.d.logger.warn(message) });
    if (!kb) return;
    const language = this.body.config.agents[0]?.promptProfile.language === "en" ? "en" : "pt-BR";
    const craft = BeatCraft.build(beats, kb, { language, cast: this.body.config.agents.length });
    if (!craft) return;
    this.space.setCraft((agent, now) => craft.textFor(agent, now - startedAt));
    this.d.logger.info("beat craft", { run: this.id, beats: craft.size });
  }

  /** What the planner asks to approve, veto or start an act (docs/drama/act-contract.md 11.5); undefined when drama is off for this process. */
  get dramaPort(): DramaDecisionPort | undefined {
    return this.director;
  }

  /** The scenario's script advanced: cut the scene (SCENE-2). A cinematic cut is not this and never calls it. */
  advanceScene(reason: string): SceneAdvance {
    return this.director?.advanceScene(reason) ?? { kind: "refused", why: "inert" };
  }

  /** The entrance schedule of this run's cast (see `arrivalSchedule`). */
  arrivalSchedule(): Arrival[] {
    const agents = this.body.config.agents.filter((a) => this.agents.has(a.id));
    return arrivalSchedule(agents, this.body.arrivals, this.d.timing?.arrivalStaggerMs ?? DEFAULT_ARRIVAL_STAGGER_MS, this.d.rng);
  }

  private scheduleArrivals(later: readonly Arrival[]): void {
    for (const a of later) {
      const timer = this.d.clock.setTimer(() => {
        this.arrivalTimers.delete(timer);
        this.arrivalChain = this.arrivalChain.then(() => this.arrive(a.ref));
      }, a.atMs);
      this.arrivalTimers.add(timer);
    }
  }

  /** One late cast member spawns at the door, walks in, and from then on takes part in the pulses. */
  private async arrive(ref: string): Promise<void> {
    if (this.stopping || this.state === "stopping" || this.state === "ended" || this.state === "failed") return;
    try {
      await this.spawnCast([ref]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.d.logger.warn("late arrival failed to spawn", { run: this.id, agent: ref, error: message });
      this.notice("arrival_failed", "warn", message.slice(0, 180));
      this.pendingArrivals.delete(ref);
      const a = this.agents.get(ref);
      if (a) a.gone = true;
      try {
        this.port.retireActor(ref);
      } catch {
        // already stopped
      }
      if (![...this.agents.values()].some((x) => !x.gone)) void this.stop("failed", "no actor could be spawned");
      return;
    }
    if (this.stopping) return;
    this.enterRoom([ref]);
    this.pendingArrivals.delete(ref);
    this.port.admitActor(ref);
    this.d.logger.info("actor arrived", { run: this.id, agent: ref });
  }

  // ---- player memory (D21, D47) -------------------------------------------------

  private startPlayerMemory(): void {
    const store = this.d.link.memoryStore;
    const handle = this.handle;
    if (!store || !handle) return;
    if (this.scenarioId === undefined) {
      // The version answer must say which scenario it belongs to (director-protocol.md 11.1); until it does, nothing is remembered.
      this.d.logger.warn("player memory is off: the scenario version did not name its scenario", { run: this.id });
      return;
    }
    const language = this.body.config.agents[0]?.promptProfile.language === "en" ? "en" : "pt-BR";
    this.playerMemory = new PlayerMemory({
      store,
      scenario: this.scenarioId,
      run: this.id,
      lang: language,
      simulationId: handle.simulationId,
      pulse: () => this.port.pulseIndex(),
      characters: new Set(this.agents.keys()),
      clock: this.d.clock,
      logger: this.d.logger,
      ...(this.d.timing?.memoryFlushEveryMs !== undefined ? { flushEveryMs: this.d.timing.memoryFlushEveryMs } : {}),
      seed: (character, user, memories) => this.seedMemories(character, user, memories),
      unseed: (character, user) => this.unseedMemories(character, user),
    });
  }

  /** Account ids of the people in the run's rooms right now (`h:<id>`, humans only). */
  private humansHere(): number[] {
    const ids = new Set<number>();
    for (const room of this.roomsInUse()) {
      for (const p of this.space.peopleIn(room, this.d.clock.now())) {
        if (p.kind !== "human") continue;
        const id = Number(p.ref.slice(2));
        if (p.ref.startsWith("h:") && Number.isInteger(id) && id > 0) ids.add(id);
      }
    }
    return [...ids];
  }

  /** Adds a character's memories about one person (replacing the ones it seeded for that person before). */
  private async seedMemories(character: string, user: number, memories: Memory[]): Promise<void> {
    const handle = this.handle;
    if (!handle) return;
    const state = await handle.repositories.agentStateRepo.get(handle.simulationId, character);
    if (!state) return;
    const prefix = `${MEMORY_ID_PREFIX}${user}_`;
    await handle.repositories.agentStateRepo.upsert({ ...state, memories: [...state.memories.filter((m) => !m.id.startsWith(prefix)), ...memories] });
  }

  private async unseedMemories(character: string, user: number | "all"): Promise<void> {
    const handle = this.handle;
    if (!handle) return;
    const state = await handle.repositories.agentStateRepo.get(handle.simulationId, character);
    if (!state) return;
    const prefix = user === "all" ? MEMORY_ID_PREFIX : `${MEMORY_ID_PREFIX}${user}_`;
    const kept = state.memories.filter((m) => !m.id.startsWith(prefix));
    if (kept.length !== state.memories.length) await handle.repositories.agentStateRepo.upsert({ ...state, memories: kept });
  }

  /** `wipe_memory`: the hotel deleted the rows and forwarded `<scenario> <user|all>`; drop the cache and write nothing back. */
  async wipeMemory(args: string): Promise<boolean> {
    const [scenario, who] = args.trim().split(/\s+/);
    if (!this.playerMemory || scenario === undefined || (scenario !== String(this.scenarioId) && scenario !== "all")) return false;
    const user = who === "all" || who === undefined ? "all" : Number(who);
    if (user !== "all" && !(Number.isInteger(user) && user > 0)) return false;
    await this.playerMemory.wipe(user);
    return true;
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

  /** The actor's prompt rendered again in another style or under another cap, for a failover link of a different window. */
  private rebuildPrompt(req: { agentId: string; input: AgentRuntimeInput; maxInputTokens: number | undefined; style: "full" | "compact" }): BuiltPrompt | undefined {
    const profile = this.registry?.getPromptProfile?.(req.agentId);
    if (!profile || !req.input) return undefined;
    return PromptBuilder.build(req.input, profile, "action_intent", req.maxInputTokens, req.style);
  }

  /** The runtime renders prompts with the config every actor was given (shared by reference), so moving its cap or style moves the trim and the prompt's size. */
  private setPromptCap(cap: number, promptStyle: "full" | "compact"): void {
    if (!this.hostLlm) return;
    this.hostLlm.maxInputTokens = cap;
    this.hostLlm.promptStyle = promptStyle;
  }

  /** The cinematic narrator's own chain (its links, spend and failovers); undefined outside cinematic mode and for the mock provider. */
  narratorLlmChain(): LlmChain | undefined {
    return this.narratorChain?.chain;
  }

  /** Per-link usage, cost and latency, and which link served: the chain's view of this run (empty for the mock provider). */
  llmChain(): LlmChain | undefined {
    return this.chain;
  }

  /** The mock model's reading of this run's scenario: the ladder ceiling and who may die (the kill itself is the director's call). Free play without a block: rungs up to 3, nobody dies. */
  private mockDrama(): MockDrama {
    const { effective } = resolveRunDrama(this.body);
    return { maxRung: effective.max_rung, mayDie: effective.may_die.filter((ref) => ref !== "@human") };
  }

  private provider(llm: LLMConfig, agentId: string): LLMProvider {
    if (this.chain && llm.providerType !== "mock") {
      return this.chain.provider(llm, agentId, {
        onSuccess: (r) => {
          const billed = r.responseHeaders?.[COST_HEADER];
          this.meter.recordSuccess(this.prices[r.model] ? r.model : llm.modelName, r.usage.inputTokens, r.usage.outputTokens, r.latencyMs, billed !== undefined ? Number(billed) : undefined);
        },
        onFailure: () => this.meter.recordFailure(),
      });
    }
    const inner: LLMProvider = llm.providerType === "mock" ? withMockBody(new MockLLMProvider(), this.mockConsults, { scenario: () => this.mockDrama(), memory: this.mockActs }) : createLLMProvider(llm, agentId);
    return this.d.governor.wrap(inner, {
      onSuccess: (r) => {
        this.meter.recordSuccess(this.prices[r.model] ? r.model : llm.modelName, r.usage.inputTokens, r.usage.outputTokens, r.latencyMs);
      },
      // The breaker counts failures from the operator stream, not from here (it also sees a call that threw before the provider).
      onFailure: () => this.meter.recordFailure(),
    });
  }

  private async spawnCast(refs: readonly string[]): Promise<void> {
    const { link, clock } = this.d;
    const mirror = this.space;
    const t = { ...SPAWN_DEFAULTS, ...this.d.timing };
    for (const ref of refs) {
      const a = this.agents.get(ref);
      if (!a || a.spawned) continue;
      if (this.stopping) return;
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

  /**
   * Walk the cast in. In the four wing rooms (43, 44, 45, 49) the first spots are fixed tiles beside
   * the furniture the scene named and the rest go to the farthest non-door zone from anyone placed.
   * Every other room is unchanged: a distinct, uncrowded tile near the middle of the room.
   */
  private enterRoom(refs: readonly string[]): void {
    const wing: Record<number, Array<[number, number]>> = {
      45: [[3, 1], [4, 5]],
      43: [[10, 3], [3, 6]],
      44: [[1, 1], [3, 5]],
      49: [[3, 1], [5, 6]],
    };
    const { clock } = this.d;
    const mirror = this.space;
    const taken = this.enterTaken;
    const spots = wing[this.params.room];
    let spotAt = taken.size;
    const occupied: Array<readonly [number, number]> = [...taken].flatMap((key) => {
      const [x, y] = key.split(",").map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? [[x, y] as [number, number]] : [];
    });
    const cmds = [];
    for (const ref of refs) {
      const view = mirror.view(ref, clock.now());
      const room = view?.room;
      if (!room) continue;
      let near: readonly [number, number];
      let radius: number;
      if (!spots) {
        const centre = room.zones.find((z) => z.kind === "middle")?.center ?? [Math.floor(room.w / 2), Math.floor(room.h / 2)];
        near = [centre[0], centre[1]];
        radius = 4;
      } else if (spotAt < spots.length) {
        near = spots[spotAt]!;
        spotAt += 1;
        radius = 1;
      } else {
        const zones = room.zones.filter((z) => z.kind !== "door" && z.kind !== "middle");
        const pool = zones.length >= 2 ? zones : room.zones.filter((z) => z.kind !== "door");
        const door = room.zones.find((z) => z.kind === "door")?.center;
        let best = pool[0];
        let bestDist = -1;
        for (const z of pool) {
          const dist = occupied.length === 0 ? (door ? chebyshev(z.center, door) : 0) : Math.min(...occupied.map((p) => chebyshev(z.center, p)));
          if (dist > bestDist) {
            bestDist = dist;
            best = z;
          }
        }
        near = best?.center ?? [Math.floor(room.w / 2), Math.floor(room.h / 2)];
        radius = Math.min(best?.radius ?? 2, 2);
      }
      const to = pickTile({ room, self: ref, near, radius, rng: this.d.rng, avoid: taken });
      if (!to) continue;
      taken.add(tileKey(to));
      occupied.push(to);
      cmds.push({ agentId: ref, cmd: "walk" as const, to, plan: `${ref}:enter` });
    }
    this.out.send(cmds);
  }

  /** Cinematic mode (D18, D19): the Director films the run and releases speech on the playback clock. */
  private startCinematic(executor: GatewayExecutor): GatewayExecutor {
    const { clock, link, hotel } = this.d;
    const mirror = this.space;
    const first = this.body.config.agents[0]?.promptProfile;
    const language = first?.language === "en" ? "en" : "pt-BR";
    const cast = new Map([...this.agents].map(([ref, a]) => [ref, { name: a.name }]));
    this.cineWorld = new MirrorCineWorld(mirror, () => clock.now(), cast);
    this.trackSink = new TrackFileSink(join(hotel.dataDir, "runs", String(this.id), TRACK_FILE), (err) =>
      this.d.logger.warn("director track write failed", { run: this.id, error: err instanceof Error ? err.message : String(err) }));
    // The injected call (tests, tools) wins; otherwise the run's own: the picked model first, the configured chain behind it.
    this.narratorChain = this.d.narratorLlm ? undefined : makeNarratorLlm({ links: withPickedModel(linksOf(hotel.llm), this.params.model), clock, runId: this.id, governor: this.d.governor, prices: this.prices, logger: this.d.logger });
    // The four wing rooms use the fallback card (the title and the names). A model caption was inventing a second plot.
    const narratorOff = this.params.room === 45 || this.params.room === 43 || this.params.room === 44 || this.params.room === 49;
    const narratorLlm = narratorOff ? undefined : (this.d.narratorLlm ?? this.narratorChain?.call);
    const narrator = new Narrator({ clock, language, ...(narratorLlm ? { llm: narratorLlm, deadlineMs: NARRATOR_CHAIN_DEADLINE_MS } : {}), logger: this.d.logger });
    this.narrator = narrator;
    this.cine = new CinematicDirector({
      run: this.id,
      home: this.params.room,
      clock,
      world: this.cineWorld,
      narrator,
      send: (m) => link.send(m),
      logger: this.d.logger,
      config: { ...this.d.timing?.cine, language },
      premise: this.body.title,
      trackSink: this.trackSink.write,
    });
    return this.cine.wrapExecutor(executor);
  }


  // ---- pulses and the body ----------------------------------------------------

  private async pulse(opts: Parameters<RuntimePort["runPulse"]>[0]): Promise<void> {
    if (this.state !== "running") return;
    // D18: the engine runs one to two pulses ahead of playback, no further.
    if (this.cine && !this.cine.wantsMore()) return;
    // Anyone who walked into the run's rooms since the last pulse is looked up (in the background); changed rows are written back now and then.
    if (this.playerMemory) {
      void this.playerMemory.load(this.humansHere());
      void this.playerMemory.maybeFlush()?.catch(() => undefined);
    }
    this.gateway.notePulseStart(this.d.clock.now());
    await this.port.runPulse(opts);
    this.pulseErrors = 0;
    this.frames.snapshot(this.space);
    // Actors the model was not consulted for still fidget, face the speaker and drift (embodiment.md 7.1).
    if (opts.reason === "base") await this.sweepIdle();
  }

  requestFocused(ids: string[], reason: "human_chat" | "body_arrived" = "human_chat"): void {
    if (this.state === "running" && !this.linkDown) this.loop.requestFocused(ids, reason);
  }

  /** Event id of an actor line to the room occupant it was aimed at (`addresseeIds`), until the line is delivered. */
  private readonly addressees = new Map<string, string>();
  /** The built scenario's persona registry: the authored goal text the initiative rules read. */
  private registry: ConstructorParameters<typeof AgentRuntime>[1] | undefined;
  /** Actors whose current model call answers a line addressed to them: a person is waiting. */
  private readonly waitingOn = new Set<string>();
  private readonly earlyLines = new Map<string, { agentId: string; mode: SpeechMode; eventId?: string; room: string }>();

  /** Who a committed line is aimed at: the author it replies to, a named target, or someone it names, when they share the room. */
  private noteAddressee(ref: string, intent: ActionIntent, mine: CommittedEvent[], space: SpaceView): void {
    for (const e of mine) {
      if (e.type !== "message_sent" && e.type !== "reply_sent") continue;
      const named = (e.payload as Record<string, unknown>)["addresseeIds"];
      // A whisper back is for the person who whispered, who is not one of the cast the engine names.
      const whisperedTo = (e.payload as Record<string, unknown>)["whisperTo"];
      const candidates = [whisperedTo, intent.replyToActorId, ...intent.personTargets, ...(Array.isArray(named) ? named : [])];
      const to = candidates.find((id): id is string => typeof id === "string" && id !== ref && (space.room?.occupants.some((o) => o.ref === id) ?? false));
      if (to) this.addressees.set(e.id, to);
      if (this.addressees.size > 256) this.addressees.delete(this.addressees.keys().next().value as string);
      const early = this.earlyLines.get(e.id);
      if (early && to) {
        this.earlyLines.delete(e.id);
        this.noteLine(early);
      }
    }
  }

  /**
   * `ref` is in an exchange with `otherRef`: remember it (the planner keeps facing them while it lasts) and turn
   * to them now, within the command budget. No model call is involved, so it lands within a pulse of the line.
   */
  private faceInterlocutor(ref: string, otherRef: string, maxTiles?: number): void {
    if (!this.agents.has(ref) || this.agents.get(ref)?.gone || this.state !== "running") return;
    const now = this.d.clock.now();
    const space = this.space.view(ref, now);
    if (!space) return;
    const mem = noteExchange(this.memory.get(ref) ?? {}, otherRef, now);
    const cmds = planFacing({ space, now }, otherRef, maxTiles);
    this.memory.set(ref, cmds.length > 0 ? updateMemory(mem, cmds, now, space.self?.tile ?? [0, 0]) : mem);
    if (cmds.length > 0) this.out.send(cmds);
  }

  /**
   * An addressed line reached the wire: log who it was for, whether they share the room and how far
   * away they stood, so the earshot and facing probes have something to measure (embodiment.md 10).
   */
  private noteLine(line: { agentId: string; mode: SpeechMode; eventId?: string; room: string }): void {
    const eventId = line.eventId;
    if (!eventId) return;
    const to = this.addressees.get(eventId);
    if (!to) {
      // A line the model answered slower than the persona's typing delay leaves the queue inside the commit,
      // before the planner seam has seen the intent; the frame is written when that arrives.
      this.earlyLines.set(eventId, line);
      if (this.earlyLines.size > 64) this.earlyLines.delete(this.earlyLines.keys().next().value as string);
      return;
    }
    this.addressees.delete(eventId);
    if (line.mode !== "whisper") {
      // Both turn to each other: the listener (if one of the cast) and the speaker.
      this.faceInterlocutor(to, line.agentId);
      this.faceInterlocutor(line.agentId, to, to.startsWith("h:") ? Number.POSITIVE_INFINITY : undefined);
    }
    const room = this.space.view(line.agentId, this.d.clock.now())?.room;
    const me = room?.occupants.find((o) => o.ref === line.agentId);
    const them = room?.occupants.find((o) => o.ref === to);
    const sameRoom = me !== undefined && them !== undefined;
    this.frames.record("out", line.room, "chat", {
      agentId: line.agentId,
      mode: line.mode,
      toRef: to,
      sameRoom,
      distance: me && them ? Math.max(Math.abs(me.tile[0] - them.tile[0]), Math.abs(me.tile[1] - them.tile[1])) : -1,
    });
  }

  private chooseMode(agentId: string, content: string, committed: SpeechMode): SpeechMode {
    const mem = this.memory.get(agentId) ?? {};
    const choice = chooseSpeechMode(this.arousal.get(agentId) ?? 0, content, mem, this.d.clock.now(), committed);
    if (choice.mode === "shout") this.memory.set(agentId, { ...mem, lastShoutAt: this.d.clock.now() });
    return choice.mode;
  }

  /** `observer` may hold a grievance against `offender` because of what was said (errata P7): both are this run's actors, the scenario lets `observer` target `offender`, drama is not off. */
  private mayProvoke(observer: string, offender: string): boolean {
    if (!this.body) return false;
    this.runDrama ??= resolveRunDrama(this.body);
    if (this.runDrama.off) return false;
    return this.agents.has(observer) && this.agents.has(offender) && this.runDrama.effective.may_target.some(([a, b]) => a === observer && b === offender);
  }

  /** The actor's committed lines and the moves of its body, for the run's script-likeness and the spine's progress gate. */
  private recordScene(ref: string, info: AgentCommitInfo, mine: readonly CommittedEvent[]): void {
    const scene = this.scene;
    if (!scene) return;
    const now = this.d.clock.now() - this.sceneStart;
    const name = this.agents.get(ref)?.name ?? ref;
    for (const e of mine) {
      const content = (e.payload as Record<string, unknown>)["content"];
      if ((e.type === "message_sent" || e.type === "reply_sent") && typeof content === "string" && content.trim() !== "") scene.say(name, content, now);
    }
    const b = info.body?.accepted;
    if (b && (b.act !== undefined || b.move !== undefined || b.posture !== undefined || b.gesture !== undefined)) scene.act(name, now);
  }

  /** The lines an actor spoke, handed to the body's grievance ledger (errata P7): who they name, who they are for, and what mode. */
  private noteSpoken(ref: string, intent: ActionIntent | undefined, events: ReadonlyArray<Pick<SimulationEvent, "actorId" | "type" | "payload">>): void {
    const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    for (const e of events) {
      if (e.actorId !== ref || (e.type !== "message_sent" && e.type !== "reply_sent")) continue;
      const p = e.payload as Record<string, unknown>;
      const content = typeof p["content"] === "string" ? p["content"] : "";
      const replyTo = typeof p["replyToActorId"] === "string" ? [p["replyToActorId"]] : intent?.replyToActorId ? [intent.replyToActorId] : [];
      const whisper = typeof p["whisperTo"] === "string";
      this.dramaSink.noteSpoken({
        speaker: ref,
        content,
        addressees: [...new Set([...(whisper ? [p["whisperTo"] as string] : []), ...replyTo, ...strs(p["addresseeIds"]), ...strs(p["personTargets"])])],
        mentioned: strs(p["mentionedAgentIds"]),
        ...(whisper ? { mode: "whisper" as const } : {}),
      });
    }
  }

  /** The block kept the rest of an intent and lost the handles that named nothing in view: counted (errata P7). */
  private countStripped(blocked: readonly BlockedReason[] | undefined): void {
    for (const b of blocked ?? []) if (b.code === "unknown_ref" && b.part !== "act") this.earshot.stripped++;
  }

  /**
   * The planner seam (hotel-package.md 7, embodiment.md 7): the runtime calls this
   * right after one actor's intent was resolved and appended, with the validated
   * `body` block and the view it decided from. Nothing here awaits.
   */
  onCommitted(info: AgentCommitInfo): void {
    const ref = info.agentId;
    if (!this.agents.has(ref) || this.agents.get(ref)?.gone || this.state === "stopping" || this.state === "ended") return;
    const mine = info.committedEvents.filter((e) => e.actorId === ref);
    this.recordScene(ref, info, mine);
    // What the last turn's refusal said has been read by this turn's prompt (errata P7).
    const told = this.space.bodyOf(ref, this.d.clock.now());
    if (told.lastBlocked) delete told.lastBlocked;
    this.countStripped(info.body?.blocked);
    this.noteSpoken(ref, info.intent, mine);
    if (mine.some((e) => e.type === "message_sent" || e.type === "reply_sent")) this.noOpStreak.set(ref, 0);
    else if (mine.some((e) => e.type === "no_op_recorded")) this.noOpStreak.set(ref, (this.noOpStreak.get(ref) ?? 0) + 1);
    this.arousal.set(ref, info.agentState.coreMood.arousal);
    if (info.actionEmotions) this.tendencies.set(ref, info.actionEmotions);
    // A paused run commits nothing new to the body: no planning until it resumes.
    if (this.state === "paused") return;
    this.cineWorld?.noteMood(ref, moodOfState(info.agentState));
    const space = info.space ?? this.space.view(ref, this.d.clock.now());
    if (!space) return;
    this.noteAddressee(ref, info.intent, mine, space);
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
    carried?: { intent?: ActionIntent; bodyIntent: BodyIntent; handles: BodyHandleMap },
  ): PlannedCommand[] {
    const now = this.d.clock.now();
    this.plannedThisPulse.add(ref);
    const mem = { ...(this.memory.get(ref) ?? {}) };
    mem.firstPlanAt ??= now;
    this.memory.set(ref, mem);
    const motive = carried?.intent?.privateMotiveSummary;
    const door = space.room?.door;
    const cmds = this.dramaSink.planFor(ref, {
      space,
      agentState,
      committedEvents,
      now,
      rng: this.d.rng,
      memory: mem,
      noOpStreak: this.noOpStreak.get(ref) ?? 0,
      drives: { goalText: this.goalText(ref), ...(motive ? { motive } : {}), homeRoom: this.home },
      ...optional("actionEmotions", this.tendencies.get(ref)),
      ...(carried ?? {}),
    });
    if (cmds.length === 0) return cmds;
    this.memory.set(ref, updateMemory(mem, cmds, now, space.self?.tile ?? [0, 0], space.room?.id, door));
    this.out.send(cmds);
    return cmds;
  }

  /** What the author wrote this person wants: identity frame and hidden objective. */
  private goalText(ref: string): string {
    const profile = this.registry?.getPromptProfile?.(ref);
    if (!profile) return "";
    return [profile.identityFrame, profile.hiddenObjective?.description].filter((t): t is string => typeof t === "string" && t.length > 0).join(" ");
  }

  /** After a base pulse: the automatic body rules for every actor the planner has not run for. */
  private async sweepIdle(): Promise<void> {
    const handle = this.handle;
    const planned = new Set(this.plannedThisPulse);
    this.plannedThisPulse.clear();
    if (!handle) return;
    const now = this.d.clock.now();
    for (const ref of this.agents.keys()) {
      if (planned.has(ref) || this.state !== "running" || this.agents.get(ref)?.gone) continue;
      const state: AgentState | null = await handle.repositories.agentStateRepo.get(handle.simulationId, ref);
      const space = this.space.view(ref, now);
      if (!state || !space) continue;
      this.arousal.set(ref, state.coreMood.arousal);
      this.planFor(ref, state, [], space);
    }
    this.plannedThisPulse.clear();
  }

  /**
   * The guards' counts as flat run counters, in the chain's `llm_guard_<reason>` naming. Always all of them, zeros
   * included, so a run summary that shows no repeats says so. Flags count candidates (a first answer or a retry; a repeat delivered to a person who asked is still flagged);
   * `blocked`/`dropped` count turns that ended without a line; `stall_nudge` counts prompts that carried the stall line.
   */
  private guardCounters(): Record<string, number> {
    const n = (k: GuardKind): number => this.guardHits.get(k) ?? 0;
    return {
      llm_guard_repeat_own: n("repeat_own"),
      llm_guard_repeat_room: n("repeat_room"),
      llm_guard_phrase_loop: n("phrase_loop"),
      llm_guard_garble: n("garble"),
      llm_guard_repeat_blocked: n("repeat_blocked"),
      llm_guard_garble_dropped: n("garble_dropped"),
      llm_guard_held_repeat: n("held_repeat"),
      llm_stall_nudges: n("stall_nudge"),
      // The script checks: a retry because a line was over its word cap (and the lines cut at a sentence boundary after it), said nothing new,
      // brought back a phrase or simile the room already had (and the lines swapped for a short reaction), or asked while it owed an answer.
      llm_len_retry: n("len_retry"),
      llm_len_trimmed: n("len_trimmed"),
      llm_motif_retry: n("motif_retry"),
      llm_novelty_retry: n("novelty_retry"),
      llm_motif_reaction: n("motif_reaction"),
      llm_debt_note: n("debt_note"),
      llm_debt_retry: n("debt_retry"),
      llm_debt_stripped: n("debt_stripped"),
    };
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
    if (walkPlans.size === 0) {
      // No walk was planned (no free tile beside the addressee, or no way there): nothing will bring the speaker, so the line is not held for the whole grace.
      // If the two have come within earshot since the line was decided it is said now; otherwise it is dropped, and counted.
      const gap = this.gapTo(ref, deferral.targetRef);
      if (gap !== undefined && gap <= SAY_CLEAR_TILES) {
        this.pending.set(ref, { intent, targetRef: deferral.targetRef, walkPlans, timer: this.d.clock.setTimer(() => undefined, 0), rewalks: 0 });
        void this.releaseSpeech(ref);
      } else void this.dropSpeech(ref, intent.id, gap === undefined ? "left_room" : "no_walk");
      return;
    }
    this.earshot.approaches++;
    const wait = Math.max(0, deferral.expiresAt - this.d.clock.now());
    const timer = this.d.clock.setTimer(() => void this.expireSpeech(ref, intent.id), wait);
    this.pending.set(ref, { intent, targetRef: deferral.targetRef, walkPlans, timer, rewalks: 0 });
    // The typing bubble would hang over a walk; it comes back at arrival.
    this.gateway.stopTyping(ref);
  }

  /**
   * A line that is not said because its speaker never got within earshot of the addressee (errata P7): counted by why (`earshot_drops_<why>`) and logged as the
   * operator's `body_blocked` with `not_in_earshot` and the why as its detail. `no_walk`: nothing could be planned; `expired`: the walk did not end in time;
   * `moved_off`: the addressee kept walking away; `left_room`: they are no longer in the room.
   */
  private async dropSpeech(ref: string, intentId: string, why: "no_walk" | "expired" | "moved_off" | "left_room"): Promise<void> {
    this.earshot.drops++;
    this.earshot.dropped.set(why, (this.earshot.dropped.get(why) ?? 0) + 1);
    await this.appendBodyEvent("body_blocked", ref, { intentId, reasons: [{ code: "not_in_earshot", part: "speech", detail: why }] }, false);
  }

  private dropPending(ref: string): PendingSpeech | undefined {
    const held = this.pending.get(ref);
    held?.timer.cancel();
    this.pending.delete(ref);
    return held;
  }

  private async expireSpeech(ref: string, intentId: string): Promise<void> {
    const held = this.pending.get(ref);
    if (held?.intent.id !== intentId) return;
    const gap = this.gapTo(ref, held.targetRef);
    // The speaker is within earshot by now, whatever the walk's own arrival said: the line is said, not dropped.
    if (gap !== undefined && gap <= SAY_CLEAR_TILES) return this.releaseSpeech(ref);
    // The walk did not end in time (it was replaced, or slow): one more walk before the line is given up, if the addressee is in the room and still out of earshot.
    if (gap !== undefined && (await this.rewalk(ref, held))) return;
    if (this.pending.get(ref) !== held) return;
    this.pending.delete(ref);
    await this.dropSpeech(ref, intentId, gap === undefined ? "left_room" : "expired");
  }

  /** Tiles between the speaker and the person a held line is for; undefined when they are not in the same room. */
  private gapTo(ref: string, targetRef: string): number | undefined {
    const room = this.space.view(ref, this.d.clock.now())?.room;
    const me = room?.occupants.find((o) => o.ref === ref);
    const them = room?.occupants.find((o) => o.ref === targetRef);
    return me && them ? chebyshev(me.tile, them.tile) : undefined;
  }

  /**
   * The walk was planned toward where the addressee stood, and they may have moved since. The line goes out only when
   * the speaker is within the say radius of them now (the same measure as at commit); if not, the walk is planned again
   * a bounded number of times, and a line whose addressee left the room or keeps moving off is dropped like an expired one.
   */
  private async rewalk(ref: string, held: PendingSpeech): Promise<boolean> {
    const handle = this.handle;
    if (!handle || held.rewalks >= MAX_HELD_REWALKS) return false;
    const now = this.d.clock.now();
    const space = this.space.view(ref, now);
    const state = await handle.repositories.agentStateRepo.get(handle.simulationId, ref);
    if (!space || !state || this.pending.get(ref) !== held) return false;
    held.rewalks++;
    const cmds = this.planFor(ref, state, [], space, { intent: held.intent, bodyIntent: { order: "move_then_speak", move: { kind: "approach", target: "p1", band: "personal" } }, handles: { p1: { kind: "person", ref: held.targetRef } } });
    let walking = false;
    for (const c of cmds) {
      if (c.cmd === "walk" && c.plan) {
        held.walkPlans.add(c.plan);
        walking = true;
      }
    }
    if (!walking) return false;
    this.earshot.approaches++;
    held.timer.cancel();
    held.timer = this.d.clock.setTimer(() => void this.expireSpeech(ref, held.intent.id), REWALK_GRACE_MS);
    return true;
  }

  private async releaseSpeech(ref: string): Promise<void> {
    const waiting = this.pending.get(ref);
    if (!waiting || this.state === "stopping" || this.state === "ended") {
      this.dropPending(ref);
      return;
    }
    const gap = this.gapTo(ref, waiting.targetRef);
    if (gap === undefined || gap > SAY_CLEAR_TILES) {
      if (gap !== undefined && (await this.rewalk(ref, waiting))) return;
      this.dropPending(ref);
      await this.dropSpeech(ref, waiting.intent.id, gap === undefined ? "left_room" : "moved_off");
      return;
    }
    const held = this.dropPending(ref);
    if (!held) return;
    // Typing again, so the line lands after the persona's delay, as any other reply.
    // The walk already cost the time a typing bubble would: the line lands right away.
    this.gateway.noteConsult(ref, this.d.clock.now() - DEFERRED_TYPING_HEAD_START_MS);
    try {
      const resolved = await this.port.resolveDeferred(ref, held.intent);
      if (resolved.committedEvents.some((e) => e.type === "repetition_blocked")) this.guardHits.set("held_repeat", (this.guardHits.get("held_repeat") ?? 0) + 1);
      this.noteSpoken(ref, held.intent, resolved.committedEvents);
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
    // Walking up to someone ends facing wherever the last step pointed: turn to the person it was talking with.
    const talking = this.memory.get(agentId)?.interlocutor;
    if (talking && talking.until > this.d.clock.now()) this.faceInterlocutor(agentId, talking.ref, talking.ref.startsWith("h:") ? Number.POSITIVE_INFINITY : undefined);
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
    const humanId = info.withHuman && info.withRef.startsWith("h:") ? Number(info.withRef.slice(2)) : NaN;
    if (Number.isInteger(humanId)) {
      const name = this.space.peopleIn(this.space.roomOfRef(info.agentId) ?? this.home, this.d.clock.now()).find((p) => p.ref === info.withRef)?.name ?? "";
      this.playerMemory?.notePair({ user: humanId, name, character: info.agentId, kind: info.kind, outcome: info.outcome });
    }
    if (refused && info.withHuman) {
      // A human who turned the act down is left alone for a minute (planner memory).
      const mem = this.memory.get(info.agentId) ?? {};
      this.memory.set(info.agentId, { ...mem, pairRefusedAt: { ...mem.pairRefusedAt, [info.withRef]: this.d.clock.now() } });
    }
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
      const outcome = await this.ingestor.handleHumanChat(frame);
      if (outcome.kind === "ingested") {
        // One frame per addressed actor, so the facing probe can ask whether each turned to the person who spoke.
        for (const to of outcome.addressed) {
          this.frames.record("in", String(frame.room), "human_chat", { ref: `h:${frame.from.id}`, mode: frame.mode, toRef: to });
          // The addressed actor turns to whoever spoke right away, not after its own model call.
          if (outcome.heardBy.includes(to)) this.faceInterlocutor(to, `h:${frame.from.id}`, Number.POSITIVE_INFINITY);
        }
      }
      if (outcome.kind === "ingested" && frame.from.id > 0) {
        void this.playerMemory?.load([frame.from.id]);
        this.playerMemory?.noteLine({ user: frame.from.id, name: frame.from.name, heardBy: outcome.heardBy, addressed: outcome.addressed, text: frame.text });
      }
    } catch (err) {
      this.d.logger.error("ingest failed", { run: this.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  handleFrame(frame: HotelFrame): void {
    if (frame.t === "actor_gone") {
      const ref = this.space.refOfAvatar(frame.actor);
      const a = this.agents.get(ref);
      if (a) a.gone = true;
      this.goneWaiters.delete(ref);
      if (this.goneWaiters.size === 0) this.goneResolve?.();
      // The executor clears its plans by ref, so it must see the frame before the ref is unregistered.
      this.executor?.handleFrame(frame);
      this.space.unregisterActor(ref);
      if (a) this.onActorRemoved(ref);
      return;
    }
    this.executor?.handleFrame(frame);
  }

  /**
   * The hotel removed an actor (an admin kick, a despawn): it is dropped from
   * scheduling so it never costs another model call, and the run ends, walking
   * out whoever is left, once nobody remains.
   */
  private onActorRemoved(ref: string): void {
    if (this.state === "stopping" || this.state === "ended" || this.state === "failed") return;
    this.dropPending(ref);
    this.gateway?.stopTyping(ref);
    let remaining = [...this.agents.values()].filter((x) => !x.gone).length;
    try {
      // Cast members who have not walked in yet are not scheduled, but they are still coming.
      remaining = Math.min(remaining, (this.port?.retireActor(ref) ?? remaining) + this.pendingArrivals.size);
    } catch (err) {
      this.d.logger.warn("actor not retired", { run: this.id, agent: ref, error: err instanceof Error ? err.message : String(err) });
    }
    if (remaining === 0) void this.stop("stopped", "no actors remain");
  }

  mirrorMoved(ref: string): void {
    this.executor?.onMoved(ref);
  }

  mirrorLeft(ref: string): void {
    this.executor?.onLeft(ref);
    this.dramaSink.left(ref);
  }

  humanTyping(room: RoomId, typing: boolean, at: number): void {
    if (this.rooms.has(room)) this.port?.noteHumanTyping(this.roomChannel(room), typing, at);
  }

  // ---- lifecycle --------------------------------------------------------------

  /** The link to the hotel went down or came back; the run holds still, it does not pause. */
  setLinkDown(down: boolean): void {
    this.linkDown = down;
    // A wipe forwarded while the link was down is lost: the cache is checked against the hotel before it writes again.
    if (down) this.playerMemory?.markDisconnected();
    else void this.playerMemory?.resync();
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
    this.gateway?.setPaused(true);
    this.cine?.pause();
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
    this.gateway?.setPaused(false);
    this.cine?.resume();
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

  /** Which model and tier each link was, and what was picked: the audit trail `llm_served_<link>` alone cannot give (it says `pick`, not which model). */
  private llmManifest(chain: LlmChain): NonNullable<ReplayManifest["llm"]> {
    return {
      ...(this.pickNote ? { picked_model: this.pickNote.model, picked_tier: this.pickNote.tier, picked_actors: this.pickNote.actors } : {}),
      links: Object.fromEntries(chain.snapshot().links.map((l) => [l.name, { model: l.model, tier: l.tier }])),
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
  stop(reason: SidecarEndReason, summary?: string, opts: StopOptions = {}): Promise<void> {
    this.stopping ??= this.teardown(reason, summary, opts);
    return this.stopping;
  }

  private async teardown(reason: SidecarEndReason, summary: string | undefined, opts: StopOptions): Promise<void> {
    const { link, clock, hotel } = this.d;
    const mirror = this.space;
    this.state = "stopping";
    this.pendingEnd = reason;
    try {
      this.breaker?.dispose();
      this.beatPlayer?.stop();
      this.unsubscribeBudget?.();
      // Nobody walks in after a stop; one already spawning is waited for (bounded), so the walk-out below sees it.
      for (const timer of this.arrivalTimers) timer.cancel();
      this.arrivalTimers.clear();
      this.pendingArrivals.clear();
      await Promise.race([this.arrivalChain, sleepOn(clock, (this.d.timing?.spawnTimeoutMs ?? SPAWN_DEFAULTS.spawnTimeoutMs) + 500)]);
      for (const ref of [...this.pending.keys()]) this.dropPending(ref);
      this.drained = (await this.loop?.stop()) ?? true;
      // The film plays out its buffer only when the scenario ended itself; an admin stop closes it now.
      if (this.cine && link.connected) await this.cine.stop(reason, reason === "completed");
      else await this.cine?.stop(reason, false);
      await this.trackSink?.flush();

      // Walk-out (bounded). When the hotel ended the run it walks them out itself; a dead link cannot.
      if (!opts.byHotel && link.connected) await this.walkOut();
      this.gateway?.dispose();
      this.executor?.dispose();
      this.dramaSink.dispose();

      let events: CommittedEvent[] = [];
      try {
        events = (await this.port?.getEvents()) ?? [];
        await this.port?.stop();
      } catch (err) {
        this.d.logger.warn("runtime stop failed", { run: this.id, error: err instanceof Error ? err.message : String(err) });
      }
      // The people's rows are saved before the run is closed (bounded: a slow hotel does not hold the stop).
      if (this.playerMemory) {
        await Promise.race([this.playerMemory.flush().catch(() => 0), sleepOn(clock, MEMORY_FLUSH_BOUND_MS)]);
      }
      const m = this.meter.snapshot();
      this.scriptScore = this.scoreScene();
      const sl = this.scriptScore;
      if (this.chain) this.d.logger.info("run llm usage", { run: this.id, calls: m.calls, costUsd: m.costUsd, p50Ms: m.p50Ms, p95Ms: m.p95Ms, ...(this.pickNote ? { pickedTier: this.pickNote.tier } : {}), ...(sl ? { scriptLikeness: sl.score } : {}), chain: this.chain.snapshot() });
      if (sl) this.d.logger.info("run script likeness", { run: this.id, ...scriptLikenessManifest(sl), ...(this.spine ? { spineStep: this.spine.step } : {}) });
      try {
        const written = await writeRunArtifacts(hotel.dataDir, this.id, events, this.frames.log, {
          run: this.id,
          simulationId: this.handle?.simulationId ?? `hotel-run-${this.id}`,
          scenarioVersion: this.params.scenarioVersion,
          scenarioSha256: bodyDigest(this.body ? scrubConfigForArtifact(this.body.config) : null),
          finalState: opts.interrupted ? "interrupted" : reason === "failed" ? "failed" : "ended",
          stopReason: opts.interrupted ? "sidecar_shutdown" : reason,
          startedAt: this.startedAt,
          mode: this.params.mode,
          home: this.params.room,
          actors: Object.fromEntries([...this.agents.keys()].flatMap((ref) => {
            const id = mirror.avatarId(ref);
            return id === undefined ? [] : [[ref, id] as const];
          })),
          endedAt: clock.now(),
          pulse: this.port?.pulseIndex() ?? 0,
          ...(this.chain ? { llm: this.llmManifest(this.chain) } : {}),
          ...(sl ? { script_likeness: scriptLikenessManifest(sl) } : {}),
          ...(this.spine ? { scene_spine: { step: this.spine.step, advances: this.spine.advances.map((a) => ({ step: a.step, at_ms: a.atMs, via: a.via })) } } : {}),
          counters: { llm_calls: m.calls, llm_failures: m.failures, ...(this.chain?.counters() ?? {}), ...this.guardCounters(), ...this.scriptScoreCounters(), ...(this.narrator ? { narrator_calls: this.narrator.calls, narrator_fallbacks: this.narrator.fallbacks, narrator_repaired: this.narrator.repaired } : {}), undelivered_committed: this.gateway?.undeliveredCommitted ?? 0, commands_sent: this.executor?.stats.sent ?? 0, ...this.scriptCounters(), ...this.bodyCounters() },
          drama: summarizeRunDrama(resolveRunDrama(this.body)),
          ...(this.drained ? {} : { dirty: true as const }),
        }, this.eventSink);
        await link.registerArtifacts(this.id, written);
        // The run can be shown again (D39): the admin's panel gets its Replay button.
        link.send({ t: "ui_push", run: this.id, to: { admin: this.params.admin.id }, ui: { k: "replay_ready", run: this.id } });
      } catch (err) {
        this.d.logger.warn("artifacts not written", { run: this.id, error: err instanceof Error ? err.message : String(err) });
      }
      await this.handle?.close();
    } finally {
      this.d.drama?.hub.detach(this.id);
      for (const ref of this.agents.keys()) mirror.unregisterActor(ref);
      link.untrackRun(this.id);
      this.state = reason === "failed" ? "failed" : "ended";
      // An interrupted run says nothing: a run_end would read as a deliberate stop. The hotel marks it `interrupted` itself
      // (grace expiry, or the next hello_ack that does not resume it; D41).
      if (!opts.byHotel && !opts.interrupted) link.send({ t: "run_end", run: this.id, reason, ...(summary ? { summary } : {}) });
      this.d.onEnded(this, reason);
    }
  }

  /** The run's script-likeness as flat counters (`script_likeness_score`, `_percentile`, one per sub-score) and how far the scene spine got. */
  private scriptScoreCounters(): Record<string, number> {
    const out: Record<string, number> = {};
    const sl = this.scriptScore;
    if (sl) {
      out["script_likeness_score"] = Math.round(sl.score);
      out["script_likeness_percentile"] = Math.round(sl.percentile);
      for (const [k, v] of Object.entries(sl.sub)) out[`script_likeness_${k}`] = Math.round(v);
    }
    if (this.spine) {
      out["scene_spine_step"] = this.spine.step;
      out["scene_spine_released"] = this.spine.advances.filter((a) => a.via === "released").length;
    }
    return out;
  }

  /** The score of what the actors said and did this run against the norms from real plays; undefined when there was nothing to score or no norms for the language. */
  private scoreScene(): ScriptScore | undefined {
    const scene = this.scene;
    if (!scene || !this.body || scene.turns.length === 0) return undefined;
    try {
      const language = this.body.config.agents[0]?.promptProfile.language === "en" ? "en" : "pt";
      if (!normsFor(SCRIPT_NORMS, language)) return undefined;
      return scene.score({ norms: SCRIPT_NORMS, language, medium: this.params.mode === "cinematic" ? "CINEMA" : "THEATRE", frames: this.frames.log.frames, startedAt: this.sceneStart });
    } catch (err) {
      this.d.logger.warn("script likeness not scored", { run: this.id, error: err instanceof Error ? err.message : String(err) });
      return undefined;
    }
  }

  /**
   * The script's and the film's drops as flat counters for the run summary (`replay.json`): authored beats played, dropped, and dropped for each reason
   * (`beats_dropped_veto_cooldown`), and the cinematic buffer's drops by reason (`cine_dropped_stale`). The two lists are separate: a track `drop` is a buffer
   * item (a walk, a door, a hug that waited too long to be filmed; its command still went out), never an authored beat.
   */
  private scriptCounters(): Record<string, number> {
    const out: Record<string, number> = {};
    const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const dropped = [...this.beatOutcomes.dropped.values()].reduce((a, b) => a + b, 0);
    if (this.beatPlayer) {
      out["beats_played"] = this.beatOutcomes.played;
      out["beats_dropped"] = dropped;
      for (const [why, n] of this.beatOutcomes.dropped) out[`beats_dropped_${key(why)}`] = n;
    }
    for (const e of this.cine?.track.entries ?? []) if (e.k === "drop") out[`cine_dropped_${key(e.why)}`] = (out[`cine_dropped_${key(e.why)}`] ?? 0) + 1;
    return out;
  }

  /**
   * The body's own counters for the run summary (errata P7), only the ones that are not zero: grievance raised from talk (`grievance_raised`, by kind), the
   * refusals told to the model (`act_blocked_notes`), lines walked to their addressee (`earshot_approaches`) or dropped for want of one (`earshot_drops`,
   * `earshot_drops_<why>`), unknown body handles stripped from a block that kept the rest (`unknown_ref_stripped`), and walks the hotel found no route for
   * (`no_route_retries` to the nearest reachable tile, `no_route_dropped` when none was).
   */
  private bodyCounters(): Record<string, number> {
    const all: Record<string, number> = { ...this.dramaSink.counters(), earshot_approaches: this.earshot.approaches, earshot_drops: this.earshot.drops, unknown_ref_stripped: this.earshot.stripped, ...this.executor?.routeCounters() };
    for (const [why, n] of this.earshot.dropped) all[`earshot_drops_${why}`] = n;
    return Object.fromEntries(Object.entries(all).filter(([, n]) => n > 0));
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
      const id = this.space.avatarId(ref);
      if (id === undefined) continue;
      this.goneWaiters.add(ref);
      link.send({ t: "actor_despawn", cid: link.nextCid(this.id), run: this.id, lease, actor: id, mode: "walk_out" });
    }
    if (this.goneWaiters.size === 0) return;
    await Promise.race([done, sleepOn(clock, timeout)]);
    // Whoever has not left by the deadline is removed at once.
    for (const ref of [...this.goneWaiters]) {
      const id = this.space.avatarId(ref);
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
    // A direction to leave is carried out by the body, not left to the model to write a `body.move` for it.
    const cast = new Map([...this.agents].filter(([, a]) => !a.gone).map(([ref, a]) => [ref, a.name]));
    for (const ref of to ? [to] : namedIn(text, cast)) await this.directExit(ref, text);
    return true;
  }

  /** Sends `ref` out of its room when `text` tells it to (see `leaveDirective`). True when the exit was planned. */
  private async directExit(ref: string, text: string): Promise<boolean> {
    const handle = this.handle;
    if (!handle || this.state !== "running" || this.agents.get(ref)?.gone) return false;
    const space = this.space.view(ref, this.d.clock.now());
    if (!space?.room || space.room.stale) return false;
    const roomId = leaveDirective(text, space.adjacency);
    if (roomId === undefined) return false;
    const state = await handle.repositories.agentStateRepo.get(handle.simulationId, ref);
    if (!state) return false;
    const cmds = this.planFor(ref, state, [], space, { bodyIntent: { order: "together", move: { kind: "leave", to: "r1" } }, handles: { r1: { kind: "room", roomId } } });
    return cmds.some((c) => c.cmd === "move_room");
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

/** The scenario a version belongs to, when the version answer names it (`scenario` or `scenario_id`). */
export function scenarioIdOf(raw: unknown): number | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const id = Number(o["scenario"] ?? o["scenario_id"]);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** The hotel stores `body TEXT`; the version endpoint may wrap it. */
function extractBody(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object" && "body" in raw) return (raw as { body: unknown }).body;
  return raw;
}
