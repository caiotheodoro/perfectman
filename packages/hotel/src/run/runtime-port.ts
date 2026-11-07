import type { ActionIntent, CommittedEvent, SimulationEvent } from "@perfectman/shared";
import type {
  ConfiguredSimulationHandle,
  GuestIngest,
  PulseResult,
  ResolvedIntent,
  RunPulseOptions,
} from "@perfectman/server/hotel";

/**
 * The part of a built simulation a hotel run drives, in one place. Everything
 * here is the runtime's own hotel API (docs/plans/hotel-package.md 18):
 * `runPulse` with a focus lane, `ingest`, the room speech arbiter,
 * `resolveDeferred`, and room channels that follow occupancy.
 */
export type RuntimePort = {
  simulationId: string;
  runPulse(opts: RunPulseOptions): Promise<PulseResult>;
  pulseIndex(): number;
  guests: GuestIngest;
  noteHumanLine(roomChannelId: string, line: { eventId: string; at: number; addressedIds: string[] }): void;
  noteHumanTyping(roomChannelId: string, typing: boolean, at: number): void;
  /** Re-submits a held line through the resolver, so the arbiter and the rate gate still apply. */
  resolveDeferred(agentId: string, intent: ActionIntent): Promise<ResolvedIntent>;
  /** Idempotent: a room's public channel, `room:<id>`. */
  registerRoomChannel(room: { id: string; name: string; memberAgentIds?: string[] }): Promise<void>;
  addChannelMember(channelId: string, agentId: string): Promise<void>;
  removeChannelMember(channelId: string, agentId: string): Promise<void>;
  /** Stops scheduling an actor the hotel removed; returns how many are still scheduled. */
  retireActor(agentId: string): number;
  /** A staggered arrival: the actor is not consulted until `admitActor`. Returns how many are scheduled. */
  deferActor(agentId: string): number;
  admitActor(agentId: string): boolean;
  appendEvents(events: SimulationEvent[]): Promise<CommittedEvent[]>;
  getEvents(): Promise<CommittedEvent[]>;
  getEventsAfter(eventId?: string): Promise<CommittedEvent[]>;
  /** Resolves when no pulse or generate task is in flight. */
  awaitIdle(): Promise<void>;
  stop(): Promise<void>;
};

export function createRuntimePort(handle: ConfiguredSimulationHandle): RuntimePort {
  const { runtime, simulationId } = handle;
  const arbiter = runtime.getArbiter(simulationId);
  if (!arbiter) throw new Error("a hotel run needs the room speech arbiter: build the simulation with hotel.arbiter");

  // The runtime forgets a simulation once it is stopped; status and artifacts still ask for the index.
  let lastPulse = 0;
  const pulseIndex = (): number => {
    try {
      lastPulse = runtime.getPulseIndex(simulationId);
    } catch {
      // stopped: keep the last known index
    }
    return lastPulse;
  };

  return {
    simulationId,
    runPulse: (opts) => runtime.runPulse(simulationId, opts),
    pulseIndex,
    guests: runtime,
    noteHumanLine: (roomChannelId, line) => arbiter.noteHumanLine(roomChannelId.replace(/^room:/, ""), line),
    noteHumanTyping: (roomChannelId, typing, at) => arbiter.noteHumanTyping(roomChannelId.replace(/^room:/, ""), typing, at),
    resolveDeferred: (agentId, intent) => runtime.resolveDeferred(agentId, intent),
    registerRoomChannel: (room) => runtime.registerRoomChannel(simulationId, room),
    addChannelMember: (channelId, agentId) => runtime.addChannelMember(channelId, agentId),
    removeChannelMember: (channelId, agentId) => runtime.removeChannelMember(channelId, agentId),
    retireActor: (agentId) => runtime.retireAgent(simulationId, agentId),
    deferActor: (agentId) => runtime.deferAgent(simulationId, agentId),
    admitActor: (agentId) => runtime.admitAgent(simulationId, agentId),
    appendEvents: (events) => runtime.getEventLog().append(simulationId, events),
    getEventsAfter: (eventId) => runtime.getEventLog().getAfter(simulationId, eventId),
    getEvents: () => handle.repositories.eventRepo.getCommittedThrough(simulationId, Number.MAX_SAFE_INTEGER),
    awaitIdle: () => runtime.awaitIdle(simulationId),
    stop: () => runtime.stop(simulationId),
  };
}
