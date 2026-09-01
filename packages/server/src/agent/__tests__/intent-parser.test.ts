import { describe, it, expect } from "vitest";
import { IntentParser } from "../intent-parser.js";
import type { AvailableAction } from "@perfectman/shared";

describe("IntentParser", () => {
  const actorId = "agent-peer";

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
      personTargets: ["agent-peer", "example-friend"],
      blocked: false,
    },
    {
      intentType: "create_channel",
      channelTargets: [],
      personTargets: ["agent-peer"],
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
    // engine owns id; the model-provided id is ignored (packet split)
    expect(result.intent.id).toMatch(/^[0-9A-Za-z]{21}$/);
    expect(result.intent.id).not.toBe("intent-123");
    expect(result.intent.intentType).toBe("send_message");
    expect(result.intent.visibleContent).toBe("Hey there!");
    expect(result.intent.privateMotiveSummary).toBe("Initiate contact");
  });

  it("carries a memory-write proposal's intensity through into the ActionIntent", () => {
    const rawText = JSON.stringify({
      intentType: "send_message",
      channelTarget: "general-id",
      personTargets: [],
      visibleContent: "Hey there!",
      privateMotiveSummary: "Initiate contact",
      emotionDrivers: [],
      motivationDrivers: [],
      memoryWrites: [
        {
          type: "emotional_residue",
          subjectAgentIds: ["agent-peer"],
          summary: "that exchange stung",
          emotionalTone: "hurt",
          confidence: 0.8,
          intensity: 0.9,
          unresolved: true,
        },
      ],
    });

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.memoryWrites).toHaveLength(1);
    expect(result.intent.memoryWrites[0]?.intensity).toBe(0.9);
  });

  it("applies safe fallback when a memory-write proposal's intensity is out of range", () => {
    const rawText = JSON.stringify({
      intentType: "send_message",
      channelTarget: "general-id",
      personTargets: [],
      visibleContent: "Hey there!",
      privateMotiveSummary: "Initiate contact",
      emotionDrivers: [],
      motivationDrivers: [],
      memoryWrites: [
        {
          type: "episodic",
          subjectAgentIds: [],
          summary: "x",
          emotionalTone: "neutral",
          confidence: 0.5,
          intensity: 1.5,
          unresolved: false,
        },
      ],
    });

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(true);
  });

  it("should successfully parse fenced markdown codeblock JSON", () => {
    const rawText = `
Here is my response:
\`\`\`json
{
  "id": "intent-456",
  "actorId": "agent-peer",
  "intentType": "reply_to_message",
  "channelTarget": "general-id",
  "personTargets": ["agent-peer"],
  "visibleContent": "Sure, let's do it.",
  "privateMotiveSummary": "Agree with Agent Peer",
  "emotionDrivers": [],
  "motivationDrivers": [],
  "memoryWrites": []
}
\`\`\`
Hope you like it!
`;

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(false);
    // engine owns id; the model-provided id is ignored (packet split)
    expect(result.intent.id).toMatch(/^[0-9A-Za-z]{21}$/);
    expect(result.intent.id).not.toBe("intent-456");
    expect(result.intent.intentType).toBe("reply_to_message");
    expect(result.intent.personTargets).toContain("agent-peer");
    expect(result.intent.privateMotiveSummary).toBe("Agree with Agent Peer");
  });

  it("should successfully repair stray trailing commas", () => {
    const rawText = `
    {
      "id": "intent-comma",
      "actorId": "agent-peer",
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
    // engine owns id; the model-provided id is ignored (packet split)
    expect(result.intent.id).toMatch(/^[0-9A-Za-z]{21}$/);
    expect(result.intent.id).not.toBe("intent-comma");
    expect(result.intent.privateMotiveSummary).toBe("testing comma repair");
  });

  it("should apply safe fallback if input is completely invalid JSON", () => {
    const rawText = "I cannot fulfill this request because I'm an AI assistant.";

    const result = IntentParser.parse(rawText, actorId, availableActions);

    expect(result.fallbackApplied).toBe(true);
    expect(result.intent.intentType).toBe("no_op");
    expect(result.intent.privateMotiveSummary).toContain("Fallback applied");
    expect(result.errorDetail).toBeDefined();
    expect(result.errorDetail!.length).toBeGreaterThan(0);
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

  describe("content-bearing actions require visibleContent (#39)", () => {
    it("applies safe fallback when send_message has no visibleContent", () => {
      const rawText = JSON.stringify({
        id: "intent-no-content",
        actorId,
        intentType: "send_message",
        channelTarget: "general-id",
        personTargets: [],
        privateMotiveSummary: "say something",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      });

      const result = IntentParser.parse(rawText, actorId, availableActions);

      expect(result.fallbackApplied).toBe(true);
      expect(result.intent.intentType).toBe("no_op");
      expect(result.errorDetail).toContain("visibleContent must not be empty for intent type 'send_message'");
    });

    it("applies safe fallback when visibleContent is whitespace-only", () => {
      const rawText = JSON.stringify({
        id: "intent-blank-content",
        actorId,
        intentType: "send_message",
        channelTarget: "general-id",
        personTargets: [],
        visibleContent: "   ",
        privateMotiveSummary: "say something",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      });

      const result = IntentParser.parse(rawText, actorId, availableActions);

      expect(result.fallbackApplied).toBe(true);
      expect(result.intent.intentType).toBe("no_op");
      expect(result.errorDetail).toContain("visibleContent must not be empty");
    });

    it("applies safe fallback when reply_to_message has no visibleContent", () => {
      const rawText = JSON.stringify({
        id: "intent-reply-no-content",
        actorId,
        intentType: "reply_to_message",
        channelTarget: "general-id",
        personTargets: [actorId],
        replyToEventId: "evt-1",
        privateMotiveSummary: "reply without content",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      });

      const result = IntentParser.parse(rawText, actorId, availableActions);

      expect(result.fallbackApplied).toBe(true);
      expect(result.intent.intentType).toBe("no_op");
      expect(result.errorDetail).toContain("visibleContent must not be empty for intent type 'reply_to_message'");
    });

    it("still accepts content-bearing send_message with real content", () => {
      const rawText = JSON.stringify({
        id: "intent-with-content",
        actorId,
        intentType: "send_message",
        channelTarget: "general-id",
        personTargets: [],
        visibleContent: "fala sério",
        privateMotiveSummary: "genuine message",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      });

      const result = IntentParser.parse(rawText, actorId, availableActions);

      expect(result.fallbackApplied).toBe(false);
      expect(result.intent.visibleContent).toBe("fala sério");
    });
  });

  it("should apply safe fallback if targets are not allowed in availableActions", () => {
    const rawText = JSON.stringify({
      id: "intent-invalid-target",
      actorId: actorId,
      intentType: "reply_to_message",
      channelTarget: "general-id",
      personTargets: ["agent-unauthorized"], // not agent-peer or example-friend
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
      personTargets: ["agent-peer"],
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

  describe("create_channel channelType default", () => {
    const createChannelActions: AvailableAction[] = [
      {
        intentType: "create_channel",
        channelTargets: [],
        personTargets: [],
        blocked: false,
      },
    ];

    it("defaults an empty-string channelType to private_channel instead of rejecting", () => {
      const rawText = JSON.stringify({
        id: "intent-create-1",
        actorId,
        intentType: "create_channel",
        channelType: "", // the observed real-world failure mode
        channelName: "papo-reservado",
        privateMotiveSummary: "want to talk privately",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      });

      const result = IntentParser.parse(rawText, actorId, createChannelActions);

      expect(result.fallbackApplied).toBe(false);
      expect(result.intent.intentType).toBe("create_channel");
      expect(result.intent.channelType).toBe("private_channel");
    });

    it("defaults a missing channelType to private_channel", () => {
      const rawText = JSON.stringify({
        id: "intent-create-2",
        actorId,
        intentType: "create_channel",
        channelName: "papo-reservado",
        privateMotiveSummary: "want to talk privately",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      });

      const result = IntentParser.parse(rawText, actorId, createChannelActions);

      expect(result.fallbackApplied).toBe(false);
      expect(result.intent.channelType).toBe("private_channel");
    });

    it("leaves an explicit valid channelType untouched", () => {
      const rawText = JSON.stringify({
        id: "intent-create-3",
        actorId,
        intentType: "create_channel",
        channelType: "spectator_channel",
        channelName: "watch-party",
        privateMotiveSummary: "want an audience",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      });

      const result = IntentParser.parse(rawText, actorId, createChannelActions);

      expect(result.fallbackApplied).toBe(false);
      expect(result.intent.channelType).toBe("spectator_channel");
    });
  });
});
