import { describe, it, expect } from "vitest";
import { IntentParser, type TargetResolutionContext } from "../intent-parser.js";
import type { AvailableAction, CommittedEvent } from "@perfectman/shared";

const actorId = "agent-me";

const availableActions: AvailableAction[] = [
  { intentType: "send_message", channelTargets: ["general-id"], personTargets: [], blocked: false },
  { intentType: "reply_to_message", channelTargets: ["general-id"], personTargets: ["agent-peer"], blocked: false },
  { intentType: "react", channelTargets: ["general-id"], personTargets: [], blocked: false },
];

function event(id: string, actor: string, type: CommittedEvent["type"] = "message_sent"): CommittedEvent {
  return {
    id,
    simulationId: "sim-1",
    channelId: "general-id",
    actorId: actor,
    type,
    payload: { content: `content of ${id}` },
    createdAt: 1,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  };
}

const triggering = event("evt_trigger", "agent-peer");
const ctxEvent = event("evt_ctx", "agent-other");

function targetContext(overrides: Partial<TargetResolutionContext> = {}): TargetResolutionContext {
  return {
    eventHandles: { e1: "evt_trigger", e2: "evt_ctx" },
    events: [triggering, ctxEvent],
    triggeringEventId: "evt_trigger",
    ...overrides,
  };
}

function replyJson(replyToEventId: string): string {
  return JSON.stringify({
    intentType: "reply_to_message",
    channelTarget: "general-id",
    personTargets: ["agent-peer"],
    visibleContent: "responding to you",
    replyToEventId,
    privateMotiveSummary: "engage the thread",
    emotionDrivers: [],
    motivationDrivers: [],
  });
}

function reactJson(targetEventId: string): string {
  return JSON.stringify({
    intentType: "react",
    channelTarget: "general-id",
    emoji: "🔥",
    targetEventId,
    privateMotiveSummary: "signal approval",
    emotionDrivers: [],
    motivationDrivers: [],
  });
}

describe("IntentParser reply/react target resolution", () => {
  it("resolves a valid handle to the real event id and stamps replyToActorId", () => {
    const result = IntentParser.parse(replyJson("e1"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.unresolvedTarget).toBeUndefined();
    expect(result.intent.replyToEventId).toBe("evt_trigger");
    expect(result.intent.replyToActorId).toBe("agent-peer");
  });

  it("tolerates a bracket-wrapped handle ('[e2]')", () => {
    const result = IntentParser.parse(replyJson("[e2]"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.replyToEventId).toBe("evt_ctx");
    expect(result.intent.replyToActorId).toBe("agent-other");
  });

  it("accepts a real event id the model copied verbatim when it is in view", () => {
    const result = IntentParser.parse(replyJson("evt_ctx"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.replyToEventId).toBe("evt_ctx");
  });

  it("resolves a react targetEventId handle without setting replyToActorId", () => {
    const result = IntentParser.parse(reactJson("e1"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.targetEventId).toBe("evt_trigger");
    expect(result.intent.replyToActorId).toBeUndefined();
  });

  it("flags an invented slug as a retriable unresolved target (no fallback intent yet)", () => {
    const result = IntentParser.parse(replyJson("marianas-last-message"), actorId, availableActions, "no_op", targetContext());

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.intentType).toBe("reply_to_message");
    expect(result.unresolvedTarget).toEqual({
      field: "replyToEventId",
      badHandle: "marianas-last-message",
      validHandles: ["e1", "e2"],
    });
  });

  it("flags an empty replyToEventId as unresolved", () => {
    const result = IntentParser.parse(replyJson(""), actorId, availableActions, "no_op", targetContext());

    expect(result.unresolvedTarget?.field).toBe("replyToEventId");
    expect(result.unresolvedTarget?.badHandle).toBe("");
  });

  it("leaves the raw target string untouched when no targetContext is supplied (legacy passthrough)", () => {
    const result = IntentParser.parse(replyJson("e1"), actorId, availableActions);

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.replyToEventId).toBe("e1");
    expect(result.unresolvedTarget).toBeUndefined();
  });

  describe("floorTargets (retry-exhausted floor)", () => {
    it("infers the triggering event as the reply target and stamps its actor", () => {
      const parsed = IntentParser.parse(replyJson("bogus"), actorId, availableActions, "no_op", targetContext());
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
      const parsed = IntentParser.parse(replyJson("bogus"), actorId, availableActions, "no_op", ctx);
      const floored = IntentParser.floorTargets(parsed.intent, ctx);

      expect(floored.intent.replyToEventId).toBe("evt_ctx");
      expect(floored.intent.replyToActorId).toBe("agent-other");
    });

    it("downgrades a reply to send_message when there is no event to target", () => {
      const ctx = targetContext({ triggeringEventId: undefined, events: [], eventHandles: {} });
      const parsed = IntentParser.parse(replyJson("bogus"), actorId, availableActions, "no_op", ctx);
      const floored = IntentParser.floorTargets(parsed.intent, ctx);

      expect(floored.outcome).toBe("downgraded");
      expect(floored.intent.intentType).toBe("send_message");
      expect(floored.intent.replyToEventId).toBeUndefined();
      expect(floored.intent.replyToActorId).toBeUndefined();
      expect(floored.intent.visibleContent).toBe("responding to you");
    });

    it("drops a reaction when there is no triggering event and no visible message", () => {
      const ctx = targetContext({ triggeringEventId: undefined, events: [], eventHandles: {} });
      const parsed = IntentParser.parse(reactJson("bogus"), actorId, availableActions, "no_op", ctx);
      const floored = IntentParser.floorTargets(parsed.intent, ctx);

      expect(floored.outcome).toBe("dropped");
      expect(floored.field).toBe("targetEventId");
    });

    it("does not mutate the intent passed in", () => {
      const parsed = IntentParser.parse(replyJson("bogus"), actorId, availableActions, "no_op", targetContext());
      const before = parsed.intent.replyToEventId;
      IntentParser.floorTargets(parsed.intent, targetContext());
      expect(parsed.intent.replyToEventId).toBe(before);
    });
  });
});
