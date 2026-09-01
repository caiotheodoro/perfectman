import { describe, it, expect } from "vitest";
import { IntentParser, type TargetResolutionContext } from "../intent-parser.js";
import type { AvailableAction } from "@perfectman/shared";
import { makeEvent, replyIntentJson, reactIntentJson } from "../../__tests__/fixtures.js";

const actorId = "agent-me";

const availableActions: AvailableAction[] = [
  { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
  { intentType: "reply_to_message", channelTargets: ["general"], personTargets: ["agent-peer"], blocked: false },
  { intentType: "react", channelTargets: ["general"], personTargets: [], blocked: false },
];

const triggering = makeEvent({ id: "evt_trigger", actorId: "agent-peer" });
const ctxEvent = makeEvent({ id: "evt_ctx", actorId: "agent-other" });

function targetContext(overrides: Partial<TargetResolutionContext> = {}): TargetResolutionContext {
  return {
    eventHandles: { e1: "evt_trigger", e2: "evt_ctx" },
    events: [triggering, ctxEvent],
    triggeringEventId: "evt_trigger",
    ...overrides,
  };
}

describe("IntentParser reply/react target resolution", () => {
  it("resolves a valid handle to the real event id and stamps replyToActorId", () => {
    const result = IntentParser.parse(replyIntentJson("e1"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.unresolvedTarget).toBeUndefined();
    expect(result.intent.replyToEventId).toBe("evt_trigger");
    expect(result.intent.replyToActorId).toBe("agent-peer");
  });

  it("tolerates a bracket-wrapped handle ('[e2]')", () => {
    const result = IntentParser.parse(replyIntentJson("[e2]"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.replyToEventId).toBe("evt_ctx");
    expect(result.intent.replyToActorId).toBe("agent-other");
  });

  it("accepts a real event id the model copied verbatim when it is in view", () => {
    const result = IntentParser.parse(replyIntentJson("evt_ctx"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.replyToEventId).toBe("evt_ctx");
  });

  it("resolves a react targetEventId handle without setting replyToActorId", () => {
    const result = IntentParser.parse(reactIntentJson("e1"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.targetEventId).toBe("evt_trigger");
    expect(result.intent.replyToActorId).toBeUndefined();
  });

  it("flags an invented slug as a retriable unresolved target (no fallback intent yet)", () => {
    const result = IntentParser.parse(replyIntentJson("marianas-last-message"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.intentType).toBe("reply_to_message");
    expect(result.unresolvedTarget).toEqual({
      field: "replyToEventId",
      badHandle: "marianas-last-message",
      validHandles: ["e1", "e2"],
    });
  });

  it("flags an empty replyToEventId as unresolved", () => {
    const result = IntentParser.parse(replyIntentJson(""), actorId, availableActions, "no_op", targetContext());

    expect(result.unresolvedTarget?.field).toBe("replyToEventId");
    expect(result.unresolvedTarget?.badHandle).toBe("");
  });

  it("leaves the raw target string untouched when no targetContext is supplied (legacy passthrough)", () => {
    const result = IntentParser.parse(replyIntentJson("e1"), actorId, availableActions);

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.replyToEventId).toBe("e1");
    expect(result.unresolvedTarget).toBeUndefined();
  });

  describe("floorTargets (retry-exhausted floor)", () => {
    it("infers the triggering event as the reply target and stamps its actor", () => {
      const parsed = IntentParser.parse(replyIntentJson("bogus"), actorId, availableActions, "no_op", targetContext());
      const floored = IntentParser.floorTargets(parsed.intent, targetContext());

      expect(floored.outcome).toBe("floored");
      expect(floored.field).toBe("replyToEventId");
      expect(floored.resolvedEventId).toBe("evt_trigger");
      expect(floored.detail).toContain("evt_trigger");
      expect(floored.intent.intentType).toBe("reply_to_message");
      expect(floored.intent.replyToEventId).toBe("evt_trigger");
      expect(floored.intent.replyToActorId).toBe("agent-peer");
    });

    it("falls to the most recent visible message when there is no triggering event", () => {
      const ctx = targetContext({ triggeringEventId: undefined, events: [ctxEvent], eventHandles: { e1: "evt_ctx" } });
      const parsed = IntentParser.parse(replyIntentJson("bogus"), actorId, availableActions, "no_op", ctx);
      const floored = IntentParser.floorTargets(parsed.intent, ctx);

      expect(floored.intent.replyToEventId).toBe("evt_ctx");
      expect(floored.intent.replyToActorId).toBe("agent-other");
    });

    it("downgrades a reply to send_message when there is no event to target", () => {
      const ctx = targetContext({ triggeringEventId: undefined, events: [], eventHandles: {} });
      const parsed = IntentParser.parse(replyIntentJson("bogus"), actorId, availableActions, "no_op", ctx);
      const floored = IntentParser.floorTargets(parsed.intent, ctx);

      expect(floored.outcome).toBe("downgraded");
      expect(floored.intent.intentType).toBe("send_message");
      expect(floored.intent.replyToEventId).toBeUndefined();
      expect(floored.intent.replyToActorId).toBeUndefined();
      expect(floored.intent.visibleContent).toBe("yes I did");
    });

    it("drops a reaction when there is no triggering event and no visible message", () => {
      const ctx = targetContext({ triggeringEventId: undefined, events: [], eventHandles: {} });
      const parsed = IntentParser.parse(reactIntentJson("bogus"), actorId, availableActions, "no_op", ctx);
      const floored = IntentParser.floorTargets(parsed.intent, ctx);

      expect(floored.outcome).toBe("dropped");
      expect(floored.field).toBe("targetEventId");
    });

    it("does not mutate the intent passed in", () => {
      const parsed = IntentParser.parse(replyIntentJson("bogus"), actorId, availableActions, "no_op", targetContext());
      const before = parsed.intent.replyToEventId;
      IntentParser.floorTargets(parsed.intent, targetContext());
      expect(parsed.intent.replyToEventId).toBe(before);
    });
  });
});
