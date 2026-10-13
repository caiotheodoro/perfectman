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

describe("compileScenarioMarkdown — storyClock", () => {
  it("reads a scene clock from the frontmatter", () => {
    const { scenario } = compileScenarioMarkdown(
      minimal({ frontmatter: `${FRONT}\nstoryClock: { start: "23:40", minutesPerPulse: 4 }` }),
      "s.md",
    );

    expect(scenario?.storyClock).toEqual({ start: "23:40", minutesPerPulse: 4 });
  });

  it("has no clock unless the scene asks for one", () => {
    const { scenario } = compileScenarioMarkdown(minimal(), "s.md");

    expect(scenario?.storyClock).toBeUndefined();
  });

  it("warns and drops a malformed clock rather than failing the scene", () => {
    const { scenario, diagnostics } = compileScenarioMarkdown(
      minimal({ frontmatter: `${FRONT}\nstoryClock: { start: "late", minutesPerPulse: 4 }` }),
      "s.md",
    );

    expect(scenario).not.toBeNull();
    expect(scenario?.storyClock).toBeUndefined();
    expect(messages(diagnostics, "warning")).toContain("storyClock");
  });
});
