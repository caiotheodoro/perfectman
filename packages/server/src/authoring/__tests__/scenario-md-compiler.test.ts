import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileScenarioMarkdown } from "../scenario-md-compiler.js";
import type { Diagnostic } from "../diagnostics.js";

const FIXTURE = readFileSync(join(__dirname, "fixtures/dinner.scenario.md"), "utf8");

function messages(diagnostics: readonly Diagnostic[], level: Diagnostic["level"]): string {
  return diagnostics.filter((d) => d.level === level).map((d) => d.message).join(" | ");
}

/** A minimal scenario that compiles, for tests that vary one thing at a time. */
function minimal(overrides: { frontmatter?: string; body?: string } = {}): string {
  const frontmatter =
    overrides.frontmatter ??
    `name: T
seed: 1
channels:
  - { id: geral, type: public_channel, name: geral, default: true, members: [a, b] }
cast:
  - { agentId: a, persona: a.md }
  - { agentId: b, persona: b.md }`;
  const body = overrides.body ?? "## Room Context\nA room.\n\n## Starting Mood\nquiet";
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

describe("compileScenarioMarkdown — the golden fixture", () => {
  const { scenario, diagnostics } = compileScenarioMarkdown(FIXTURE, "dinner.scenario.md");

  it("compiles without errors", () => {
    expect(messages(diagnostics, "error")).toBe("");
    expect(scenario).not.toBeNull();
  });

  it("reads the run-level frontmatter", () => {
    expect(scenario).toMatchObject({
      name: "A fatia que não existe",
      seed: 42,
      maxPulses: 12,
      languageOverride: "pt-BR",
    });
    expect(scenario?.settings).toEqual({ pulseIntervalMs: 3000 });
  });

  it("reads channels including a private one, with membership", () => {
    expect(scenario?.channels).toEqual([
      {
        id: "geral",
        type: "public_channel",
        name: "geral",
        memberAgentIds: ["iris", "bruno", "marcela"],
        default: true,
      },
      {
        id: "iris_marcela",
        type: "private_channel",
        name: "iris+marcela",
        memberAgentIds: ["iris", "marcela"],
        createdBy: "iris",
      },
    ]);
  });

  it("reads the familiarity matrix", () => {
    expect(scenario?.familiarity).toEqual({
      "iris:marcela": "close_friends",
      "iris:bruno": "acquaintances",
      "bruno:marcela": "strangers",
    });
  });

  it("reads scene-wide prose sections", () => {
    expect(scenario?.scene.roomContext).toContain("Três sócios");
    expect(scenario?.scene.startingMood).toBe("tenso, educado demais");
    expect(scenario?.scene.introBehaviorInstruction).toContain("Não se apresente");
    expect(scenario?.scene.firstMoveGuidance).toContain("retome o assunto");
    expect(scenario?.scene.customNotes).toEqual(["Canais privados são comuns aqui e geram suspeita."]);
  });

  it("reads the cast with per-member mood and social overrides", () => {
    const iris = scenario?.cast.find((c) => c.agentId === "iris");
    expect(iris).toMatchObject({
      persona: "iris.persona.md",
      displayName: "Íris",
      presence: "active",
      mood: { valence: -0.2, arousal: 0.6 },
      social: { desireForStatus: 0.7 },
    });
  });

  it("attaches `## Agent:` overrides to the matching cast member", () => {
    const iris = scenario?.cast.find((c) => c.agentId === "iris");
    expect(iris?.hostStartingMessage).toBe("alguém mais tá pensando no que aconteceu no sábado?");
    const bruno = scenario?.cast.find((c) => c.agentId === "bruno");
    expect(bruno?.roomContext).toContain("achando que era só um papo");
  });

  it("parses a hidden objective, its inline resource and its labelled fields", () => {
    const iris = scenario?.cast.find((c) => c.agentId === "iris");
    expect(iris?.hiddenObjective).toEqual({
      description: "Descobrir se o jantar foi deliberado, sem parecer magoada",
      scarceResourceId: "o_convite",
      constraint: "Não pode admitir que ficou sabendo pelo story da Marcela.",
      costOfExposure: "Perde a confiança do Bruno.",
      breakingPoint: "Se alguém disser que ela está exagerando.",
    });
  });

  it("reads per-agent seed memories", () => {
    const bruno = scenario?.cast.find((c) => c.agentId === "bruno");
    expect(bruno?.memorySeeds).toEqual([
      {
        type: "episodic",
        subjectAgentIds: ["iris"],
        summary: "Ela desviou quando perguntei do investidor.",
        emotionalTone: "suspicion",
        confidence: 0.7,
        unresolved: true,
      },
    ]);
  });

  it("reads prior events, which config JSON cannot express", () => {
    expect(scenario?.priorEvents).toEqual([
      {
        type: "message",
        actorId: "bruno",
        channelId: "geral",
        pulseIndex: 0,
        minutesAgo: 40,
        payload: { content: "vou pensar e volto" },
      },
    ]);
  });

  it("does not flag the shared resource — two agents contending is the point", () => {
    expect(messages(diagnostics, "info")).not.toContain("o_convite");
  });
});

describe("compileScenarioMarkdown — required fields", () => {
  it("errors without a seed, explaining why it matters", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({
        frontmatter: `name: T
channels:
  - { id: g, type: public_channel, name: g, default: true, members: [a] }
cast:
  - { agentId: a, persona: a.md }`,
      }),
      "s.md",
    );
    const seedError = diagnostics.find((d) => d.path === "seed");
    expect(seedError?.level).toBe("error");
    expect(seedError?.hint).toContain("reproducible");
  });

  it("errors without channels or cast", () => {
    const { diagnostics } = compileScenarioMarkdown("---\nname: T\nseed: 1\n---\n", "s.md");
    const errors = messages(diagnostics, "error");
    expect(errors).toContain("no `channels`");
    expect(errors).toContain("no `cast`");
  });

  it("errors when Room Context or Starting Mood is missing", () => {
    const { diagnostics } = compileScenarioMarkdown(minimal({ body: "## Notes\n- nothing" }), "s.md");
    const errors = messages(diagnostics, "error");
    expect(errors).toContain("`## Room Context`");
    expect(errors).toContain("`## Starting Mood`");
  });

  it("returns a null scenario when anything blocked it", () => {
    const { scenario } = compileScenarioMarkdown("---\nname: T\n---\n", "s.md");
    expect(scenario).toBeNull();
  });
});

describe("compileScenarioMarkdown — cross-references", () => {
  it("errors when a channel names someone outside the cast", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({
        frontmatter: `name: T
seed: 1
channels:
  - { id: g, type: public_channel, name: g, default: true, members: [a, ghost] }
cast:
  - { agentId: a, persona: a.md }`,
      }),
      "s.md",
    );
    expect(messages(diagnostics, "error")).toContain('"ghost", who is not in the cast');
  });

  it("errors when a cast member belongs to no channel", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({
        frontmatter: `name: T
seed: 1
channels:
  - { id: g, type: public_channel, name: g, default: true, members: [a] }
cast:
  - { agentId: a, persona: a.md }
  - { agentId: lonely, persona: b.md }`,
      }),
      "s.md",
    );
    const error = diagnostics.find((d) => d.message.includes("lonely"));
    expect(error?.hint).toContain("can never see or send anything");
  });

  it("errors on a duplicate cast member", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({
        frontmatter: `name: T
seed: 1
channels:
  - { id: g, type: public_channel, name: g, default: true, members: [a] }
cast:
  - { agentId: a, persona: a.md }
  - { agentId: a, persona: b.md }`,
      }),
      "s.md",
    );
    expect(messages(diagnostics, "error")).toContain("listed more than once");
  });

  it("errors on a prior event in a channel that does not exist", () => {
    const { diagnostics } = compileScenarioMarkdown(
      minimal({
        frontmatter: `name: T
seed: 1
channels:
  - { id: g, type: public_channel, name: g, default: true, members: [a] }
cast:
  - { agentId: a, persona: a.md }
priorEvents:
  - { type: message, actorId: a, channelId: nowhere, pulseIndex: 0 }`,
      }),
      "s.md",
    );
    expect(messages(diagnostics, "error")).toContain('channel "nowhere", which does not exist');
  });
});

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
