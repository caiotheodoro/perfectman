import { describe, it, expect, beforeEach } from "vitest";
import { IntentResolver } from "../intent-resolver.js";
import { RateLimitGate } from "../rate-limit-gate.js";
import { ChannelRegistry } from "../channel-registry.js";
import { InMemoryChannelRepository } from "../in-memory-stores.js";
import type {
  ActionIntent,
  AgentState,
  SimulationSettings,
  ActionEmotions,
  AvailableAction,
  SimulationEvent,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";

const SIM_ID = "sim_motive";
const AGENT_ID = "agent_1";
const CHANNEL_ID = "ch_public";

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

function makeIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    id: createId(),
    actorId: AGENT_ID,
    intentType: "send_message",
    channelTarget: CHANNEL_ID,
    visibleContent: "hello room",
    personTargets: [],
    privateMotiveSummary: "I want them to think I am calm while I count the exits",
    emotionDrivers: ["anxiety"],
    motivationDrivers: ["control"],
    memoryWrites: [],
    ...overrides,
  };
}

function makeAgentState(): AgentState {
  return {
    agentId: AGENT_ID,
    simulationId: SIM_ID,
    personaId: "persona_1",
    presence: "active",
    coreMood: { valence: 0, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 },
    socialEmotions: { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0.3, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 },
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const ACTION_EMOTIONS: ActionEmotions = {
  defensiveness: 0, warmth: 0.3, jealousInspection: 0, shameWithdrawal: 0,
  resentfulColdness: 0, curiousApproach: 0.3, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0,
  impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};

const AVAILABLE_ACTIONS: AvailableAction[] = [
  { intentType: "send_message", channelTargets: [CHANNEL_ID], personTargets: [], blocked: false },
  { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
];

function motiveEvents(events: SimulationEvent[]): SimulationEvent[] {
  return events.filter(e => e.type === "private_motive_summary");
}

describe("private_motive_summary per resolved intent", () => {
  let resolver: IntentResolver;

  beforeEach(async () => {
    const channelRepo = new InMemoryChannelRepository();
    const channelRegistry = new ChannelRegistry(channelRepo);
    await channelRepo.create({
      id: CHANNEL_ID,
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: [AGENT_ID],
      spectatorVisible: true,
      operatorVisible: true,
      createdForMotives: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await channelRepo.addMembership({ channelId: CHANNEL_ID, agentId: AGENT_ID, joinedAt: Date.now() });
    resolver = new IntentResolver(new RateLimitGate(SETTINGS), channelRegistry);
  });

  const ctx = () => ({
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    pulseIndex: 4,
    agentState: makeAgentState(),
    availableActions: AVAILABLE_ACTIONS,
    channels: [],
    membership: [],
    settings: SETTINGS,
    actionEmotions: ACTION_EMOTIONS,
  });

  it("commits exactly one operator-only motive event joined to the act by sourceIntentId", async () => {
    const intent = makeIntent();
    const result = await resolver.resolve(intent, ctx());
    expect(result.outcome).toBe("committed");

    const act = result.committedEvents.find(e => e.type === "message_sent");
    const motives = motiveEvents(result.committedEvents);
    expect(motives).toHaveLength(1);
    const motive = motives[0]!;
    expect(motive.sourceIntentId).toBe(intent.id);
    expect(motive.sourceIntentId).toBe(act?.sourceIntentId);
    expect(motive.actorId).toBe(AGENT_ID);
    expect(motive.channelId).toBe(CHANNEL_ID);
    expect(motive.payload).toEqual({
      summary: intent.privateMotiveSummary,
      intentType: "send_message",
      emotionDrivers: ["anxiety"],
      motivationDrivers: ["control"],
      engineAuthored: false,
    });
    expect(motive.visibility).toEqual({
      visibleToAgents: [],
      visibleToSpectators: false,
      visibleToOperators: true,
      visibilityReason: "operator_only",
    });
    // The act itself stays exactly as public as before — no motive leaks
    // onto the message payload.
    expect(act?.payload).not.toHaveProperty("privateMotiveSummary");
    expect(act?.payload).not.toHaveProperty("summary");
  });

  it("orders the motive after the act it explains", async () => {
    const result = await resolver.resolve(makeIntent(), ctx());
    const types = result.committedEvents.map(e => e.type);
    expect(types.indexOf("message_sent")).toBeLessThan(types.indexOf("private_motive_summary"));
  });

  it("flags an engine-authored fallback motive so readers never narrate it as the character's", async () => {
    const intent = makeIntent({
      intentType: "no_op",
      channelTarget: undefined,
      visibleContent: undefined,
      privateMotiveSummary: "Fallback applied: No JSON object found in response",
    });
    const result = await resolver.resolve(intent, ctx());
    const motives = motiveEvents(result.committedEvents);
    expect(motives).toHaveLength(1);
    expect(motives[0]!.payload["engineAuthored"]).toBe(true);
    expect(motives[0]!.payload["intentType"]).toBe("no_op");
    // The no_op record itself is unchanged: it still carries the motive
    // string for the readers that already depend on it.
    expect(result.committedEvents.some(e => e.type === "no_op_recorded")).toBe(true);
  });

  it("stamps holdSuggested on the motive only when the context says the engine consulted on a hold (ADR-0017)", async () => {
    const plain = await resolver.resolve(makeIntent({ intentType: "no_op", channelTarget: undefined }), ctx());
    const plainMotive = plain.committedEvents.find((e) => e.type === "private_motive_summary");
    expect(plainMotive?.payload).not.toHaveProperty("holdSuggested");
    const held = await resolver.resolve(makeIntent({ intentType: "no_op", channelTarget: undefined }), { ...ctx(), holdSuggested: true });
    const heldMotive = held.committedEvents.find((e) => e.type === "private_motive_summary");
    expect(heldMotive?.payload["holdSuggested"]).toBe(true);
    expect(heldMotive?.payload["intentType"]).toBe("no_op");
  });

  it("still records the thought when the act was blocked", async () => {
    // send_message to a channel the agent is not a member of → not_member block.
    const intent = makeIntent({ channelTarget: "ch_elsewhere" });
    const result = await resolver.resolve(intent, ctx());
    expect(result.outcome).toBe("blocked");
    const motives = motiveEvents(result.committedEvents);
    expect(motives).toHaveLength(1);
    expect(motives[0]!.sourceIntentId).toBe(intent.id);
    expect(motives[0]!.payload["engineAuthored"]).toBe(false);
  });
});
