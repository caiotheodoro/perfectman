import { describe, it, expect } from "vitest";
import { buildPerceptionPacket } from "../build-perception-packet.js";
import type {
  AgentState,
  AttentionResult,
  CommittedEvent,
  TranslatedEmotionalState,
} from "@perfectman/shared";

function agent(): AgentState {
  return {
    agentId: "agent-me",
    simulationId: "sim-1",
    personaId: "p1",
    presence: "active",
    coreMood: { valence: 0, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 },
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
  };
}

function event(id: string, actor: string, type: CommittedEvent["type"] = "message_sent"): CommittedEvent {
  return {
    id,
    simulationId: "sim-1",
    channelId: "ch-1",
    actorId: actor,
    type,
    payload: { content: `msg ${id}` },
    createdAt: 1,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
  };
}

const translated: TranslatedEmotionalState = {
  moodDescription: "",
  socialContext: "",
  relationalFlavors: [],
  pressureDescriptions: [],
  inhibitionDescriptions: [],
};

const attention: AttentionResult = {
  noticed: true,
  dueScore: 1,
  reasons: [],
  needsLLM: true,
  triggeringReason: "direct_mention",
};

describe("buildPerceptionPacket eventHandles", () => {
  it("assigns e1 to the triggering event, then e2.. to visible-context events in order", () => {
    const trigger = event("evt_trigger", "agent-peer");
    const ctx1 = event("evt_ctx_1", "agent-x");
    const ctx2 = event("evt_ctx_2", "agent-y");

    const packet = buildPerceptionPacket(
      agent(),
      [ctx1, ctx2, trigger],
      trigger,
      [],
      attention,
      translated,
      [],
    );

    expect(packet.eventHandles).toEqual({
      e1: "evt_trigger",
      e2: "evt_ctx_1",
      e3: "evt_ctx_2",
    });
    // the triggering event is not double-counted as a context event
    expect(packet.visibleContextEvents.map((e) => e.id)).toEqual(["evt_ctx_1", "evt_ctx_2"]);
  });

  it("starts handles at e1 for the context events when there is no triggering event", () => {
    const ctx1 = event("evt_a", "agent-x");
    const ctx2 = event("evt_b", "agent-y");

    const packet = buildPerceptionPacket(agent(), [ctx1, ctx2], null, [], attention, translated, []);

    expect(packet.eventHandles).toEqual({ e1: "evt_a", e2: "evt_b" });
  });

  it("returns an empty handle map when nothing is in view", () => {
    const packet = buildPerceptionPacket(agent(), [], null, [], attention, translated, []);
    expect(packet.eventHandles).toEqual({});
  });
});
