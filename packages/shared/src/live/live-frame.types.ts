/**
 * The live protocol, shared by the server and the web app.
 *
 * It lives in `shared` rather than `server` because the web bundle must never
 * import `@perfectman/server` — that would pull `better-sqlite3`, `discord.js`
 * and `ollama` into the browser build graph.
 *
 * One curated frame per pulse, not the raw operator firehose: the stream
 * carries a full serialized `AgentState` per agent per pulse, which is far more
 * than a viewer needs on the wire. The complete state stays server-side and
 * lands in `replay.json`.
 */

export type LiveEmotion = {
  valence: number;
  arousal: number;
  /** Social emotions above a floor, strongest first — at most three. */
  top: Array<{ key: string; value: number }>;
};

export type LiveMessage = {
  eventId: string;
  channelId: string;
  actorId: string;
  eventType: string;
  text: string;
  /** Empty means everyone in the channel — this is what the POV filter reads. */
  visibleToAgents: string[];
  pulseIndex: number;
  createdAt: number;
};

export type LiveThinking = {
  agentId: string;
  intentType: string;
  visibleContent?: string;
  privateMotiveSummary: string;
  emotionDrivers: string[];
  motivationDrivers: string[];
};

export type LiveChannel = {
  id: string;
  name: string;
  type: string;
  memberAgentIds: string[];
};

export type LiveNotice = { type: string; agentId?: string; detail: string };

/** One pulse, as the viewer sees it. */
export type LivePulseFrame = {
  pulseIndex: number;
  eventsCommitted: number;
  agentsCalled: number;
  messages: LiveMessage[];
  thinking: Record<string, LiveThinking>;
  emotions: Record<string, LiveEmotion>;
  notices: LiveNotice[];
  /** Frames coalesced away before this one because the client was behind. */
  droppedBefore?: number;
};

export type RunState =
  | "idle"
  | "compiling"
  | "validating"
  | "health_check"
  | "building"
  | "running"
  | "stopping"
  | "done"
  | "failed";

export type RunStatus = {
  runId: string | null;
  simulationId: string | null;
  state: RunState;
  /** Index of the most recent pulse — 0-based, and 0 before anything has run. */
  pulseIndex: number;
  /** How many pulses have actually settled. This is what to show against `maxPulses`. */
  pulsesRun: number;
  maxPulses: number;
  startedAt?: number;
  endedAt?: number;
  stopReason?: string;
  error?: { message: string; hint?: string };
  counters: { llmFailures: number; gatewayTimeouts: number; framesDropped: number };
};

export type LiveEvent =
  | {
      type: "hello";
      runId: string;
      simulationId: string;
      simulationName: string;
      agents: Array<{ id: string; displayName: string; archetype: string }>;
      channels: LiveChannel[];
      maxPulses: number;
      /**
       * Seeded history. Prior events are written straight to the repository, so
       * they never pass through the projections and no gateway ever sees them —
       * without this the live view would start blank where the stored replay
       * has history.
       */
      priorEvents: LiveMessage[];
    }
  | { type: "status"; status: RunStatus }
  | { type: "pulse"; frame: LivePulseFrame }
  | { type: "channel"; channel: LiveChannel }
  | { type: "notice"; notice: LiveNotice }
  | { type: "stopped"; stopReason?: string; replayUrl: string }
  | { type: "error"; message: string; hint?: string };

/**
 * What the viewer renders, from either source: the live stream folded up as it
 * arrives, or a stored replay adapted into the same shape.
 */
export type ViewerPulse = {
  pulseIndex: number;
  eventsCommitted: number;
  agentsCalled: number;
  messages: LiveMessage[];
  thinking: Record<string, LiveThinking>;
  emotions: Record<string, LiveEmotion>;
  notices: LiveNotice[];
};

export type ViewerReplay = {
  simulationId: string;
  simulationName: string;
  agents: Array<{ id: string; displayName: string; archetype: string }>;
  channels: LiveChannel[];
  pulses: ViewerPulse[];
  stopReason?: string;
};
