import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilePersonaMarkdown } from "../persona-md-compiler.js";
import type { Diagnostic } from "../diagnostics.js";

const FIXTURE = readFileSync(join(__dirname, "fixtures/iris.persona.md"), "utf8");

function compile(text: string, file = "iris.persona.md") {
  return compilePersonaMarkdown(text, file);
}

function messages(diagnostics: readonly Diagnostic[], level: Diagnostic["level"]): string[] {
  return diagnostics.filter((d) => d.level === level).map((d) => d.message);
}

describe("compilePersonaMarkdown — the golden fixture", () => {
  const result = compile(FIXTURE);

  it("compiles without errors", () => {
    expect(result.pack).not.toBeNull();
    expect(messages(result.diagnostics, "error")).toEqual([]);
  });

  it("maps frontmatter identity fields onto the pack", () => {
    expect(result.pack).toMatchObject({
      personaId: "iris",
      displayName: "Íris",
      archetype: "connector",
      language: "pt-BR",
    });
  });

  it("takes the identity frame from ## Identity as prose", () => {
    expect(result.pack?.identityFrame).toContain("Você é Íris");
    expect(result.pack?.identityFrame).toContain("porque você se importa demais.");
  });

  it("reads voice, style examples and social theory as bullet lists", () => {
    expect(result.pack?.voiceGuidelines).toHaveLength(2);
    expect(result.pack?.styleExamples).toEqual([
      "gente, respira comigo",
      "isso merece um almoço pra conversar direito",
      "tô bem sim!! (não tô, mas depois eu conto)",
    ]);
    expect(result.pack?.socialTheory).toHaveLength(1);
  });

  it("reads relationships as agentId → description", () => {
    expect(result.pack?.relationshipBiases).toEqual({
      bruno: "Quando ele fica quieto você sente como uma mudança de clima.",
      marcela: "A aprovação dela é a única que te desestabiliza.",
    });
  });

  it("reads memory seeds from the fenced yaml block", () => {
    expect(result.pack?.memorySeeds).toEqual([
      {
        type: "relationship",
        subjectAgentIds: ["bruno"],
        summary: "Ele sumiu no fim da noite e eu só percebi de manhã.",
        emotionalTone: "guilt",
        confidence: 0.8,
        intensity: 0.6,
        unresolved: true,
      },
    ]);
  });

  it("preserves a trigger sensitivity above 1 — packs use these as multipliers", () => {
    expect(result.pack?.edgeProfile.triggers[0]?.sensitivity).toBe(2.2);
  });

  it("collects the edge profile from its four prose sections", () => {
    expect(result.pack?.edgeProfile).toMatchObject({
      chaosCap: "medium",
      maskTells: ["Alegria que chega um tempo rápido demais."],
      impulseBehaviors: ["Manda um privado antes de responder em público."],
      privateMotiveLexicon: ["Preciso que ninguém saia daqui magoado comigo."],
      hardLimits: ["Nunca expõe um segredo que alguém contou em privado."],
    });
  });

  it("reads presence and sampling from frontmatter", () => {
    expect(result.pack?.presenceProfile).toEqual({
      responseDelayMs: [600, 3000],
      silenceTolerancePulses: 2,
      messageLength: "short",
      punctuationTells: ["kk", "..."],
    });
    expect(result.pack?.sampling).toEqual({
      temperature: 0.9,
      topP: 0.95,
      repetitionPenalty: 1.15,
      maxTokens: 400,
    });
  });

  it("carries writingStyle and calibrationFrom, which have no PersonaPack slot", () => {
    expect(result).toMatchObject({
      writingStyle: "warm, quick, deflects with humor when cornered",
      calibrationFrom: "caio",
    });
  });

  it("notes that pending intentions are authored but not yet read by the prompt compiler", () => {
    expect(messages(result.diagnostics, "info").join(" ")).toContain("Pending Intentions");
  });
});

describe("compilePersonaMarkdown — required fields", () => {
  it("errors on missing identity frontmatter, naming each field", () => {
    const result = compile("## Identity\nx\n## Voice\n- y\n## Style Examples\n- a\n- b\n- c");
    const errors = messages(result.diagnostics, "error").join(" ");
    expect(errors).toContain("personaId");
    expect(errors).toContain("displayName");
    expect(errors).toContain("archetype");
  });

  it("errors when ## Identity is absent", () => {
    const result = compile("---\npersonaId: a\ndisplayName: A\narchetype: x\n---\n## Voice\n- v");
    expect(messages(result.diagnostics, "error").join(" ")).toContain("no `## Identity` section");
  });

  it("errors when there are fewer than three style examples", () => {
    const result = compile(
      "---\npersonaId: a\ndisplayName: A\narchetype: x\n---\n## Identity\ni\n## Voice\n- v\n## Style Examples\n- one\n- two",
    );
    expect(messages(result.diagnostics, "error").join(" ")).toContain("2 style example(s)");
  });

  it("accepts `id`/`name` as aliases for personaId/displayName", () => {
    const result = compile("---\nid: a\nname: A\narchetype: x\n---\n## Identity\ni\n## Voice\n- v\n## Style Examples\n- 1\n- 2\n- 3");
    expect(result.pack).toMatchObject({ personaId: "a", displayName: "A" });
  });

  it("returns a null pack rather than throwing when the markdown itself is malformed", () => {
    const result = compile("---\nid: [unclosed\n---\n");
    expect(result.pack).toBeNull();
    expect(messages(result.diagnostics, "error").join(" ")).toContain("not valid YAML");
  });
});

describe("compilePersonaMarkdown — nothing fails silently", () => {
  const base = "---\npersonaId: a\ndisplayName: A\narchetype: x\n---\n## Identity\ni\n## Voice\n- v\n## Style Examples\n- 1\n- 2\n- 3\n";

  it("warns on an unrecognized section and suggests the closest known heading", () => {
    const result = compile(`${base}## Style Exmples\n- oops`);
    const warning = result.diagnostics.find((d) => d.level === "warning");
    expect(warning?.message).toContain("Unrecognized section");
    expect(warning?.hint).toContain("style examples");
  });

  it("warns when a structured section has no fenced yaml block instead of dropping it", () => {
    const result = compile(`${base}## Memories\n- he took credit for her work`);
    expect(messages(result.diagnostics, "warning").join(" ")).toContain("no ```yaml block");
  });

  it("errors on a memory with no summary, keeping the other entries", () => {
    const result = compile(
      `${base}## Memories\n\`\`\`yaml\n- type: episodic\n  emotionalTone: anger\n- type: episodic\n  summary: kept\n\`\`\``,
    );
    expect(messages(result.diagnostics, "error").join(" ")).toContain("no `summary`");
    expect(result.pack?.memorySeeds).toHaveLength(1);
  });

  it("warns on a relationship bullet that is not `agentId: description`", () => {
    const result = compile(`${base}## Relationships\n- bruno is annoying`);
    expect(messages(result.diagnostics, "warning").join(" ")).toContain("agentId: description");
  });

  it("warns and falls back on an out-of-range enum rather than emitting an invalid pack", () => {
    const result = compile(`${base.replace("archetype: x", "archetype: x\nchaosCap: chaotic")}`);
    expect(messages(result.diagnostics, "warning").join(" ")).toContain("chaosCap");
    expect(result.pack?.edgeProfile.chaosCap).toBe("medium");
  });

  it("clamps an out-of-range confidence and says so", () => {
    const result = compile(
      `${base}## Memories\n\`\`\`yaml\n- type: episodic\n  summary: s\n  confidence: 4\n\`\`\``,
    );
    expect(messages(result.diagnostics, "warning").join(" ")).toContain("clamped");
    expect(result.pack?.memorySeeds[0]?.confidence).toBe(1);
  });

  it("detects the language when frontmatter does not declare one", () => {
    const result = compile(
      "---\npersonaId: a\ndisplayName: A\narchetype: x\n---\n## Identity\nVocê é a pessoa que não desiste quando alguém precisa de você.\n## Voice\n- calorosa\n## Style Examples\n- 1\n- 2\n- 3",
    );
    expect(result.pack?.language).toBe("pt-BR");
    expect(result.language?.source).toBe("heuristic");
  });
});
