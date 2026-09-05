/**
 * Regression: a 2-agent conversation driven through the real IntentResolver
 * must commit events whose payloads carry participant identifiers, and those
 * events must accrete non-empty relational state via the real engine —
 * no hand-injected payloads (#138).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { IntentResolver } from "../intent-resolver.js";
import { RateLimitGate } from "../rate-limit-gate.js";
import { ChannelRegistry } from "../channel-registry.js";
import { InMemoryChannelRepository, InMemoryEventRepository } from "../in-memory-stores.js";
import { updateRelationalEmotions } from "@perfectman/engine";
import type {
  ActionIntent,
  AgentState,
  AvailableAction,
  CommittedEvent,
  CoreMood,
  SimulationEvent,
} from "@perfectman/shared";
import { createId } from "@perfectman/shared";
import { makeAgentState, makePersona, SETTINGS, ZERO_ACTION } from "./fixtures.js";

const SIM_ID = "sim_relational";
const CHANNEL_ID = "ch_public";
const ALICE = "agent_alice";
const BRUNO = "agent_bruno";
const AGENT_NAMES: Record<string, string> = { [ALICE]: "Alice", [BRUNO]: "Bruno" };
const NOW = 1_700_000_050_000;

const AVAILABLE_ACTIONS: AvailableAction[] = [
  { intentType: "send_message", channelTargets: [CHANNEL_ID], personTargets: [ALICE, BRUNO], blocked: false },
  { intentType: "reply_to_message", channelTargets: [CHANNEL_ID], personTargets: [ALICE, BRUNO], blocked: false },
  { intentType: "react", channelTargets: [CHANNEL_ID], personTargets: [ALICE, BRUNO], blocked: false },
  { intentType: "create_channel", channelTargets: [], personTargets: [ALICE, BRUNO], blocked: false },
  { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
];

const NEUTRAL_MOOD: CoreMood = {
  valence: 0, arousal: 0.5, stability: 0.8, energy: 0.6,
  circumplexAngle: 0, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0,
};

function makeIntent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    id: createId(),
    actorId: ALICE,
    intentType: "send_message",
    channelTarget: CHANNEL_ID,
    personTargets: [],
    privateMotiveSummary: "test motive",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
    ...overrides,
  };
}

describe("relational accretion through the real resolver", () => {
  let resolver: IntentResolver;
  let eventRepo: InMemoryEventRepository;

  beforeEach(async () => {
    const channelRepo = new InMemoryChannelRepository();
    const channelRegistry = new ChannelRegistry(channelRepo);
    await channelRepo.create({
      id: CHANNEL_ID,
      simulationId: SIM_ID,
      type: "public_channel",
      name: "general",
      createdBy: "system",
      memberAgentIds: [ALICE, BRUNO],
      spectatorVisible: true,
      operatorVisible: true,
      createdForMotives: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const agentId of [ALICE, BRUNO]) {
      await channelRepo.addMembership({ channelId: CHANNEL_ID, agentId, joinedAt: Date.now() });
    }
    eventRepo = new InMemoryEventRepository();
    resolver = new IntentResolver(new RateLimitGate(SETTINGS), channelRegistry);
  });

  const ctxFor = (intent: ActionIntent) => ({
    simulationId: SIM_ID,
    channelId: CHANNEL_ID,
    pulseIndex: 1,
    agentState: makeAgentState({ agentId: intent.actorId, simulationId: SIM_ID }),
    availableActions: AVAILABLE_ACTIONS,
    channels: [],
    membership: [],
    settings: SETTINGS,
    actionEmotions: ZERO_ACTION,
    agentNames: AGENT_NAMES,
  });

  const scriptConversation = async (): Promise<CommittedEvent[]> => {
    const committed: SimulationEvent[] = [];
    const resolve = async (intent: ActionIntent) => {
      const result = await resolver.resolve(intent, ctxFor(intent));
      expect(result.outcome, `${intent.intentType} by ${intent.actorId} must commit`).toBe("committed");
      committed.push(...result.committedEvents);
    };

    await resolve(makeIntent({
      actorId: ALICE,
      personTargets: [BRUNO],
      visibleContent: "hello Bruno",
    }));
    await resolve(makeIntent({
      actorId: BRUNO,
      intentType: "reply_to_message",
      personTargets: [ALICE],
      visibleContent: "happy to help, Alice",
      replyToEventId: "evt_prior",
      replyToActorId: ALICE,
    }));
    await resolve(makeIntent({
      actorId: BRUNO,
      intentType: "react",
      personTargets: [ALICE],
      targetEventId: "evt_prior",
      emoji: "🔥",
    }));
    await resolve(makeIntent({
      actorId: ALICE,
      intentType: "create_channel",
      channelTarget: undefined,
      channelName: "duetto",
      invitedAgentIds: [BRUNO],
    }));

    return eventRepo.append(SIM_ID, committed);
  };

  it("commits participant identifiers on message, reply, and reaction payloads", async () => {
    const message = await resolver.resolve(
      makeIntent({ personTargets: [BRUNO], visibleContent: "hello Bruno" }),
      ctxFor(makeIntent({ personTargets: [BRUNO] })),
    );
    const reply = await resolver.resolve(
      makeIntent({
        actorId: BRUNO,
        intentType: "reply_to_message",
        personTargets: [ALICE],
        visibleContent: "happy to help, Alice",
        replyToEventId: "evt_prior",
        replyToActorId: ALICE,
      }),
      ctxFor(makeIntent({ actorId: BRUNO, intentType: "reply_to_message" })),
    );
    const reaction = await resolver.resolve(
      makeIntent({
        actorId: BRUNO,
        intentType: "react",
        personTargets: [ALICE],
        targetEventId: "evt_prior",
        emoji: "🔥",
      }),
      ctxFor(makeIntent({ actorId: BRUNO, intentType: "react" })),
    );

    expect(message.outcome).toBe("committed");
    const messagePayload = message.committedEvents[0]!.payload;
    expect(messagePayload["personTargets"], "a directed message must carry its personTargets").toEqual([BRUNO]);
    expect(messagePayload["mentionedAgentIds"], "content naming Bruno must parse the mention").toEqual([BRUNO]);

    expect(reply.outcome).toBe("committed");
    const replyPayload = reply.committedEvents[0]!.payload;
    expect(replyPayload["personTargets"], "a reply must carry its personTargets").toEqual([ALICE]);
    expect(replyPayload["mentionedAgentIds"], "reply content naming Alice must parse the mention").toEqual([ALICE]);
    expect(replyPayload["replyToActorId"], "a reply must carry the resolved reply target's actor").toBe(ALICE);

    expect(reaction.outcome).toBe("committed");
    const reactionPayload = reaction.committedEvents[0]!.payload;
    expect(reactionPayload["personTargets"], "a reaction must carry its personTargets so it registers").toEqual([ALICE]);
  });

  it("parses mentions by exact display name and case-insensitive @handle, with no match for unknown names", async () => {
    const mentionMessage = await resolver.resolve(
      makeIntent({ visibleContent: "ping @BRUNO and Zed" }),
      ctxFor(makeIntent({})),
    );
    const noMatchMessage = await resolver.resolve(
      makeIntent({ visibleContent: "nobody in particular here" }),
      ctxFor(makeIntent({})),
    );

    const mentionPayload = mentionMessage.committedEvents[0]!.payload;
    expect(mentionPayload["mentionedAgentIds"], "the @handle form must match Bruno case-insensitively").toEqual([BRUNO]);

    const noMatchPayload = noMatchMessage.committedEvents[0]!.payload;
    expect(noMatchPayload["mentionedAgentIds"], "content naming no known agent must parse no mentions").toBeUndefined();
  });

  it("does not attribute a mention when two agents share a display name", async () => {
    const ambiguousCtx = {
      ...ctxFor(makeIntent({})),
      agentNames: { [ALICE]: "Sam", [BRUNO]: "Sam" } as Record<string, string>,
    };
    const result = await resolver.resolve(makeIntent({ visibleContent: "hey Sam" }), ambiguousCtx);
    expect(
      result.committedEvents[0]!.payload["mentionedAgentIds"],
      "an ambiguous name must not be attributed to either agent",
    ).toBeUndefined();
  });

  it("ignores a one-character display name", async () => {
    const shortNameCtx = {
      ...ctxFor(makeIntent({})),
      agentNames: { [ALICE]: "A", [BRUNO]: "Bruno" } as Record<string, string>,
    };
    const result = await resolver.resolve(makeIntent({ visibleContent: "A and Bruno are here" }), shortNameCtx);
    expect(result.committedEvents[0]!.payload["mentionedAgentIds"]).toEqual([BRUNO]);
  });

  it("accretes non-empty relational state for both agents of the conversation", async () => {
    const committed = await scriptConversation();

    const aliceView = updateRelationalEmotions(new Map(), committed, ALICE, NEUTRAL_MOOD, makePersona(ALICE), NOW);
    const brunoView = updateRelationalEmotions(new Map(), committed, BRUNO, NEUTRAL_MOOD, makePersona(BRUNO), NOW);

    expect(aliceView.get(BRUNO), "Alice must hold a relational entry about Bruno after the exchange").toBeDefined();
    expect(aliceView.get(BRUNO)!.trust, "Bruno's reply and reaction must warm Alice's view of him").toBeGreaterThan(0);
    expect(brunoView.get(ALICE), "Bruno must hold a relational entry about Alice after the exchange").toBeDefined();
    expect(brunoView.get(ALICE)!.trust, "Alice's messages and invite must warm Bruno's view of her").toBeGreaterThan(0);
  });
});

describe("mention parsing — accented display names", () => {
  it("matches an unaccented @handle against an accented display name", async () => {
    const channelRepo = new InMemoryChannelRepository();
    await channelRepo.create({
      id: CHANNEL_ID, simulationId: SIM_ID, type: "public_channel", name: "general", createdBy: "system",
      memberAgentIds: [ALICE, BRUNO], spectatorVisible: true, operatorVisible: true, createdForMotives: [],
      status: "active", createdAt: Date.now(), updatedAt: Date.now(),
    });
    for (const agentId of [ALICE, BRUNO]) await channelRepo.addMembership({ channelId: CHANNEL_ID, agentId, joinedAt: Date.now() });
    const resolverAccented = new IntentResolver(new RateLimitGate(SETTINGS), new ChannelRegistry(channelRepo));
    const intent = makeIntent({ actorId: BRUNO, visibleContent: "valeu @iris, depois te conto" });
    const result = await resolverAccented.resolve(intent, {
      simulationId: SIM_ID,
      channelId: CHANNEL_ID,
      pulseIndex: 1,
      agentState: makeAgentState({ agentId: BRUNO, simulationId: SIM_ID }),
      availableActions: AVAILABLE_ACTIONS,
      channels: [],
      membership: [],
      settings: SETTINGS,
      actionEmotions: ZERO_ACTION,
      agentNames: { [ALICE]: "Íris", [BRUNO]: "Bruno" },
    });
    expect(result.outcome).toBe("committed");
    expect(result.committedEvents[0]!.payload["mentionedAgentIds"]).toEqual([ALICE]);
  });
});
