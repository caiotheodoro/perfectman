/**
 * One frame of the contact sheet is a picture of a beat with no words in it:
 * the room's ground, a dot per person where they stood, and a mark on the one
 * whose moment it was. Two beats that look the same must produce the same
 * signature so the sheet does not repaint them.
 */
import { describe, expect, it } from "vitest";
import { placeBeats, type LiveChannel, type StageBeat } from "@perfectman/shared";
import { frameFor, frameLabel } from "../Frame.js";

const AGENTS = [
  { id: "iris", displayName: "íris" },
  { id: "bruno", displayName: "bruno" },
  { id: "marcela", displayName: "marcela" },
];
const IDS = AGENTS.map((a) => a.id);
const CHANNELS: LiveChannel[] = [
  { id: "geral", name: "geral", type: "public_channel", memberAgentIds: IDS },
  { id: "dm", name: "dm", type: "private_channel", memberAgentIds: ["iris", "marcela"] },
];

function beat(over: Partial<StageBeat> = {}): StageBeat {
  return {
    id: "b", kind: "message", pulseIndex: 0, channelId: "geral", actorId: "iris", text: "hi",
    audienceIds: [], participantIds: IDS, duration: 3, page: 0, ...over,
  };
}

function frame(b: StageBeat, channels = CHANNELS) {
  const [placement] = placeBeats([b], AGENTS, channels);
  return frameFor(b, placement!, IDS);
}

describe("frameFor", () => {
  it("draws one dot per person in the room, and exactly one is the speaker", () => {
    const f = frame(beat());
    expect(f.dots).toHaveLength(3);
    expect(f.dots.filter((d) => d.speaker)).toHaveLength(1);
  });

  it("puts speech in a box and a thought in a cloud", () => {
    expect(frame(beat()).glyph).toBe("speech");
    expect(frame(beat({ kind: "silence", text: "", thought: { text: "…", drivers: [] } })).glyph).toBe("thought");
    expect(frame(beat({ kind: "aside", text: "", thought: { text: "…", drivers: [] } })).glyph).toBe("thought");
  });

  it("marks arrivals and departures with their own glyph", () => {
    expect(frame(beat({ kind: "event", stageAction: { kind: "arrive", agentIds: ["iris"] } })).glyph).toBe("arrive");
    expect(frame(beat({ kind: "event", stageAction: { kind: "leave", agentIds: ["iris"] } })).glyph).toBe("leave");
  });

  it("carries the room kind so a private frame can be drawn differently", () => {
    expect(frame(beat({ channelId: "dm", participantIds: ["iris", "marcela"] })).kind).toBe("private");
  });

  it("signs two identical pictures the same and two different speakers differently", () => {
    const a = frame(beat({ id: "x" }));
    const b = frame(beat({ id: "y" }));
    const c = frame(beat({ id: "z", actorId: "bruno" }));
    expect(a.sig).toBe(b.sig);
    expect(a.sig).not.toBe(c.sig);
  });

  it("keeps the words out of the picture", () => {
    const f = frame(beat({ text: "a secret" }));
    expect(JSON.stringify(f)).not.toContain("secret");
  });
});

describe("frameLabel", () => {
  it("says who did what where, for a reader who cannot see the picture", () => {
    expect(frameLabel(beat(), AGENTS, CHANNELS[0])).toBe("íris speaks in geral");
    expect(frameLabel(beat({ kind: "silence", actorId: "marcela" }), AGENTS, CHANNELS[0])).toBe("marcela says nothing");
    expect(frameLabel(beat({ kind: "aside", actorId: "bruno" }), AGENTS, CHANNELS[0])).toBe("what bruno was after");
    expect(frameLabel(beat({ kind: "event", stageAction: { kind: "leave", agentIds: [] } }), AGENTS, CHANNELS[0])).toBe("íris leaves geral");
  });
});
