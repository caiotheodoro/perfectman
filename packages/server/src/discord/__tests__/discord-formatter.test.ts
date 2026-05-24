import { describe, it, expect } from "vitest";
import {
  formatDeliveryMessage,
  formatSpectatorEvent,
  formatOperatorEvent,
} from "../discord-formatter.js";
import type { DeliveryMessage } from "../../simulation/scheduler-contracts.js";
import type { SpectatorEvent, OperatorEvent } from "@perfectman/shared";

describe("formatDeliveryMessage", () => {
  it("formats message kind", () => {
    const msg: DeliveryMessage = {
      kind: "message",
      agentId: "alice",
      content: "hello world",
      salience: "medium",
    };
    const result = formatDeliveryMessage(msg);
    expect(result.content).toBe("hello world");
    expect(result.allowedMentions).toEqual({ parse: [] });
  });

  it("formats reply kind", () => {
    const msg: DeliveryMessage = {
      kind: "reply",
      agentId: "bob",
      content: "replying",
      replyToEventId: "evt-1",
      salience: "high",
    };
    expect(formatDeliveryMessage(msg).content).toBe("replying");
  });

  it("formats reaction kind with emoji", () => {
    const msg: DeliveryMessage = {
      kind: "reaction",
      agentId: "alice",
      emoji: "👍",
      targetEventId: "evt-1",
      salience: "low",
    };
    expect(formatDeliveryMessage(msg).content).toBe("👍");
  });

  it("truncates at 1900 chars", () => {
    const msg: DeliveryMessage = {
      kind: "message",
      agentId: "alice",
      content: "x".repeat(2000),
      salience: "medium",
    };
    const result = formatDeliveryMessage(msg);
    expect(result.content.length).toBe(1900);
    expect(result.content.endsWith("...")).toBe(true);
  });

  it("handles empty content", () => {
    const msg: DeliveryMessage = {
      kind: "message",
      agentId: "alice",
      content: "",
      salience: "low",
    };
    expect(formatDeliveryMessage(msg).content).toBe("(empty)");
  });

  it("always suppresses mentions", () => {
    const msg: DeliveryMessage = {
      kind: "message",
      agentId: "alice",
      content: "@everyone hello",
      salience: "critical",
    };
    expect(formatDeliveryMessage(msg).allowedMentions).toEqual({ parse: [] });
  });
});

describe("formatSpectatorEvent", () => {
  it("uses [recap] prefix for recap type", () => {
    const event: SpectatorEvent = {
      type: "recap",
      simulationId: "sim-1",
      summary: "things happened",
      createdAt: 1000,
      pulseIndex: 1,
    };
    const result = formatSpectatorEvent(event);
    expect(result.content).toMatch(/^\[recap\]/);
    expect(result.allowedMentions).toEqual({ parse: [] });
  });

  it("uses [spectator] prefix for other types", () => {
    const event: SpectatorEvent = {
      type: "motive_reveal",
      simulationId: "sim-1",
      visibleContent: "revealed motive",
      createdAt: 1000,
      pulseIndex: 1,
    };
    expect(formatSpectatorEvent(event).content).toMatch(/^\[spectator\]/);
  });
});

describe("formatOperatorEvent", () => {
  it("formats with type prefix", () => {
    const event: OperatorEvent = {
      type: "llm_failure",
      simulationId: "sim-1",
      pulseIndex: 1,
      detail: "timeout after 30s",
      createdAt: 1000,
    };
    const result = formatOperatorEvent(event);
    expect(result.content).toBe("[operator:llm_failure] timeout after 30s");
    expect(result.allowedMentions).toEqual({ parse: [] });
  });
});
