import { describe, expect, it } from "vitest";
import type { Channel, ChannelMembership, EngineSnapshot, Simulation, WorldSignals } from "@perfectman/shared";
import { createSeededRng } from "@perfectman/shared";
import { makeAgent, makeEvent, makePersona } from "../../__tests__/fixtures.js";
import { loungeModel, person, T0, viewOf } from "../../space/__tests__/fixture.js";
import { redactForListener } from "../../visibility/filter-visible-events.js";
import { runEngineStep } from "../run-engine-step.js";

const SIM = {
  id: "sim1", name: "t", status: "running", agentIds: ["a1", "a2"], channelIds: ["room:lounge"], seed: 1, createdAt: 0, updatedAt: 0,
  settings: { omniscientSpectatorMode: false, allowPrivateChannels: true, maxPrivateChannelsPerAgent: 3, maxMessagesPerMinutePerAgent: 10, llmCallBudgetPerMinute: 20, pulseIntervalMs: 6000, tokenBudgetPerHour: 200000 },
} as Simulation;

const CHANNEL: Channel = {
  id: "room:lounge", simulationId: "sim1", type: "public_channel", name: "lounge", createdBy: "system",
  memberAgentIds: ["a1", "a2"], spectatorVisible: true, operatorVisible: true, createdForMotives: [], status: "active", createdAt: 0, updatedAt: 0,
};
const MEMBERS: ChannelMembership[] = ["a1", "a2"].map((agentId) => ({ channelId: "room:lounge", agentId, joinedAt: 0 }));
const WORLD: WorldSignals = { highArousalNearby: false, averageChannelArousal: 0.4, activeAgentCount: 2, timeSinceLastPublicMessage: 30, channelMessageRatePerMinute: 1, recentTopicShift: false };

function snapshot(over: Partial<EngineSnapshot> = {}): EngineSnapshot {
  return {
    pulseIndex: 3, simulation: SIM, recentEventsWindow: [], agentState: makeAgent({ agentId: "a1", simulationId: "sim1" }),
    persona: makePersona(), channels: [CHANNEL], channelMembership: MEMBERS, relationalStates: new Map(), worldSignals: WORLD,
    rateLimitStatus: { agentId: "a1", messagesThisMinute: 0, privateChannelsCreated: 0, lastActionAt: null, blocked: false },
    dt: 6, rng: createSeededRng(7), now: T0 + 1000, ...over,
  };
}

const msg = (id: string, payload: Record<string, unknown>) =>
  makeEvent("message_sent", { id, channelId: "room:lounge", actorId: "a2", payload, emotionalSalience: "medium" });

describe("runEngineStep in hotel mode", () => {
  it("without a space the packet has no body keys at all", () => {
    const r = runEngineStep(snapshot({ recentEventsWindow: [msg("e1", { content: "oi" })] }));
    expect("body" in r.perceptionPacket).toBe(false);
    expect("bodyHandles" in r.perceptionPacket).toBe(false);
    expect(r.visibleEvents[0]!.payload["content"]).toBe("oi");
  });

  it("with a space it builds the body block and redacts what the agent could not hear", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4]), person("a2", "Duda", [6, 4])], ["a1"]);
    const garbled = msg("e1", { content: "segredo do bar", hearing: { a1: "garbled" }, senderName: "Duda" });
    const r = runEngineStep(snapshot({ space: viewOf(model, "a1", T0 + 1000), recentEventsWindow: [garbled] }));
    expect(r.perceptionPacket.body?.self.room).toBe("Lounge");
    expect(r.perceptionPacket.bodyHandles).toBeDefined();
    const seen = r.visibleEvents[0]!;
    expect(seen.payload["content"]).toBeUndefined();
    expect(seen.payload["heardAs"]).toBe("garbled");
    expect(JSON.stringify(r.perceptionPacket.visibleContextEvents)).not.toContain("segredo");
    expect(r.perceptionPacket.body?.hearing).toEqual([{ name: "Duda", level: "garbled" }]);
  });

  it("[NEG-2] the body block carries `drama` only when the view does, and a view without it leaves no key behind", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4]), person("a2", "Duda", [6, 4])], ["a1"]);
    const plain = runEngineStep(snapshot({ space: viewOf(model, "a1", T0 + 1000) }));
    expect("drama" in plain.perceptionPacket.body!).toBe(false);
    const on = runEngineStep(snapshot({ space: { ...viewOf(model, "a1", T0 + 1000), drama: true } }));
    expect(on.perceptionPacket.body?.drama).toBe(true);
    expect(on.perceptionPacket.body?.people).toEqual(plain.perceptionPacket.body?.people);
  });

  it("the body block carries `craft` (the slim KB's style lines) only with drama and only when the view does, and a view without it leaves no key behind", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4]), person("a2", "Duda", [6, 4])], ["a1"]);
    const view = viewOf(model, "a1", T0 + 1000);
    const lines = "Style reference, for the pressure and pace of the talk only, never quoted:\n- A: Sit. (The Tin Crown, A. Nobody, public domain)";
    const plain = runEngineStep(snapshot({ space: { ...view, drama: true } }));
    expect("craft" in plain.perceptionPacket.body!).toBe(false);
    const with_ = runEngineStep(snapshot({ space: { ...view, drama: true, craft: lines } }));
    expect(with_.perceptionPacket.body?.craft).toBe(lines);
    expect(with_.perceptionPacket.body?.people).toEqual(plain.perceptionPacket.body?.people);
    const noDrama = runEngineStep(snapshot({ space: { ...view, craft: lines } }));
    expect("craft" in noDrama.perceptionPacket.body!).toBe(false);
  });

  it("arriving (own body_arrived) wakes the agent for the model", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4])], ["a1"]);
    const arrived = makeEvent("body_arrived", { id: "e9", channelId: "room:lounge", actorId: "a1", payload: { planId: "p", room: "lounge", tile: [5, 4] } });
    const r = runEngineStep(snapshot({ space: viewOf(model, "a1", T0 + 1000), recentEventsWindow: [arrived] }));
    expect(r.attentionResults.reasons).toContain("objective_urgency");
    expect(r.attentionResults.needsLLM).toBe(true);
    expect(r.decision.needsLLM).toBe(true);
  });
});

describe("redactForListener", () => {
  it("keeps clear, absent and named-garbled events by identity", () => {
    const clear = msg("e1", { content: "oi", hearing: { a1: "clear" } });
    const none = msg("e2", { content: "oi" });
    const named = msg("e3", { content: "Ana, vem", hearing: { a1: "garbled" }, mentionedAgentIds: ["a1"] });
    for (const e of [clear, none, named]) expect(redactForListener(e, "a1")).toBe(e);
  });

  it("a whisper notice loses its text and says how it was heard", () => {
    const e = msg("e1", { content: "psiu", hearing: { a1: "notice" }, senderName: "Léo" });
    const r = redactForListener(e, "a1");
    expect(r).not.toBe(e);
    expect(r.payload).toEqual({ hearing: { a1: "notice" }, senderName: "Léo", heardAs: "notice" });
    expect(e.payload["content"]).toBe("psiu");
  });
});
