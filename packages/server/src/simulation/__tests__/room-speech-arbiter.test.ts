import { describe, it, expect } from "vitest";
import { RoomSpeechArbiter, roomIdOfChannel } from "../room-speech-arbiter.js";
import { IntentResolver } from "../intent-resolver.js";
import { RateLimitGate } from "../rate-limit-gate.js";
import { ChannelRegistry } from "../channel-registry.js";
import { InMemoryChannelRepository } from "../in-memory-stores.js";
import { SETTINGS, ZERO_ACTION, makeAgentState } from "./fixtures.js";
import type { ActionIntent, AvailableAction } from "@perfectman/shared";

const ROOM = "lounge";
const reasonOf = (d: ReturnType<RoomSpeechArbiter["gate"]>) =>
  d.outcome === "blocked" ? d.violation.detail : "allowed";

describe("RoomSpeechArbiter rules (ADR-0021)", () => {
  it("never blocks the addressed reply, and an addressee answers once", () => {
    const arbiter = new RoomSpeechArbiter();
    arbiter.noteHumanLine(ROOM, { eventId: "h1", at: 1_000, addressedIds: ["rafa"] });
    expect(arbiter.classify("rafa", ROOM, 2_000)).toBe("addressed");
    expect(reasonOf(arbiter.gate("rafa", ROOM, "addressed", 2_000))).toBe("allowed");
    // Having answered, the same agent is an interjection into its own line.
    expect(arbiter.classify("rafa", ROOM, 3_000)).toBe("interjection");
  });

  it.each([
    {
      name: "a bystander may not talk over an unanswered addressee",
      line: { addressedIds: ["rafa"] },
      speaker: "duda",
      expected: "room_speech:not_addressed_open_line",
    },
    {
      name: "an unaddressed human line gets one answer, not two",
      line: { addressedIds: [] },
      pre: ["duda"],
      speaker: "gabi",
      expected: "room_speech:one_answer_per_line",
    },
    {
      name: "bots yield after three lines for one human line",
      line: { addressedIds: ["rafa"] },
      pre: ["rafa", "duda", "gabi"],
      speaker: "leo",
      expected: "room_speech:line_budget",
    },
  ])("$name", ({ line, pre = [], speaker, expected }) => {
    const arbiter = new RoomSpeechArbiter();
    arbiter.noteHumanLine(ROOM, { eventId: "h1", at: 1_000, addressedIds: line.addressedIds });
    for (const id of pre) arbiter.gate(id, ROOM, arbiter.classify(id, ROOM, 2_000), 2_000);
    const kind = arbiter.classify(speaker, ROOM, 3_000);
    expect(kind).toBe("interjection");
    expect(reasonOf(arbiter.gate(speaker, ROOM, kind, 3_000))).toBe(expected);
  });

  it("holds ambient lines while a human types (up to 6 s) and until the room has been quiet for 10 s", () => {
    const arbiter = new RoomSpeechArbiter();
    arbiter.noteHumanTyping(ROOM, true, 1_000);
    expect(reasonOf(arbiter.gate("duda", ROOM, "ambient", 5_000))).toBe("room_speech:human_typing");
    expect(reasonOf(arbiter.gate("duda", ROOM, "ambient", 7_500))).toBe("allowed"); // 6 s after the last typing frame
    arbiter.noteHumanLine(ROOM, { eventId: "h2", at: 20_000, addressedIds: [] });
    expect(reasonOf(arbiter.gate("duda", ROOM, "ambient", 25_000))).toBe("room_speech:ambient_too_soon");
    expect(arbiter.classify("duda", ROOM, 31_000)).toBe("ambient");
    expect(reasonOf(arbiter.gate("duda", ROOM, "ambient", 31_000))).toBe("allowed");
  });

  it("preview only skips an agent every reading of its line would deny", () => {
    const arbiter = new RoomSpeechArbiter();
    expect(arbiter.preview("duda", ROOM, 0).outcome).toBe("allowed");
    arbiter.noteHumanTyping(ROOM, true, 0);
    expect(arbiter.preview("duda", ROOM, 1_000).outcome).toBe("blocked");
    arbiter.noteHumanLine(ROOM, { eventId: "h1", at: 2_000, addressedIds: ["rafa"] });
    expect(arbiter.preview("rafa", ROOM, 2_500).outcome).toBe("allowed"); // addressed
  });

  it("scenario energy shortens the quiet period", () => {
    const calm = new RoomSpeechArbiter({ scenarioEnergy: 0 });
    const lively = new RoomSpeechArbiter({ scenarioEnergy: 1 });
    for (const a of [calm, lively]) a.noteHumanLine(ROOM, { eventId: "h", at: 0, addressedIds: [] });
    expect(calm.classify("duda", ROOM, 12_000)).toBe("interjection"); // 15 s
    expect(lively.classify("duda", ROOM, 12_000)).toBe("ambient"); // 5 s
  });

  it("only arbitrates room channels", () => {
    expect(roomIdOfChannel("room:lounge")).toBe("lounge");
    expect(roomIdOfChannel("ch_public")).toBeUndefined();
  });
});

describe("IntentResolver with the arbiter: a denial is policy_blocked and falls back to a recorded silence", () => {
  const intent = (actorId: string): ActionIntent => ({
    id: `i_${actorId}`,
    actorId,
    intentType: "send_message",
    visibleContent: "oi",
    personTargets: [],
    privateMotiveSummary: "x",
    emotionDrivers: [],
    motivationDrivers: [],
    memoryWrites: [],
    fallbackIfBlocked: "no_op",
  });
  const actions: AvailableAction[] = [
    { intentType: "send_message", channelTargets: [], personTargets: [], blocked: false },
    { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
  ];

  it("commits a no_op, never a message, and spends no rate-limit counter", async () => {
    const arbiter = new RoomSpeechArbiter();
    arbiter.noteHumanLine(ROOM, { eventId: "h1", at: Date.now(), addressedIds: [] });
    arbiter.gate("duda", ROOM, "interjection", Date.now()); // the one answer
    const gate = new RateLimitGate(SETTINGS);
    const resolver = new IntentResolver(gate, new ChannelRegistry(new InMemoryChannelRepository()), arbiter);
    const ctx = {
      simulationId: "s",
      channelId: `room:${ROOM}`,
      pulseIndex: 3,
      agentState: makeAgentState({ agentId: "gabi" }),
      availableActions: actions,
      channels: [],
      membership: [],
      settings: SETTINGS,
      actionEmotions: ZERO_ACTION,
    };
    const resolved = await resolver.resolve(intent("gabi"), ctx);
    expect(resolved.outcome).toBe("fallback_committed");
    const types = resolved.committedEvents.map((e) => e.type);
    expect(types).toContain("intent_blocked");
    expect(types).toContain("no_op_recorded");
    expect(types).not.toContain("message_sent");
    const block = resolved.committedEvents.find((e) => e.type === "intent_blocked")!;
    expect(block.payload["violations"]).toEqual([{ type: "policy_blocked", detail: "room_speech:one_answer_per_line" }]);
    expect(gate.getStatus("gabi").messagesThisMinute).toBe(0);
  });
});
