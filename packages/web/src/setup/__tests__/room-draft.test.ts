import { describe, expect, it } from "vitest";
import { secretIn, sceneLookIn } from "../../pick/preview.js";
import { draftFromSentence, INITIAL_ROOM, roomFiles } from "../room-draft.js";

describe("draftFromSentence", () => {
  it("turns one line into a situation and a title, and keeps the three starting people", () => {
    const draft = draftFromSentence("  Three flatmates and one leaked screenshot.  ");
    expect(draft.title).toBe("Three flatmates and one leaked screenshot");
    expect(draft.situation).toContain("Three flatmates and one leaked screenshot.");
    expect(draft.people).toEqual(INITIAL_ROOM.people);
    expect(() => roomFiles(draft)).not.toThrow();
  });

  it("falls back to the default story for an empty line and shortens a long title", () => {
    expect(draftFromSentence("   ")).toBe(INITIAL_ROOM);
    expect(draftFromSentence("x".repeat(100)).title).toHaveLength(60);
  });
});

describe("what a card reads off a preset", () => {
  it("finds the first private motive of a persona", () => {
    const text = "---\npersonaId: a\n---\n## Voice\n- loud\n\n## Private Motives\n- Nobody can find out about the cake.\n- Second.\n\n## Hard Limits\n- none\n";
    expect(secretIn({ filename: "a.persona.md", text })).toBe("Nobody can find out about the cake.");
    expect(secretIn({ filename: "b.persona.md", text: "---\n---\n## Voice\n- x\n" })).toBeUndefined();
  });

  it("reads the place and the hour a scene starts at", () => {
    const text = '---\nname: Cat\nsetting: rooftop\nstoryClock: { start: "23:40", minutesPerPulse: 4 }\n---\nbody';
    expect(sceneLookIn([{ filename: "cat.scenario.md", text }])).toEqual({ setting: "rooftop", minute: 23 * 60 + 40 });
    expect(sceneLookIn([{ filename: "x.scenario.md", text: "---\nname: X\n---\n" }]).minute).toBe(21 * 60);
  });
});
