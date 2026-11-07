import {
  AgentRuntime,
  AgentConfigRegistry,
  DEFAULT_MOCK_CONFIG,
  GENERIC_PROMPT_PROFILE,
  SimulationRuntime,
  WallClockPulseLoop,
  hotelBudgetRegistration,
  llmBudget,
  type ArbiterConfig,
  type LLMProvider,
  type LoopClock,
  type RoomSpeechArbiter,
} from "@perfectman/server";
import { createSeededRng, type AgentRuntimeInput, type AgentState, type PersonaConfig, type SeededRng, type SimulationSettings, type Tile } from "@perfectman/shared";
import { FakeGridHotel, type GridEvent } from "./fake-grid-hotel.js";
import { ingestHumanLine } from "./ingest-human-line.js";
import { TestBodyPlanner } from "./test-planner.js";

/**
 * Everything a mock hotel run needs, wired the way the hotel wires it: the real
 * `SimulationRuntime` in hotel mode (split pulse, arbiter, space mirror), the
 * real `AgentRuntime` with the real prompt builder, parser and budget gate, a
 * scripted model behind the provider seam, and the fake grid underneath. One
 * clock rules all of it: the grid's. Time only moves when `runFor` says so, so
 * runs are deterministic and fast.
 */

export type ModelPlan = {
  /** The JSON packet the "model" returns (parsed by the real IntentParser). */
  packet: Record<string, unknown>;
  latencyMs: number;
};

export type ScriptedModel = (call: { input: AgentRuntimeInput; now: number; rng: SeededRng }) => ModelPlan;

export type ActorSpec = {
  id: string;
  name: string;
  /** Persona answer delay (presenceProfile.responseDelayMs). */
  responseDelayMs?: [number, number];
  room?: string;
  tile?: Tile;
};

export type GridWorldOptions = {
  actors: ActorSpec[];
  model: ScriptedModel;
  seed?: number;
  /** Arbiter config; `false` runs without an arbiter (the ungoverned baseline). */
  arbiter?: Partial<ArbiterConfig> | false;
  generateConcurrency?: number;
  /** Run the 6 s base lane too. Default false: only focused pulses. */
  baseLane?: boolean;
  /** Use the test planner (body commands reach the grid). Default true. */
  planner?: boolean;
};

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: false,
  maxPrivateChannelsPerAgent: 0,
  maxMessagesPerMinutePerAgent: 100_000,
  llmCallBudgetPerMinute: 1_000_000,
  pulseIntervalMs: 6000,
  tokenBudgetPerHour: 1_000_000_000,
};

const PERSONA = (id: string, name: string): PersonaConfig => ({
  id,
  name,
  archetype: "regular",
  writingStyle: "casual",
  styleExamples: [],
  baselineValence: 0.1,
  baselineArousal: 0.5,
  baselineStability: 0.8,
  baselineEnergy: 0.6,
  emotionalReactivity: 0.5,
  moodInertia: 0.5,
  maxMoodRotation: 0.5,
  energyRegen: 0.05,
  exclusionSensitivity: 0.5,
  praiseSensitivity: 0.5,
  conflictSensitivity: 0.5,
  boredomSensitivity: 0.5,
  intimacySensitivity: 0.5,
  socialSensitivities: {},
});

const STATE = (id: string, simulationId: string): AgentState => ({
  agentId: id,
  simulationId,
  personaId: id,
  presence: "active",
  coreMood: { valence: 0.1, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 },
  socialEmotions: { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 },
  relationalStates: new Map(),
  memories: [],
  initiativeAccumulators: [],
  lastProcessedEventId: null,
  lastActionAt: null,
  lastRuminationPulse: null,
  arrivalPulse: null,
  createdAt: 0,
  updatedAt: 0,
});

/** Deterministic timers on the grid's clock. */
export class VirtualTimers {
  private seq = 0;
  private readonly timers: Array<{ at: number; seq: number; fn: () => void; live: boolean }> = [];

  constructor(private readonly grid: FakeGridHotel) {}

  schedule(delayMs: number, fn: () => void): { cancel(): void } {
    const timer = { at: this.grid.now() + Math.max(0, delayMs), seq: this.seq++, fn, live: true };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.live = false;
      },
    };
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.schedule(ms, resolve));
  }

  /** The next live timer at or before `limit`, removed from the queue. */
  popDue(limit: number): { at: number; fn: () => void } | undefined {
    let best = -1;
    for (let i = 0; i < this.timers.length; i++) {
      const t = this.timers[i]!;
      if (!t.live || t.at > limit) continue;
      const b = best === -1 ? undefined : this.timers[best]!;
      if (!b || t.at < b.at || (t.at === b.at && t.seq < b.seq)) best = i;
    }
    if (best === -1) return undefined;
    const [t] = this.timers.splice(best, 1);
    return t!;
  }

  loopClock(): LoopClock {
    return {
      now: () => this.grid.now(),
      setTimeout: (fn, ms) => this.schedule(ms, fn),
      clearTimeout: (handle) => (handle as { cancel(): void }).cancel(),
    };
  }
}

export type ModelCall = { agentId: string; at: number; resolvedAt?: number };

/** What the delivery gateway was handed, stamped on the virtual clock. */
export type SpokenLine = { at: number; agentId: string; channelId: string; content: string };

export type GridWorld = {
  runtime: SimulationRuntime;
  grid: FakeGridHotel;
  simulationId: string;
  timers: VirtualTimers;
  loop: WallClockPulseLoop;
  planner?: TestBodyPlanner;
  arbiter?: RoomSpeechArbiter;
  names: Record<string, string>;
  /** Every prompt (system + user) the scripted model was shown. */
  prompts: string[];
  calls: ModelCall[];
  /** Every actor line the gateway received, in commit order. */
  spoken: SpokenLine[];
  /** A human types (or stops); tells the grid and the arbiter. */
  humanType(ref: string, on: boolean): void;
  /** Move virtual time forward, running timers, pulses and the model in order. */
  runFor(ms: number): Promise<void>;
  /** Run until nothing is scheduled within `limitMs`. */
  runUntilQuiet(limitMs: number): Promise<void>;
  humanSay(ref: string, text: string, mode?: "say" | "shout" | "whisper", to?: string): Promise<{ eventId: string; addressedIds: string[] }>;
  flush(): Promise<void>;
};

/** Let every promise chain that can finish without a timer finish. */
const settleOnce = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export async function buildGridWorld(options: GridWorldOptions): Promise<GridWorld> {
  const simulationId = `sim_grid_${options.seed ?? 1}`;
  const rng = createSeededRng(options.seed ?? 1);
  const grid = new FakeGridHotel();
  const timers = new VirtualTimers(grid);
  const prompts: string[] = [];
  const calls: ModelCall[] = [];
  const names: Record<string, string> = Object.fromEntries(options.actors.map((a) => [a.id, a.name]));

  const provider: LLMProvider = {
    async generateIntent(input, _context, prompt) {
      prompts.push(`${prompt.system}\n${prompt.user}`);
      const call: ModelCall = { agentId: input.agentId, at: grid.now() };
      calls.push(call);
      const plan = options.model({ input, now: grid.now(), rng });
      await timers.sleep(plan.latencyMs);
      call.resolvedAt = grid.now();
      return {
        content: JSON.stringify(plan.packet),
        usage: { inputTokens: prompt.inputTokensEstimate, outputTokens: 80 },
        latencyMs: plan.latencyMs,
        model: "scripted",
      };
    },
  };
  const registry = new AgentConfigRegistry(
    options.actors.map((a) => ({
      id: a.id,
      persona: PERSONA(a.id, a.name),
      promptProfile: {
        ...GENERIC_PROMPT_PROFILE,
        personaId: a.id,
        displayName: a.name,
        language: "pt-BR" as const,
        hotelMode: true,
        ...(a.responseDelayMs ? { responseDelayMs: a.responseDelayMs } : {}),
      },
      llm: { ...DEFAULT_MOCK_CONFIG, maxInputTokens: 12_000 },
    })),
  );

  const spoken: SpokenLine[] = [];
  const runtime = new SimulationRuntime({
    delivery: {
      sendAgentMessage: (channelId, m) => {
        if (m.kind !== "reaction") spoken.push({ at: grid.now(), agentId: m.agentId, channelId, content: m.content });
        return Promise.resolve();
      },
      createChannel: () => Promise.resolve(),
      addMember: () => Promise.resolve(),
      removeMember: () => Promise.resolve(),
      sendSpectatorEvent: () => Promise.resolve(),
      sendOperatorEvent: () => Promise.resolve(),
      onSimulationStopped: () => Promise.resolve(),
    },
    agentRuntime: new AgentRuntime(undefined, registry, () => provider),
    llmBudget,
  });

  let planner: TestBodyPlanner | undefined;
  const planned = options.planner !== false;
  if (planned) planner = new TestBodyPlanner(grid, runtime);

  const onlyLounge = options.actors.filter((a) => (a.room ?? "lounge") === "lounge").map((a) => a.id);
  await runtime.createSimulation({
    id: simulationId,
    name: "grid world",
    seed: options.seed ?? 1,
    settings: SETTINGS,
    agentContexts: options.actors.map((a) => ({
      id: a.id,
      state: STATE(a.id, simulationId),
      persona: registry.getPersona(a.id),
      displayName: a.name,
      ...(a.responseDelayMs ? { responseDelayMs: a.responseDelayMs } : {}),
    })),
    channels: [{ id: "room:lounge", type: "public_channel", name: "Lounge", memberAgentIds: onlyLounge, default: true }],
    hotel: {
      generateConcurrency: options.generateConcurrency ?? 3,
      ...(options.arbiter === false ? {} : { arbiter: options.arbiter ?? {} }),
      spaceMirror: grid,
      clock: () => grid.now(),
      ...(planner ? { onAgentCommitted: planner.onAgentCommitted } : {}),
    },
  });
  llmBudget.registerLimits(simulationId, hotelBudgetRegistration());
  llmBudget.reset(simulationId);
  await runtime.registerRoomChannel(simulationId, { id: "room:hallway", name: "Hallway" });
  await runtime.registerRoomChannel(simulationId, { id: "room:bedroom", name: "Bedroom" });
  const arbiter = runtime.getArbiter(simulationId);

  for (const a of options.actors) {
    grid.advance(250); // join interval
    grid.spawnActor(a.id, a.name, a.room ?? "lounge", a.tile);
  }

  // Grid events flow into the log in order: arrivals wake the actor, a door moves its channel.
  let pump: Promise<void> = Promise.resolve();
  grid.setOnEvent((event: GridEvent) => {
    planner?.onGridEvent(event);
    if (event.type !== "arrived" && event.type !== "moved_room") return;
    pump = pump.then(async () => {
      const room = event.type === "arrived" ? event.room : event.to;
      if (event.type === "moved_room") {
        await runtime.removeChannelMember(`room:${event.from}`, event.agentId);
        await runtime.addChannelMember(`room:${event.to}`, event.agentId);
      }
      await runtime.getEventLog().append(simulationId, [
        {
          simulationId,
          channelId: `room:${room}`,
          actorId: event.agentId,
          type: event.type === "arrived" ? "body_arrived" : "moved_room",
          payload: event.type === "arrived" ? { planId: event.planId, room: event.room, tile: [event.tile[0], event.tile[1]] } : { from: event.from, to: event.to },
          sourceEventIds: [],
          emotionalSalience: "low",
          pulseIndex: runtime.getPulseIndex(simulationId),
          visibility: { visibleToAgents: [event.agentId], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "body_event" },
        },
      ]);
    });
  });

  // Without the base lane the beat is set so far out that it never comes due.
  const loop = new WallClockPulseLoop({
    runtime,
    simulationId,
    clock: timers.loopClock(),
    ...(options.baseLane ? {} : { baseIntervalMs: Number.MAX_SAFE_INTEGER / 4 }),
  });
  loop.start();

  const flush = async (): Promise<void> => {
    await settleOnce();
    await pump;
    await settleOnce();
  };

  const world: GridWorld = {
    runtime,
    grid,
    simulationId,
    timers,
    loop,
    ...(planner ? { planner } : {}),
    ...(arbiter ? { arbiter } : {}),
    names,
    prompts,
    calls,
    spoken,
    humanType(ref, on) {
      grid.humanType(ref, on);
      const room = [...grid.model().rooms.values()].find((r) => r.occupants.has(ref));
      if (room) arbiter?.noteHumanTyping(room.id, on, grid.now());
    },
    flush,
    async runFor(ms) {
      const target = grid.now() + ms;
      for (;;) {
        await flush();
        const due = timers.popDue(target);
        if (!due) break;
        grid.advance(due.at - grid.now());
        due.fn();
      }
      grid.advance(target - grid.now());
      await flush();
    },
    async runUntilQuiet(limitMs) {
      const target = grid.now() + limitMs;
      for (;;) {
        await flush();
        const due = timers.popDue(target);
        if (!due) return;
        grid.advance(due.at - grid.now());
        due.fn();
      }
    },
    async humanSay(ref, text, mode = "say", to) {
      const event = grid.humanSay(ref, text, mode, to);
      const ingested = await ingestHumanLine({
        runtime,
        simulationId,
        grid,
        event,
        names,
        ...(arbiter ? { arbiter } : {}),
      });
      return { eventId: ingested.event.id, addressedIds: ingested.addressedIds };
    },
  };
  return world;
}
