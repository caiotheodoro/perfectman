import { describe, expect, it } from "vitest";
import { compileScenarioMarkdown } from "../scenario-md-compiler.js";
import { messages, minimal } from "./scenario-fixtures.js";

describe("compileScenarioMarkdown — nothing fails silently", () => {
  it("picks a default channel and says so when none is marked", () => {
    const { scenario, diagnostics } = compileScenarioMarkdown(
      minimal({
        frontmatter: `name: T
seed: 1
channels:
  - { id: g, type: public_channel, name: g, members: [a] }
cast:
  - { agentId: a, persona: a.md }`,
      }),
      "s.md",
    );
    expect(messages(diagnostics, "warning")).toContain("No channel is marked");
    expect(scenario?.channels[0]?.default).toBe(true);
  });

  it("errors when more than one channel claims to be the default", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({
        frontmatter: `name: T
seed: 1
channels:
  - { id: g, type: public_channel, name: g, default: true, members: [a] }
  - { id: h, type: public_channel, name: h, default: true, members: [a] }
cast:
  - { agentId: a, persona: a.md }`,
      }),
      "s.md",
    );
    expect(messages(diagnostics, "error")).toContain("exactly one is allowed");
  });

  it("caps maxPulses at the memory ceiling with an explanation", () => {
    const { scenario, diagnostics } = compileScenarioMarkdown(
      minimal({
        frontmatter: `name: T
seed: 1
maxPulses: 5000
channels:
  - { id: g, type: public_channel, name: g, default: true, members: [a] }
cast:
  - { agentId: a, persona: a.md }`,
      }),
      "s.md",
    );
    expect(scenario?.maxPulses).toBe(200);
    expect(messages(diagnostics, "warning")).toContain("agent-state snapshot per agent per pulse");
  });

  it("warns when a hidden objective has no constraint", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({
        body: "## Room Context\nr\n\n## Starting Mood\nm\n\n## Agent: a\n### Hidden Objective\nWin the room (resource: status)",
      }),
      "s.md",
    );
    expect(messages(diagnostics, "warning")).toContain("flavor text, not a pressure");
  });

  it("errors when a hidden objective names no scarce resource", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({
        body: "## Room Context\nr\n\n## Starting Mood\nm\n\n## Agent: a\n### Hidden Objective\nWin the room",
      }),
      "s.md",
    );
    expect(messages(diagnostics, "error")).toContain("no scarce resource");
  });

  it("notes when only one agent contends for a resource", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({
        body: "## Room Context\nr\n\n## Starting Mood\nm\n\n## Agent: a\n### Hidden Objective\nWin (resource: chair)\nConstraint: never say it",
      }),
      "s.md",
    );
    expect(messages(diagnostics, "info")).toContain("no structural collision");
  });

  it("warns about an `## Agent:` section that matches nobody in the cast", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({ body: "## Room Context\nr\n\n## Starting Mood\nm\n\n## Agent: nobody\n### Host Message\nhi" }),
      "s.md",
    );
    expect(messages(diagnostics, "warning")).toContain("does not match any cast member");
  });

  it("warns on an unknown familiarity level rather than inventing one", () => {
    const { scenario, diagnostics } = compileScenarioMarkdown(
      minimal({
        frontmatter: `name: T
seed: 1
channels:
  - { id: g, type: public_channel, name: g, default: true, members: [a, b] }
familiarity:
  a:b: besties
cast:
  - { agentId: a, persona: a.md }
  - { agentId: b, persona: b.md }`,
      }),
      "s.md",
    );
    expect(messages(diagnostics, "warning")).toContain("besties");
    expect(scenario?.familiarity).toEqual({});
  });
});
