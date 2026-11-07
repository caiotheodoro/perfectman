import type { CommittedEvent, EventPayload, SimulationEvent } from "@perfectman/shared";
import type {
  ConfiguredSimulationHandle,
  GuestIngest,
  GuestLineInput,
  HotelRuntimeApi,
  IRoomSpeechArbiter,
  PulseResult,
  RunPulseOptions,
} from "@perfectman/server/hotel";

/**
 * Everything the sidecar needs from a built simulation, in one place, so the
 * L3 engine work lands behind it (docs/plans/hotel-package.md 18). Each member
 * prefers the runtime's hotel API (`hotel-runtime-api.ts`) when it is there
 * and falls back to a thin adapter over what `SimulationRuntime` has today:
 *
 * - `runPulse(opts)`: today's runtime ignores `opts`, so a focused pulse is a
 *   whole pulse. The wall-clock loop and the gateway are unaffected.
 * - `pulseIndex()`: tracked from `PulseResult` until `getPulseIndex` exists.
 * - `guests.ingest()`: `EventLog.append` of an untrusted `message_sent`, which
 *   is exactly what the frozen `GuestIngest` contract says it does.
 * - arbiter hooks: no-ops until the runtime exposes an arbiter.
 * - `resolveDeferred`: unsupported until L3 ships it; pending speech is then
 *   simply not held (the line is committed at once, as today).
 */
export type RuntimePort = {
  simulationId: string;
  runPulse(opts: RunPulseOptions): Promise<PulseResult | undefined>;
  pulseIndex(): number;
  guests: GuestIngest;
  noteHumanLine(roomChannelId: string, line: { eventId: string; at: number; addressedIds: string[] }): void;
  noteHumanTyping(roomChannelId: string, typing: boolean, at: number): void;
  appendEvents(events: SimulationEvent[]): Promise<CommittedEvent[]>;
  getEvents(): Promise<CommittedEvent[]>;
  getEventsAfter(eventId?: string): Promise<CommittedEvent[]>;
  stop(): Promise<void>;
  /** Which L3 behaviours this runtime actually has (reported, so gaps are visible). */
  capabilities: { hotelApi: boolean; arbiter: boolean; deferredSpeech: boolean };
};

type MaybeHotelRuntime = Partial<HotelRuntimeApi> & {
  arbiter?: IRoomSpeechArbiter;
  getArbiter?: () => IRoomSpeechArbiter | undefined;
};

export function createRuntimePort(handle: ConfiguredSimulationHandle): RuntimePort {
  const { runtime, simulationId } = handle;
  const api = runtime as unknown as MaybeHotelRuntime;
  const arbiter = api.arbiter ?? api.getArbiter?.();
  let lastPulse = 0;

  const appendEvents = (events: SimulationEvent[]): Promise<CommittedEvent[]> => runtime.getEventLog().append(simulationId, events);

  const guests: GuestIngest = {
    async ingest(line: GuestLineInput): Promise<CommittedEvent> {
      const payload: EventPayload = {
        content: line.content,
        untrusted: true,
        senderKind: line.senderKind,
        senderName: line.senderName,
        mentionedAgentIds: line.mentionedAgentIds,
        addresseeIds: line.addresseeIds,
        hearing: line.hearing,
        speakerTile: [line.speakerTile[0], line.speakerTile[1]],
        mode: line.mode,
      };
      const event: SimulationEvent = {
        simulationId: line.simulationId,
        channelId: line.roomChannelId,
        actorId: line.actorId,
        type: "message_sent",
        payload,
        pulseIndex: api.getPulseIndex ? api.getPulseIndex(simulationId) : lastPulse,
        sourceEventIds: [],
        emotionalSalience: line.salience,
        visibility: line.visibility,
      };
      const [committed] = await appendEvents([event]);
      if (!committed) throw new Error("guest line was not committed");
      return committed;
    },
  };

  return {
    simulationId,
    async runPulse(opts) {
      const run = runtime as unknown as { runPulse(id: string, opts?: RunPulseOptions): Promise<PulseResult> };
      const result = await run.runPulse(simulationId, opts);
      lastPulse = Math.max(lastPulse, result.pulseIndex);
      return result;
    },
    pulseIndex: () => (api.getPulseIndex ? api.getPulseIndex(simulationId) : lastPulse),
    guests,
    noteHumanLine: (roomChannelId, line) => arbiter?.noteHumanLine(roomChannelId, line),
    noteHumanTyping: (roomChannelId, typing, at) => arbiter?.noteHumanTyping(roomChannelId, typing, at),
    appendEvents,
    getEventsAfter: (eventId) => runtime.getEventLog().getAfter(simulationId, eventId),
    getEvents: () => handle.repositories.eventRepo.getCommittedThrough(simulationId, Number.MAX_SAFE_INTEGER),
    stop: () => runtime.stop(simulationId),
    capabilities: {
      hotelApi: typeof api.getPulseIndex === "function",
      arbiter: arbiter !== undefined,
      deferredSpeech: typeof api.resolveDeferred === "function",
    },
  };
}
