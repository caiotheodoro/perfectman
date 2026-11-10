/**
 * The draft applies the drafting skill (.claude/skills/perfectman-cast-and-scenario-drafting): the prompt teaches the craft, the reply's
 * script is repaired in code, and what a draft turns into compiles with the real compilers. The model is mocked; nothing here calls out.
 */
import { ACT_VERBS, roomFiles } from "@perfectman/shared";
import type { DraftStoryRequest, StoryDraft } from "@perfectman/shared";
import { describe, expect, it, vi } from "vitest";
import { compilePersonaMarkdown } from "../persona-md-compiler.js";
import { compileScenarioMarkdown } from "../scenario-md-compiler.js";
import { draftPrompt, draftStory, toStoryDraft } from "../story-draft.js";

const person = (name: string, extra: Record<string, unknown> = {}) => ({
  name, role: "connector", goal: "Fazer o outro olhar para ela.", obstacle: "Ele vira as costas.", method: "insiste, chegando mais perto", standing: "low", flips: true, voice: "Baixa, seca.", lines: ["Olha pra mim.", "Eu conferi três vezes.", "Responde."], ...extra,
});
const KISS = { title: "Última estação", situation: "Dois colegas esperam o último trem na plataforma vazia. Ela acabou de pedir demissão.", language: "pt-BR",
  people: [person("Iris"), person("Dev", { standing: "high" }), person("Marlowe", { standing: "low", flips: false })],
  beats: [{ at: 20, actor: "Dev", verb: "insult", with: "Iris" }, { at: 70, actor: "Iris", verb: "kiss", with: "Dev" }, { at: 100, actor: "Marlowe", verb: "freeze_gasp" }] };
const KILL = { title: "O livro-caixa", situation: "Fim do expediente. A conta dos fornecedores não fecha e o chefe manda a contadora para casa.", language: "pt-BR",
  people: [person("Rocha", { standing: "high" }), person("Dalila"), person("Kleber", { standing: "low", flips: false })],
  beats: [{ at: 20, actor: "Rocha", verb: "insult", with: "Dalila" }, { at: 55, actor: "Dalila", verb: "glare", with: "Rocha" }, { at: 115, actor: "Dalila", verb: "kill", with: "Rocha", skip: true }, { at: 150, cut: "o escritório fica em silêncio" }] };

const reply = (content: unknown): Response => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
const request = (language: "en" | "pt-BR" = "pt-BR"): DraftStoryRequest => ({ idea: "uma contadora enfrenta o chefe que desviou dinheiro", language, llm: { providerType: "openai-compatible", baseUrl: "https://llm.test/v1", modelName: "m", apiKey: "sk-test-123" } });
const errors = (diagnostics: readonly { level: string }[]) => diagnostics.filter((d) => d.level === "error");

/** The draft as files, compiled the way the loader does: the scenario (with its drama block and beats read as plain frontmatter) and every persona. */
function compileAll(draft: StoryDraft) {
  const { scenario, personas } = roomFiles(draft);
  const compiledScenario = compileScenarioMarkdown(scenario.text, scenario.filename);
  const compiledPersonas = personas.map((p) => compilePersonaMarkdown(p.text, p.filename, { scenarioLanguage: draft.language }));
  return { scenario, personas, diagnostics: [...compiledScenario.diagnostics, ...compiledPersonas.flatMap((p) => p.diagnostics)], compiledScenario };
}

describe("the draft prompt teaches the craft", () => {
  for (const language of ["pt-BR", "en"] as const) {
    it(`${language}: wants, obstacle, method and standing; one earned peak; the 18 verbs; the safety rules`, () => {
      const { system, user } = draftPrompt("uma ideia qualquer", 3, language);
      const text = `${system}\n${user}`;
      // Each person wants something from ANOTHER person, has an obstacle and a method, and holds the room or is held by it, which can flip.
      for (const needle of ["ANOTHER named person", '"obstacle"', '"method"', '"standing": "high"', '"flips"', "pair swap standing"]) expect(text).toContain(needle);
      // One earned physical peak that overflows the words, one rung at a time, then an aftermath.
      for (const needle of ["one earned peak", "glare, insult, shove, slap, punch, kill are rungs 1 to 6", "Open at insult at most", "only the peak may jump", "one beat of aftermath"]) expect(text).toContain(needle);
      // Only the 18 verbs, taken from the code's own constants, with the target split.
      for (const verb of ACT_VERBS) expect(text).toContain(verb);
      expect(text).toContain('Without "with": die, recoil, freeze_gasp, cry, storm_off, tableau, faint');
      // Safety and gates.
      for (const needle of ["First beat at 15 s or later", "at least 20 s apart", "at most one death", "followed by a cut", "No weapon, blood or gore", "stab, shoot, strangle, poison = kill", "Never @human or a visitor in beats"]) expect(text).toContain(needle);
    });

    it(`${language}: none of the framework's jargon`, () => {
      const { system, user } = draftPrompt("uma ideia qualquer", 3, language);
      expect(`${system}\n${user}`).not.toMatch(/\b(GOTE|CHAE|Stanislavski|Johnstone|status|tactics?|character)\b/i);
    });
  }

  it("follows the user's language for prose and keeps machine keys English", () => {
    const pt = draftPrompt("x", 3, "pt-BR").user;
    const en = draftPrompt("x", 3, "en").user;
    expect(pt).toContain("in Brazilian Portuguese (pt-BR)");
    expect(pt).toContain("beijo = kiss");
    expect(pt).toContain('Keys, "standing" values and verb names stay in English');
    expect(en).not.toContain("beijo");
    expect(en).toContain('keys, "standing" values and verb names stay in English');
  });

  it("stays short: under 3.1 thousand characters (it was 1.3 thousand before the craft, and the verb lists come from the code's constants)", () => {
    for (const language of ["pt-BR", "en"] as const) {
      const { system, user } = draftPrompt("", 3, language);
      expect(system.length + user.length).toBeLessThan(3100);
    }
  });
});

describe("a drafted kiss and a drafted kill compile with no error diagnostics", () => {
  it("kiss: persona manner from standing, a trigger from obstacle and method, drama rung 2, the pair opened side by side", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(KISS));
    const draft = await draftStory(request(), fetchImpl);
    const { scenario, personas, diagnostics } = compileAll(draft);
    expect(errors(diagnostics)).toEqual([]);
    expect(scenario.text).toContain('drama: {"max_rung":2,"may_target":[],"may_die":[],"permadeath":false}');
    expect(scenario.text).toContain('{"at":70,"actor":"person-1","verb":"kiss","with":"person-2"}');
    expect(scenario.text).toMatch(/Iris e Dev começam de pé, lado a lado\./);
    expect(personas[0]!.text).toContain("Quando acha o chão");
    expect(personas[1]!.text).toContain("Fala devagar");
    expect(personas[0]!.text).toContain("Ele vira as costas.");
    for (const file of [scenario, ...personas]) expect(file.text).not.toMatch(/\b(status|tactic|GOTE|CHAE)\b/i);
  });

  it("kill: max_rung 6, one pair, only the victim may die, an authored skip on the peak, and a cut after the death", async () => {
    const draft = toStoryDraft(JSON.stringify(KILL), "pt-BR");
    const { scenario, diagnostics } = compileAll(draft);
    expect(errors(diagnostics)).toEqual([]);
    expect(scenario.text).toContain('drama: {"max_rung":6,"may_target":[["person-2","person-1"]],"may_die":["person-1"],"permadeath":true}');
    expect(scenario.text).toContain('{"at":115,"actor":"person-2","verb":"kill","with":"person-1","skip":true}');
    expect(scenario.text).toContain('{"at":150,"cut":"o escritório fica em silêncio"}');
    expect(scenario.text).not.toContain("@human");
  });

  it("the English draft compiles too", () => {
    const draft = toStoryDraft(JSON.stringify({ ...KILL, language: "en" }), "en");
    expect(errors(compileAll(draft).diagnostics)).toEqual([]);
  });
});

describe("bad model outputs are repaired or rejected, never shipped", () => {
  it("a thirteenth person never reaches the files: the cast is capped, and a beat naming a person past the cap is dropped", () => {
    const people = Array.from({ length: 13 }, (_, i) => person(`Pessoa${i + 1}`));
    const draft = toStoryDraft(JSON.stringify({ ...KILL, people, beats: [{ at: 20, actor: "Pessoa1", verb: "insult", with: "Pessoa2" }, { at: 60, actor: "Pessoa9", verb: "slap", with: "Pessoa1" }] }), "pt-BR");
    expect(draft.people).toHaveLength(6);
    expect(draft.beats).toEqual([{ at: 20, actor: "Pessoa1", verb: "insult", with: "Pessoa2" }]);
    expect(errors(compileAll(draft).diagnostics)).toEqual([]);
    expect(() => roomFiles({ ...draft, people: Array.from({ length: 13 }, (_, i) => person(`P${i}`)) as StoryDraft["people"] })).toThrow(/between two and 12/);
  });

  it("an unknown verb is dropped and the rest of the script survives", () => {
    const draft = toStoryDraft(JSON.stringify({ ...KILL, beats: [{ at: 20, actor: "Rocha", verb: "stab", with: "Dalila" }, { at: 40, actor: "Rocha", verb: "insult", with: "Dalila" }] }), "pt-BR");
    expect(draft.beats).toEqual([{ at: 40, actor: "Rocha", verb: "insult", with: "Dalila" }]);
  });

  it("@human is dropped from every place it can appear", () => {
    const draft = toStoryDraft(JSON.stringify({ ...KILL, beats: [{ at: 20, actor: "Rocha", verb: "slap", with: "@human" }, { at: 40, actor: "@human", verb: "slap", with: "Rocha" }, { at: 60, actor: "Rocha", verb: "insult", with: "Dalila" }] }), "pt-BR");
    expect(JSON.stringify(draft.beats)).not.toContain("@human");
    const { scenario } = roomFiles(draft);
    expect(scenario.text).not.toContain("@human");
  });

  it("a second kill is dropped, so the block has one victim and the script one death", () => {
    const draft = toStoryDraft(JSON.stringify({ ...KILL, beats: [{ at: 20, actor: "Dalila", verb: "insult", with: "Rocha" }, { at: 60, actor: "Dalila", verb: "kill", with: "Rocha" }, { at: 120, actor: "Rocha", verb: "kill", with: "Kleber" }] }), "pt-BR");
    expect(draft.beats?.filter((b) => b.verb === "kill")).toHaveLength(1);
    const { scenario } = roomFiles(draft);
    expect(scenario.text).toContain('"may_die":["person-1"]');
    expect(scenario.text).toContain('"cut"');
    expect(errors(compileAll(draft).diagnostics)).toEqual([]);
  });

  it("two physical beats under 20 s apart are spaced", () => {
    const draft = toStoryDraft(JSON.stringify({ ...KILL, beats: [{ at: 20, actor: "Rocha", verb: "insult", with: "Dalila" }, { at: 30, actor: "Rocha", verb: "punch", with: "Dalila" }, { at: 35, actor: "Rocha", verb: "slap", with: "Dalila" }] }), "pt-BR");
    expect((draft.beats ?? []).filter((b) => b.verb === "slap" || b.verb === "punch").map((b) => [b.verb, b.at])).toEqual([["punch", 30], ["slap", 50]]);
  });

  it("a script with no usable act leaves a plain story, free play, with no drama block", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({ ...KILL, beats: [{ at: 20, actor: "Rocha", verb: "stab", with: "Dalila" }, "nonsense"] }));
    const draft = await draftStory(request(), fetchImpl);
    expect(draft.beats).toBeUndefined();
    expect(roomFiles(draft).scenario.text).not.toMatch(/drama|beats/);
  });

  it("wrong types in the new fields cost the field, not the draft", () => {
    const draft = toStoryDraft(JSON.stringify({ ...KILL, beats: "none", people: [person("Rocha", { flips: "yes", standing: 7, obstacle: null }), person("Dalila")] }), "pt-BR");
    expect(draft.people[0]).toMatchObject({ name: "Rocha" });
    expect(draft.people[0]).not.toHaveProperty("standing");
    expect(draft.people[0]).not.toHaveProperty("obstacle");
    expect(draft.beats).toBeUndefined();
  });
});
