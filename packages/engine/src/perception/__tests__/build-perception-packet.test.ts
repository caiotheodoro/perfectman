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

describe("buildPerceptionPacket ownRecentUtterances", () => {
  const own = (id: string, content: string, pulseIndex: number) =>
    makeEvent("message_sent", { id, actorId: "agent-me", pulseIndex, createdAt: 1000 + pulseIndex, payload: { content } });

  it("keeps an own message that fell out of the shared window when the own-history window still holds it", () => {
    const old = own("evt_old", "gente, oficial: a proposta chegou", 1);
    const foreign = Array.from({ length: 6 }, (_, i) => makeEvent("message_sent", { id: `evt_f${i}`, actorId: "agent-x", pulseIndex: 10 + i }));
    const recent = own("evt_recent", "bora fechar hoje", 20);
    const packet = buildPerceptionPacket(
      makeAgent({ agentId: "agent-me" }),
      [...foreign, recent],
      null,
      [],
      attention,
      translated,
      [],
      [old, recent],
    );
    expect(packet.ownRecentUtterances).toEqual(["gente, oficial: a proposta chegou", "bora fechar hoje"]);
  });

  it("caps at OWN_UTTERANCE_WINDOW newest-last, dedupes by event id and collapses consecutive duplicates", () => {
    const history = Array.from({ length: 15 }, (_, i) => own(`evt_${i}`, i === 7 ? "same" : `line ${i}`, i));
    history.splice(8, 0, own("evt_dup", "same", 7));
    const packet = buildPerceptionPacket(makeAgent({ agentId: "agent-me" }), history.slice(-3), null, [], attention, translated, [], history);
    expect(packet.ownRecentUtterances).toHaveLength(12);
    expect(packet.ownRecentUtterances[packet.ownRecentUtterances.length - 1]).toBe("line 14");
    expect(packet.ownRecentUtterances.filter(u => u === "same")).toHaveLength(1);
  });
});
