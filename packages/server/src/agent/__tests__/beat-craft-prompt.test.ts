/**
 * The style lines an authored beat adds to a person's scene-craft digest (the slim KB's runtime feed, `BodyPerception.craft`). Without them the
 * prompt is the one it always was, byte for byte; with them it differs by exactly one block, under the budget, after the digest.
 */
import { describe, expect, it } from "vitest";
import { BEAT_CRAFT_MAX_CHARS, BeatCraft, parseSlimKb, slimFixture } from "@perfectman/shared";
import type { AgentRuntimeInput } from "@perfectman/shared";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import { PromptBuilder } from "../prompt-builder.js";
import { SCENE_CRAFT, SCENE_CRAFT_COMPACT, dramaCompactLines, dramaContractLines } from "../hotel-drama-hint.js";
import { hotelInput } from "./hotel-test-helpers.js";

const FORBIDDEN = /\b(ai|ia|bots?|rob[oô]s?|models?|modelos?|agents?|agentes?|simulations?|simula[cç][aã]o|pulses?|badge|real person)\b/i;
const FORBIDDEN_CRAFT = /\b(characters?|personagens?|actors?|actress|atores|atriz|roles?|papel|papéis|act as|permissions?|permiss[aã]o|allowed to|roleplay|role-play|game|jogo|prompt|assistant|assistente|npc|llm|chatbot|simulated)\b/i;

const profileOf = (language: "pt-BR" | "en") => ({ ...EXAMPLE_PROMPT_PROFILE, language, hotelMode: true, relationshipBiases: {}, messageLength: "short" as const });

function withDrama(input: AgentRuntimeInput, craft?: string): AgentRuntimeInput {
  return { ...input, perceptionPacket: { ...input.perceptionPacket, body: { ...input.perceptionPacket.body!, drama: true, ...(craft !== undefined ? { craft } : {}) } } };
}

const parsed = parseSlimKb(slimFixture());
if (!parsed.ok) throw new Error(parsed.error);
const REAL_CRAFT = (language: "en" | "pt-BR"): string => {
  const craft = BeatCraft.build([{ id: "b1", at_ms: 0, kind: "act", actor: "ana", verb: "insult" }], parsed.kb, { language, cast: 3 });
  const text = craft?.textFor("ana", 0);
  if (!text) throw new Error("no craft lines from the fixture");
  return text;
};

describe.each(["pt-BR", "en"] as const)("the beat craft in the drama prompt, %s", (language) => {
  const profile = profileOf(language);
  const craft = REAL_CRAFT(language);

  it("is byte-identical without craft, in the full prompt and in the compact one", () => {
    for (const style of [undefined, "compact"] as const) {
      const before = PromptBuilder.build(withDrama(hotelInput()), profile, "action_intent", undefined, style);
      const absent = PromptBuilder.build(withDrama(hotelInput(), undefined), profile, "action_intent", undefined, style);
      expect(absent).toEqual(before);
      expect(JSON.stringify(before)).not.toContain("Style reference");
      expect(JSON.stringify(before)).not.toContain("Referência de estilo");
    }
    const body = withDrama(hotelInput()).perceptionPacket.body;
    expect(dramaCompactLines(language, body)).toContain(SCENE_CRAFT_COMPACT[language]);
    expect(dramaContractLines(language, body)).toContain(SCENE_CRAFT[language]);
  });

  it("adds the lines right under the digest, in the full prompt and in the compact one, and changes nothing else", () => {
    for (const style of [undefined, "compact"] as const) {
      const digest = style === "compact" ? SCENE_CRAFT_COMPACT[language] : SCENE_CRAFT[language];
      const before = PromptBuilder.build(withDrama(hotelInput()), profile, "action_intent", undefined, style);
      const after = PromptBuilder.build(withDrama(hotelInput(), craft), profile, "action_intent", undefined, style);
      expect(after.system).toContain(`${digest}\n\n${craft}`);
      expect(after.system.replace(`\n\n${craft}`, "")).toBe(before.system);
      expect(after.user).toBe(before.user);
    }
  });

  it("keeps the lines within their budget, and cuts anything longer than it", () => {
    expect(craft.length).toBeLessThanOrEqual(BEAT_CRAFT_MAX_CHARS);
    const huge = `${craft}\n${"x".repeat(5000)}`;
    const body = withDrama(hotelInput(), huge).perceptionPacket.body;
    const lines = dramaCompactLines(language, body).join("\n");
    expect(lines).toContain(craft);
    expect(lines).not.toContain("x".repeat(BEAT_CRAFT_MAX_CHARS));
  });

  it("does not say what the reader is, or that this is a game, in the lines it adds", () => {
    expect(craft).not.toMatch(FORBIDDEN);
    expect(craft.split("\n")[0]).not.toMatch(FORBIDDEN_CRAFT);
  });

  it("shows nothing without drama, whatever the body carries", () => {
    const input = hotelInput();
    const noDrama: AgentRuntimeInput = { ...input, perceptionPacket: { ...input.perceptionPacket, body: { ...input.perceptionPacket.body!, craft } } };
    const built = PromptBuilder.build(noDrama, profile, "action_intent", undefined, "compact");
    expect(JSON.stringify(built)).not.toContain(craft.split("\n")[0]!);
  });
});
