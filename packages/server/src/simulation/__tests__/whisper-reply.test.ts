import { describe, it, expect } from "vitest";
import type { ActionIntent, CommittedEvent } from "@perfectman/shared";
import { whisperer } from "../whisper-reply.js";

const intent = (over: Partial<ActionIntent> = {}): ActionIntent =>
  ({ id: "i1", actorId: "person-1", intentType: "send_message", visibleContent: "oi", privateMotiveSummary: "x", personTargets: [], ...over }) as ActionIntent;

const trigger = (over: Record<string, unknown> = {}, actorId = "h:9"): CommittedEvent =>
  ({
    id: "e1",
    simulationId: "s",
    channelId: "room:12",
    actorId,
    type: "message_sent",
    payload: { content: "psiu", untrusted: true, senderName: "ana", mode: "whisper", hearing: { "person-1": "clear" }, ...over },
    createdAt: 1,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "high",
    visibility: { visibleToAgents: ["person-1"], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "distance" },
  }) as CommittedEvent;

describe("who an actor's reply is whispered back to (D44)", () => {
  it("is the person whose whisper only this actor heard clearly", () => {
    expect(whisperer(trigger(), intent())).toEqual({ ref: "h:9", name: "ana" });
    expect(whisperer(trigger(), intent({ intentType: "reply_to_message", replyToActorId: "h:9" }))).toEqual({ ref: "h:9", name: "ana" });
  });

  it("is nobody for a spoken line, a notice, a trusted trigger, an actor's own line or a non-speech intent", () => {
    expect(whisperer(trigger({ mode: "say" }), intent())).toBeUndefined();
    expect(whisperer(trigger({ hearing: { "person-1": "notice" } }), intent())).toBeUndefined();
    expect(whisperer(trigger({ untrusted: false }), intent())).toBeUndefined();
    expect(whisperer(trigger({}, "person-1"), intent())).toBeUndefined();
    expect(whisperer(trigger(), intent({ intentType: "no_op" }))).toBeUndefined();
    expect(whisperer(trigger(), intent({ intentType: "react" }))).toBeUndefined();
    expect(whisperer(undefined, intent())).toBeUndefined();
  });

  it("leaves a reply to somebody else's own line alone", () => {
    expect(whisperer(trigger(), intent({ intentType: "reply_to_message", replyToActorId: "person-2" }))).toBeUndefined();
  });
});
