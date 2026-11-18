/**
 * What the browser learns about channels. A private room's membership
 * changes after it is created — someone is invited, someone leaves — and the
 * viewer draws the room from the member list, so it has to hear about it.
 */
import { describe, expect, it, vi } from "vitest";
import { SseDeliveryGateway } from "../sse-delivery-gateway.js";
import { SseHub, type SseMessage } from "../../http/sse-hub.js";
import type { LivePulseFrame, OperatorEvent } from "@perfectman/shared";

function harness() {
  const published: SseMessage[] = [];
  const hub = new SseHub();
  vi.spyOn(hub, "publish").mockImplementation((message: SseMessage) => {
    published.push(message);
  });
  const gateway = new SseDeliveryGateway(hub, { simulationId: "s", simulationName: "s", agents: {}, channels: { geral: { name: "geral" } } });
  const channels = () => published.filter((m) => m.type === "channel").map((m) => (m.data as { channel: { id: string; memberAgentIds: string[] } }).channel);
  return { gateway, published, channels };
}

describe("SseDeliveryGateway channels", () => {
  it("tells the viewer when someone is added to a room", async () => {
    const { gateway, channels } = harness();
    await gateway.createChannel("dm", "private_channel", ["kiko"]);
    await gateway.addMember("dm", "vasco");
    const last = channels().at(-1);
    expect(last?.id).toBe("dm");
    expect(last?.memberAgentIds.sort()).toEqual(["vasco", "kiko"]);
  });

  it("tells the viewer when someone leaves", async () => {
    const { gateway, channels } = harness();
    await gateway.createChannel("dm", "private_channel", ["kiko", "vasco"]);
    await gateway.removeMember("dm", "kiko");
    expect(channels().at(-1)?.memberAgentIds).toEqual(["vasco"]);
  });

  it("merges members when the same room is announced twice", async () => {
    const { gateway, channels } = harness();
    await gateway.createChannel("dm", "private_channel", ["kiko"]);
    await gateway.createChannel("dm", "private_channel", ["vasco"]);
    expect(channels().at(-1)?.memberAgentIds.sort()).toEqual(["vasco", "kiko"]);
  });

  it("does not repeat a room whose members did not change", async () => {
    const { gateway, channels } = harness();
    await gateway.createChannel("dm", "private_channel", ["kiko"]);
    await gateway.addMember("dm", "kiko");
    expect(channels()).toHaveLength(1);
  });

  it("uses distinct replay keys and no lossy coalescing for different pulses", () => {
    const { gateway, published } = harness();
    gateway.commitPulse({ pulseIndex: 0, eventsCommitted: 0, agentsCalled: 0 });
    gateway.commitPulse({ pulseIndex: 1, eventsCommitted: 0, agentsCalled: 0 });
    const pulses = published.filter((m) => m.type === "pulse");
    expect(pulses).toHaveLength(2);
    expect(pulses.every((m) => m.coalesceKey === undefined)).toBe(true);
    expect(pulses.map((m) => m.replayKey)).toEqual(["pulse:0", "pulse:1"]);
  });
});

it("publishes immutable committed revisions before the pulse settles, then seals it", async () => {
  const { gateway, published } = harness();
  const event = (type: OperatorEvent["type"], data: NonNullable<OperatorEvent["data"]>): OperatorEvent => ({
    type, data, agentId: "kiko", simulationId: "s", pulseIndex: 0, createdAt: 1,
  });
  const frames = () => published.filter((m) => m.type === "pulse").map((m) => (m.data as { frame: LivePulseFrame }).frame);

  await gateway.sendOperatorEvent(event("action_intent", {
    intentType: "send_message", visibleContent: "A draft", privateMotiveSummary: "I care", emotionDrivers: ["affection"],
  }));
  expect(frames()).toHaveLength(0);
  await gateway.sendOperatorEvent(event("event_visibility", {
    eventId: "first", eventType: "message_sent", actorId: "kiko", channelId: "geral", content: "Committed first", visibleToAgents: ["kiko"],
  }));
  const first = frames()[0];
  expect(first).toMatchObject({ complete: false, revision: 1, thinking: { kiko: { visibleContent: "A draft" } } });
  expect(first?.messages.map((m) => m.eventId)).toEqual(["first"]);

  await gateway.sendOperatorEvent(event("agent_state_snapshot", {
    state: { coreMood: { valence: 0.4, arousal: 0.7 }, socialEmotions: { affection: 0.8 } },
  }));
  await gateway.sendOperatorEvent(event("event_visibility", {
    eventId: "second", eventType: "message_sent", actorId: "kiko", channelId: "geral", content: "Committed second", visibleToAgents: ["kiko"],
  }));
  const final = gateway.commitPulse({ pulseIndex: 0, eventsCommitted: 2, agentsCalled: 1 });
  expect(final).toMatchObject({ complete: true, revision: 4, emotions: { kiko: { valence: 0.4, arousal: 0.7, top: [{ key: "affection", value: 0.8 }] } } });
  expect(final.messages.map((m) => m.eventId)).toEqual(["first", "second"]);
  expect(first?.messages.map((m) => m.eventId)).toEqual(["first"]);
  expect(first?.emotions).toEqual({});
  expect(published.filter((m) => m.type === "pulse").every((m) => m.replayKey === "pulse:0")).toBe(true);
});
