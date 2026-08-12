import { describe, it, expect } from "vitest";
import { IntentParser } from "../intent-parser.js";
import type { AvailableAction } from "@perfectman/shared";

const ACTIONS: AvailableAction[] = [
  {
    intentType: "send_message",
    channelTargets: ["ch_geral"],
    personTargets: [],
    blocked: false,
  },
];

describe("IntentParser structural repair", () => {
  it("coerces visibleContent: null to undefined (model quirk)", () => {
    const raw = JSON.stringify({
      id: "i1",
      actorId: "goulart",
      intentType: "send_message",
      personTargets: null,
      visibleContent: null,
      privateMotiveSummary: "quero ver a reação dele",
      emotionDrivers: null,
      motivationDrivers: null,
    });
    const result = IntentParser.parse(raw, "goulart", ACTIONS);
    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.intentType).toBe("send_message");
    expect(result.intent.visibleContent).toBeUndefined();
    expect(result.intent.personTargets).toEqual([]);
    expect(result.intent.emotionDrivers).toEqual([]);
  });

  it("defaults missing memoryWrites", () => {
    const raw = JSON.stringify({
      actorId: "bruno",
      intentType: "no_op",
      privateMotiveSummary: "melhor ficar quieto",
    });
    const result = IntentParser.parse(raw, "bruno", []);
    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.memoryWrites).toEqual([]);
    expect(typeof result.intent.id).toBe("string");
  });

  it("still falls back on truly invalid output", () => {
    const result = IntentParser.parse("isso não é json", "bruno", []);
    expect(result.fallbackApplied).toBe(true);
  });
});
