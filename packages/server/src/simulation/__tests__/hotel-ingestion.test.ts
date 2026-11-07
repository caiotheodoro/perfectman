import { describe, it, expect, vi } from "vitest";
import { filterVisibleEventsForAgent } from "@perfectman/engine";
import { SimulationRuntime } from "../simulation-runtime.js";
import { MockDeliveryGateway } from "../../delivery/mock-delivery-gateway.js";
import type { AgentContext, AgentRuntime } from "../pulse-scheduler.js";
import type { GuestLineInput } from "../hotel-runtime-api.js";
import { SETTINGS, makeAgentState, makePersona } from "./fixtures.js";
import type { ActionIntent, EventVisibility } from "@perfectman/shared";

const SIM_ID = "sim_hotel";
const CHANNEL = "room:lounge";

const audible = (agentIds: string[]): EventVisibility => ({
  visibleToAgents: agentIds,
  visibleToSpectators: true,
  visibleToOperators: true,
  visibilityReason: "public",
});

/** The `operator_only` shape: an empty list would otherwise mean everyone. */
const unheard: EventVisibility = {
  visibleToAgents: [],
  visibleToSpectators: false,
  visibleToOperators: true,
  visibilityReason: "operator_only",
};

const line = (over: Partial<GuestLineInput>): GuestLineInput => ({
  simulationId: SIM_ID,
  roomChannelId: CHANNEL,
  actorId: "h:42",
  content: "Rafa, voce esta ai?",
  senderKind: "guest",
  senderName: "Visitante",
  mentionedAgentIds: ["rafa"],
  addresseeIds: ["rafa"],
  hearing: { rafa: "clear" },
  speakerTile: [3, 3],
  mode: "say",
  visibility: audible(["rafa"]),
  salience: "high",
  ...over,
});

async function setup() {
  const gateway = new MockDeliveryGateway();
  const seen: string[] = [];
  const agentRuntime: AgentRuntime = {
    generateIntent: vi.fn((input) => {
      seen.push(input.agentId);
      const intent: ActionIntent = {
        id: `i_${seen.length}`,
        actorId: input.agentId,
        intentType: "send_message",
        visibleContent: "oi, estou aqui",
        personTargets: [],
        privateMotiveSummary: "respondendo",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
        fallbackIfBlocked: "no_op",
      };
      return Promise.resolve({ intent, llmUsage: null, latencyMs: 1, fallbackApplied: false, operatorEvents: [] });
    }),
  };
  const runtime = new SimulationRuntime({ delivery: gateway, agentRuntime, llmBudget: { getPriority: () => "high" } });
  const agents: AgentContext[] = ["rafa", "duda"].map((id) => ({
    id,
    state: makeAgentState({ agentId: id, simulationId: SIM_ID }),
    persona: makePersona(id),
    displayName: id === "rafa" ? "Rafa" : "Duda",
  }));
  await runtime.createSimulation({
    id: SIM_ID,
    name: "hotel",
    agentContexts: agents,
    settings: { ...SETTINGS, maxMessagesPerMinutePerAgent: 100 },
    seed: 3,
    channels: [{ id: CHANNEL, type: "public_channel", name: "Lounge", memberAgentIds: ["rafa", "duda"], default: true }],
    hotel: { arbiter: {}, generateConcurrency: 3 },
  });
  return { runtime, gateway, seen };
}

describe("guest ingestion (ADR-0022)", () => {
  it("appends an untrusted message_sent that only its audience sees, and never echoes it to the hotel", async () => {
    const { runtime, gateway } = await setup();
    const event = await runtime.ingest(line({}));
    const heard = await runtime.ingest(line({ content: "ninguem escuta isso", visibility: unheard, hearing: {} }));

    expect(event.type).toBe("message_sent");
    expect(event.payload).toMatchObject({ untrusted: true, senderKind: "guest", mentionedAgentIds: ["rafa"], mode: "say" });
    expect(event.pulseIndex).toBe(runtime.getPulseIndex(SIM_ID));
    expect(gateway.agentMessages).toHaveLength(0); // appended through the log, not appendAndProject

    const channels = [{ id: CHANNEL } as never];
    const membership = ["rafa", "duda"].map((agentId) => ({ channelId: CHANNEL, agentId, joinedAt: 0 }));
    const visibleTo = (agentId: string) =>
      filterVisibleEventsForAgent([event, heard], agentId, channels, membership).map((e) => e.id);
    expect(visibleTo("rafa")).toEqual([event.id]);
    expect(visibleTo("duda")).toEqual([]); // not in visibleToAgents; the unheard line is operator_only for everyone
  });

  it("clips a guest line to the Tilehouse limit", async () => {
    const { runtime } = await setup();
    const event = await runtime.ingest(line({ content: "x".repeat(500) }));
    expect((event.payload["content"] as string).length).toBe(200);
  });

  it("a focused pulse answers the addressed guest line, under the arbiter, naming the speaker without an id", async () => {
    const { runtime, gateway, seen } = await setup();
    const ingested = await runtime.ingest(line({}));
    runtime.getArbiter(SIM_ID)!.noteHumanLine("lounge", { eventId: ingested.id, at: Date.now(), addressedIds: ["rafa"] });

    await runtime.runPulse(SIM_ID, { reason: "human_chat", focusAgentIds: ["rafa"], elapsedMs: 1500 });

    expect(seen).toEqual(["rafa"]);
    expect(gateway.agentMessages).toHaveLength(1);
    expect(gateway.agentMessages[0]!.message).toMatchObject({ kind: "message", agentId: "rafa" });
    const log = await runtime.getEventLog().getCommittedThrough(SIM_ID, Number.MAX_SAFE_INTEGER);
    const spoken = log.filter((e) => e.type === "message_sent" && e.actorId === "rafa");
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.payload["senderName"]).toBe("Rafa");
    expect(log.some((e) => e.type === "intent_blocked")).toBe(false);
  });

  it("a second, unaddressed answer to the same line becomes a recorded silence", async () => {
    const { runtime, gateway } = await setup();
    const ingested = await runtime.ingest(line({ mentionedAgentIds: [], addresseeIds: [], visibility: audible(["rafa", "duda"]), hearing: { rafa: "clear", duda: "clear" } }));
    runtime.getArbiter(SIM_ID)!.noteHumanLine("lounge", { eventId: ingested.id, at: Date.now(), addressedIds: [] });

    await runtime.runPulse(SIM_ID, { reason: "human_chat", focusAgentIds: ["rafa"], elapsedMs: 1500 });
    await runtime.runPulse(SIM_ID, { reason: "human_chat", focusAgentIds: ["duda"], elapsedMs: 1500 });

    const spoke = gateway.agentMessages.map((m) => m.message.agentId);
    expect(spoke).toHaveLength(1);
    const log = await runtime.getEventLog().getCommittedThrough(SIM_ID, Number.MAX_SAFE_INTEGER);
    expect(log.filter((e) => e.type === "no_op_recorded")).toHaveLength(1);
  });

  it("moves an actor between room channels through add/remove membership", async () => {
    const { runtime, gateway } = await setup();
    await runtime.registerRoomChannel(SIM_ID, { id: "room:roof", name: "Roof" });
    await runtime.removeChannelMember(CHANNEL, "duda");
    await runtime.addChannelMember("room:roof", "duda");
    expect(gateway.removedMembers).toContainEqual({ channelId: CHANNEL, agentId: "duda" });
    expect(gateway.addedMembers).toContainEqual({ channelId: "room:roof", agentId: "duda" });
    expect(await runtime.getChannelRegistry().isMember("duda", CHANNEL)).toBe(false);
    expect(await runtime.getChannelRegistry().isMember("duda", "room:roof")).toBe(true);
  });

  it("an actor who walks into a room speaks in that room's channel from then on", async () => {
    const { runtime } = await setup();
    await runtime.registerRoomChannel(SIM_ID, { id: "room:roof", name: "Roof" });
    await runtime.removeChannelMember(CHANNEL, "duda");
    await runtime.addChannelMember("room:roof", "duda");
    const ingested = await runtime.ingest(line({ roomChannelId: "room:roof", mentionedAgentIds: ["duda"], addresseeIds: ["duda"], hearing: { duda: "clear" }, visibility: audible(["duda"]) }));
    runtime.getArbiter(SIM_ID)!.noteHumanLine("roof", { eventId: ingested.id, at: Date.now(), addressedIds: ["duda"] });

    await runtime.runPulse(SIM_ID, { reason: "human_chat", focusAgentIds: ["duda"], elapsedMs: 1500 });

    const log = await runtime.getEventLog().getCommittedThrough(SIM_ID, Number.MAX_SAFE_INTEGER);
    const spoken = log.find((e) => e.type === "message_sent" && e.actorId === "duda");
    expect(spoken?.channelId).toBe("room:roof");
  });
});
