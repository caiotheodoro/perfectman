import { describe, expect, it } from "vitest";
import { roomFiles } from "../live/room-files.js";

const people = ["Duda", "Rafa", "Gabi", "Leo"].map((name) => ({ name, role: "connector" as const, goal: "Pass the night." }));
const examplesOf = (text: string): string[] => (text.split("## Style Examples\n")[1] ?? "").split("\n\n")[0]!.split("\n").map((l) => l.replace(/^- /, ""));

describe("roomFiles style examples", () => {
  it("gives a pt-BR scene Portuguese examples, and two people of one temperament different ones", () => {
    const { personas } = roomFiles({ title: "Sexta no bar", situation: "Uma noite no bar.", people, language: "pt-BR" });
    const sets = personas.map((p) => examplesOf(p.text));
    for (const set of sets) {
      expect(set).toHaveLength(3);
      expect(set.join(" ")).not.toMatch(/Can we hear everyone out|take this one step/);
    }
    expect(new Set(sets.map((s) => s.join("|"))).size).toBeGreaterThan(1);
    expect(sets[0]).not.toEqual(sets[1]);
  });

  it("keeps the English examples for an English scene", () => {
    const { personas } = roomFiles({ title: "Friday", situation: "A night at the bar.", people, language: "en" });
    expect(examplesOf(personas[0]!.text)).toEqual(["Can we hear everyone out?", "I think we want the same thing.", "Let's take this one step at a time."]);
  });
});
