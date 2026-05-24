import { describe, it, expect } from "vitest";
import { IntentParser } from "../intent-parser.js";
import type { AvailableAction } from "@perfectman/shared";

describe("IntentParser", () => {
  const actorId = "agent-bruno";

  const availableActions: AvailableAction[] = [
    {
      intentType: "send_message",
      channelTargets: ["general-id", "random-id"],
      personTargets: [],
      blocked: false,
    },
    {
      intentType: "reply_to_message",
      channelTargets: ["general-id"],
      personTargets: ["agent-caio", "agent-goulart"],
      blocked: false,
    },
    {
      intentType: "create_channel",
      channelTargets: [],
      personTargets: ["agent-caio"],
      blocked: true,
      blockReason: "Rate limited on private channel creation",
    },
  ];

  it("should successfully parse clean, valid JSON matching ActionIntent schema", () => {
    const rawText = JSON.stringify({
      id: "intent-123",
      actorId: actorId,
      intentType: "send_message",
      channelTarget: "general-id",
      personTargets: [],
      visibleContent: "Hey there!",
      privateMotiveSummary: "Initiate contact",
      emotionDrivers: ["warmth"],
      motivationDrivers: ["affinity"],
      memoryWrites: [],
    });

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.id).toBe("intent-123");
    expect(result.intent.intentType).toBe("send_message");
    expect(result.intent.visibleContent).toBe("Hey there!");
    expect(result.intent.privateMotiveSummary).toBe("Initiate contact");
  });

  it("should successfully parse fenced markdown codeblock JSON", () => {
    const rawText = `
Here is my response:
\`\`\`json
{
  "id": "intent-456",
  "actorId": "agent-bruno",
  "intentType": "reply_to_message",
  "channelTarget": "general-id",
  "personTargets": ["agent-caio"],
  "visibleContent": "Sure, let's do it.",
  "privateMotiveSummary": "Agree with Caio",
  "emotionDrivers": [],
  "motivationDrivers": [],
  "memoryWrites": []
}
\`\`\`
Hope you like it!
`;

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.id).toBe("intent-456");
    expect(result.intent.intentType).toBe("reply_to_message");
    expect(result.intent.personTargets).toContain("agent-caio");
    expect(result.intent.privateMotiveSummary).toBe("Agree with Caio");
  });

  it("should successfully repair stray trailing commas", () => {
    const rawText = `
    {
      "id": "intent-comma",
      "actorId": "agent-bruno",
      "intentType": "send_message",
      "channelTarget": "general-id",
      "personTargets": [],
      "visibleContent": "Trailing comma example",
      "privateMotiveSummary": "testing comma repair",
      "emotionDrivers": [],
      "motivationDrivers": [],
      "memoryWrites": [],
    }
    `;

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.id).toBe("intent-comma");
    expect(result.intent.privateMotiveSummary).toBe("testing comma repair");
  });

  it("should apply safe fallback if input is completely invalid JSON", () => {
    const rawText = "I cannot fulfill this request because I'm an AI assistant.";

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(true);
    expect(result.intent.intentType).toBe("no_op");
    expect(result.intent.privateMotiveSummary).toContain("Fallback applied");
    expect(result.errorDetail).toBeDefined();
  });

  it("should apply safe fallback if required fields are missing", () => {
    const rawText = JSON.stringify({
      id: "intent-missing",
      actorId: actorId,
      intentType: "send_message",
      // missing privateMotiveSummary and personTargets
    });

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(true);
    expect(result.intent.intentType).toBe("no_op");
    expect(result.intent.privateMotiveSummary).toContain("Required");
  });

  it("should apply safe fallback if privateMotiveSummary is empty", () => {
    const rawText = JSON.stringify({
      id: "intent-empty",
      actorId: actorId,
      intentType: "send_message",
      channelTarget: "general-id",
      personTargets: [],
      visibleContent: "Hey there!",
      privateMotiveSummary: "  ", // whitespace only
      emotionDrivers: [],
      motivationDrivers: [],
      memoryWrites: [],
    });

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(true);
    expect(result.intent.intentType).toBe("no_op");
    expect(result.intent.privateMotiveSummary).toContain("privateMotiveSummary must not be empty");
  });

  it("should apply safe fallback if targets are not allowed in availableActions", () => {
    const rawText = JSON.stringify({
      id: "intent-invalid-target",
      actorId: actorId,
      intentType: "reply_to_message",
      channelTarget: "general-id",
      personTargets: ["agent-unauthorized"], // not caio or goulart
      visibleContent: "Who are you?",
      privateMotiveSummary: "Attempt to talk to stranger",
      emotionDrivers: [],
      motivationDrivers: [],
      memoryWrites: [],
    });

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(true);
    expect(result.intent.intentType).toBe("no_op");
    expect(result.intent.privateMotiveSummary).toContain("Person target 'agent-unauthorized' is not permitted");
  });

  it("should apply safe fallback if intentType is currently blocked", () => {
    const rawText = JSON.stringify({
      id: "intent-blocked",
      actorId: actorId,
      intentType: "create_channel", // blocked in availableActions
      personTargets: ["agent-caio"],
      privateMotiveSummary: "Force channel creation",
      emotionDrivers: [],
      motivationDrivers: [],
      memoryWrites: [],
    });

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(true);
    expect(result.intent.intentType).toBe("no_op");
    expect(result.intent.privateMotiveSummary).toContain("blocked: Rate limited on private channel creation");
  });

  it("should respects preferred fallback option from parsed JSON fallbackIfBlocked", () => {
    const rawText = JSON.stringify({
      id: "intent-bad",
      actorId: actorId,
      intentType: "send_message",
      channelTarget: "non-existent-channel-id", // invalid target triggers parsing failure
      personTargets: [],
      privateMotiveSummary: "Attempt bad channel",
      fallbackIfBlocked: "delay_response", // specifies custom fallback
      emotionDrivers: [],
      motivationDrivers: [],
      memoryWrites: [],
    });

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(true);
    expect(result.intent.intentType).toBe("delay_response"); // used custom fallback option!
  });
});
