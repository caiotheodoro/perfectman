import { describe, expect, it } from "vitest";
import { secretIn, sceneLookIn } from "../../pick/preview.js";
import { draftFromSentence, draftFromStory, INITIAL_ROOM, roomFiles } from "../room-draft.js";

describe("draftFromSentence", () => {
  it("turns one line into a situation and a title, and keeps the three starting people", () => {
    const draft = draftFromSentence("  Three flatmates and one leaked screenshot.  ");
    expect(draft.title).toBe("Three flatmates and one leaked screenshot");
    expect(draft.situation).toContain("Three flatmates and one leaked screenshot.");
    expect(draft.people).toEqual(INITIAL_ROOM.people);
    expect(() => roomFiles(draft)).not.toThrow();
  });

  it("keeps the sentence as the idea, so it can be drafted from the writer", () => {
    expect(draftFromSentence("Three flatmates.").idea).toBe("Three flatmates");
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

describe("a room the model drafted", () => {
  const story = {
    title: "Sangue na neve", situation: "Quatro amigos presos numa cabana.", language: "pt-BR" as const,
    people: [
      { name: "Mick", role: "performer" as const, goal: "Culpar a Darla.", voice: "Grosso e debochado.", lines: ["Cala a porra da boca, Rico."] },
      { name: "Darla", role: "skeptic" as const, goal: "Descobrir quem cavou.", voice: "", lines: [] },
    ],
  };

  it("writes its own voice, lines and language into the files the compiler reads", () => {
    const { personas, scenario } = roomFiles(draftFromStory(story, "uma cabana"));
    expect(personas[0]?.text).toContain('language: "pt-BR"');
    expect(personas[0]?.text).toContain("- Cala a porra da boca, Rico.");
    expect(personas[0]?.text).toContain("Grosso e debochado.");
    expect(scenario.text).toContain('language: "pt-BR"');
  });

  it("falls back to the temperament's voice and lines where the model wrote none", () => {
    const { personas } = roomFiles(draftFromStory(story, "uma cabana"));
    expect(personas[1]?.text).toContain("Brief and direct");
    expect(personas[1]?.text).toContain("What aren't we saying?");
  });

  it("tops a person up to the three style examples the compiler needs, the model's own lines first", () => {
    const examples = (text: string) => (text.split("## Style Examples\n")[1] ?? "").split("\n\n")[0]?.split("\n") ?? [];
    const { personas } = roomFiles(draftFromStory(story, "uma cabana"));
    expect(examples(personas[0]?.text ?? "")).toEqual(["- Cala a porra da boca, Rico.", "- Someone had to say it.", "- Wait, hear me out."]);
    const five = { ...story, people: story.people.map((p) => ({ ...p, lines: ["a", "b", "c", "d", "e"] })) };
    expect(examples(roomFiles(draftFromStory(five, "x")).personas[0]?.text ?? "")).toHaveLength(5);
  });
});
