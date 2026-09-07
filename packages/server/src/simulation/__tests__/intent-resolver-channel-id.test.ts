/**
 * A created channel has one id — the one the registry gave it — on every
 * event the intent commits. The invite events used to keep the throwaway id
 * the resolver minted before registration, so the invitee (and, via the
 * invite's actor anchor, the creator too) got anchored to a channel that did
 * not exist, and their next lines landed in a phantom room: no privacy flag,
 * no members, nothing on the stage but a lone figure "somewhere".
 */
import { beforeEach, describe, expect, it } from "vitest";
import { IntentResolver } from "../intent-resolver.js";
import { RateLimitGate } from "../rate-limit-gate.js";
import { ChannelRegistry } from "../channel-registry.js";
import { InMemoryChannelRepository } from "../in-memory-stores.js";
import type { ActionEmotions, ActionIntent, AgentState, AvailableAction, SimulationSettings } from "@perfectman/shared";
import { createId } from "@perfectman/shared";

const SIM_ID = "sim_test";
const CREATOR = "rex";
const INVITEE = "goulart";
const PUBLIC = "ch_public";
const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};
const ACTIONS: AvailableAction[] = [
  { intentType: "create_channel", channelTargets: [], personTargets: [INVITEE], blocked: false },
  { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
];
const EMOTIONS: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0,
  curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0, vulnerableRetreat: 0,
  contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0,
  dominanceAssertion: 0, repairImpulse: 0,
};

function agentState(): AgentState {
  return {
    agentId: CREATOR, simulationId: SIM_ID, personaId: "p", presence: "active",
    coreMood: { valence: 0, arousal: 0.5, stability: 0.8, energy: 0.6, circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 },
    socialEmotions: { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 },
    relationalStates: new Map(), memories: [], initiativeAccumulators: [], lastProcessedEventId: null, lastActionAt: null,
    lastRuminationPulse: null, arrivalPulse: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
}

describe("create_channel commits one channel id", () => {
  let resolver: IntentResolver;
  let registry: ChannelRegistry;
  beforeEach(async () => {
    const repo = new InMemoryChannelRepository();
    registry = new ChannelRegistry(repo);
    await repo.create({ id: PUBLIC, simulationId: SIM_ID, type: "public_channel", name: "general", createdBy: "system", memberAgentIds: [CREATOR, INVITEE], spectatorVisible: true, operatorVisible: true, createdForMotives: [], status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    resolver = new IntentResolver(new RateLimitGate(SETTINGS), registry);
  });

  const ctx = () => ({ simulationId: SIM_ID, channelId: PUBLIC, pulseIndex: 1, agentState: agentState(), availableActions: ACTIONS, channels: [], membership: [], settings: SETTINGS, actionEmotions: EMOTIONS });

  it("puts the registered id on the invite, not the id the resolver minted first", async () => {
    const intent: ActionIntent = { id: createId(), actorId: CREATOR, intentType: "create_channel", personTargets: [INVITEE], invitedAgentIds: [INVITEE], privateMotiveSummary: "quero falar com ele longe dos outros", emotionDrivers: [], motivationDrivers: [], memoryWrites: [] };
    const result = await resolver.resolve(intent, ctx());
    const created = result.committedEvents.find((e) => e.type === "channel_created");
    const invited = result.committedEvents.filter((e) => e.type === "agent_invited");
    expect(created).toBeDefined();
    expect(invited).toHaveLength(1);
    expect(invited[0]?.channelId).toBe(created?.channelId);
    const memberships = await registry.getMembershipsForSimulation(SIM_ID);
    const inNewChannel = memberships.filter((m) => m.channelId === created?.channelId).map((m) => m.agentId).sort();
    expect(inNewChannel).toEqual([INVITEE, CREATOR].sort());
  });

  it("ignores a person id the model put in channelTarget", async () => {
    // The model sometimes writes the invitee's id where a channel id goes.
    const intent: ActionIntent = { id: createId(), actorId: CREATOR, intentType: "create_channel", channelTarget: INVITEE, personTargets: [INVITEE], privateMotiveSummary: "…", emotionDrivers: [], motivationDrivers: [], memoryWrites: [] };
    const result = await resolver.resolve(intent, ctx());
    for (const e of result.committedEvents.filter((e) => e.type === "channel_created" || e.type === "agent_invited")) {
      expect(e.channelId).not.toBe(INVITEE);
    }
    const ids = new Set(result.committedEvents.filter((e) => e.type === "channel_created" || e.type === "agent_invited").map((e) => e.channelId));
    expect(ids.size).toBe(1);
  });
});
