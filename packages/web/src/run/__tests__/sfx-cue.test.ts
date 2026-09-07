/**
 * Which sound a beat makes, if any. A long line is several beats and should
 * click once; stepping through beats by hand should not click at all.
 */
import { describe, expect, it } from "vitest";
import type { StageBeat } from "@perfectman/shared";
import { sfxCueFor } from "../sfx-cue.js";

function beat(over: Partial<StageBeat> = {}): StageBeat {
  return {
    id: "b", kind: "message", pulseIndex: 0, channelId: "c", actorId: "a", text: "hi",
    audienceIds: [], participantIds: ["a"], duration: 3, page: 0, ...over,
  };
}

describe("sfxCueFor", () => {
  it("clicks for a spoken line", () => {
    expect(sfxCueFor(beat())).toBe("message");
  });
  it("clicks once per line, not once per page", () => {
    expect(sfxCueFor(beat({ page: 1 }))).toBeNull();
  });
  it("stays quiet for a thought", () => {
    expect(sfxCueFor(beat({ kind: "aside" }))).toBeNull();
    expect(sfxCueFor(beat({ kind: "silence" }))).toBeNull();
  });
  it("marks arrivals and departures", () => {
    expect(sfxCueFor(beat({ kind: "event", stageAction: { kind: "arrive", agentIds: [] } }))).toBe("arrival");
    expect(sfxCueFor(beat({ kind: "event", stageAction: { kind: "invite", agentIds: [] } }))).toBe("arrival");
    expect(sfxCueFor(beat({ kind: "event", stageAction: { kind: "leave", agentIds: [] } }))).toBe("departure");
  });
});
