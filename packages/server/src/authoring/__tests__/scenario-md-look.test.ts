import { describe, expect, it } from "vitest";
import { compileScenarioMarkdown } from "../scenario-md-compiler.js";
import { messages, minimal } from "./scenario-fixtures.js";

const FRONT = `name: T
seed: 1
channels:
  - { id: geral, type: public_channel, name: geral, default: true, members: [a, b] }
cast:
  - { agentId: a, persona: a.md }
  - { agentId: b, persona: b.md }`;

const compile = (extra: string) => compileScenarioMarkdown(minimal({ frontmatter: `${FRONT}\n${extra}` }), "s.md");

describe("compileScenarioMarkdown — setting, props and rooms", () => {
  it("reads the place, its props and the side rooms", () => {
    const { scenario } = compile("setting: rooftop\nprops: [cat, notice-board]\nrooms: [stairwell, elevator]");

    expect(scenario?.look).toEqual({ setting: "rooftop", props: ["cat", "notice-board"], rooms: ["stairwell", "elevator"] });
  });

  it("has no look unless the scene asks for one", () => {
    expect(compileScenarioMarkdown(minimal(), "s.md").scenario?.look).toBeUndefined();
  });

  it("warns and drops an unknown setting without failing the scene", () => {
    const { scenario, diagnostics } = compile("setting: moon-base");

    expect(scenario).not.toBeNull();
    expect(scenario?.look).toBeUndefined();
    expect(messages(diagnostics, "warning")).toContain("setting");
  });

  it("keeps the props that are valid names and warns about the rest", () => {
    const { scenario, diagnostics } = compile("props: [cat, Bad Prop, 42]");

    expect(scenario?.look?.props).toEqual(["cat"]);
    expect(messages(diagnostics, "warning")).toContain("props");
  });

  it("caps the side rooms and drops duplicates", () => {
    const { scenario } = compile("rooms: [stairwell, stairwell, elevator, kitchen, lobby]");

    expect(scenario?.look?.rooms).toEqual(["stairwell", "elevator", "kitchen"]);
  });
});
