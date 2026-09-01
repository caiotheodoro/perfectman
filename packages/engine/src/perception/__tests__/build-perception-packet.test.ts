import { describe, it, expect } from "vitest";
import { buildPerceptionPacket } from "../build-perception-packet.js";
import { makeAgent, makeEvent } from "../../__tests__/fixtures.js";
import type {
  AttentionResult,
  TranslatedEmotionalState,
} from "@perfectman/shared";

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
    const trigger = makeEvent("message_sent", { id: "evt_trigger", actorId: "agent-peer" });
    const ctx1 = makeEvent("message_sent", { id: "evt_ctx_1", actorId: "agent-x" });
    const ctx2 = makeEvent("message_sent", { id: "evt_ctx_2", actorId: "agent-y" });

    const packet = buildPerceptionPacket(
      makeAgent({ agentId: "agent-me" }),
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
    const ctx1 = makeEvent("message_sent", { id: "evt_a", actorId: "agent-x" });
    const ctx2 = makeEvent("message_sent", { id: "evt_b", actorId: "agent-y" });

    const packet = buildPerceptionPacket(makeAgent({ agentId: "agent-me" }), [ctx1, ctx2], null, [], attention, translated, []);

    expect(packet.eventHandles).toEqual({ e1: "evt_a", e2: "evt_b" });
  });

  it("returns an empty handle map when nothing is in view", () => {
    const packet = buildPerceptionPacket(makeAgent({ agentId: "agent-me" }), [], null, [], attention, translated, []);
    expect(packet.eventHandles).toEqual({});
  });
});
