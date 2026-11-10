/**
 * The drama prompt (act-contract.md 11.5, verb-bible.md 3 and 4): with `BodyPerception.drama` set the output contract teaches the `act`
 * key, lists the 18 verbs, states the ladder and the telenovela rule, and shows three answers that parse. Without it nothing changes
 * (`drama-off-identity.test.ts` holds that byte for byte). The decode grammar follows the same flag.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ACT_TARGET_MODE,
  ACT_VERBS,
  BodyIntentSchema,
  ModelIntentPacketJsonSchema,
  ModelIntentPacketWithActJsonSchema,
  ModelIntentPacketWithBodyJsonSchema,
  modelIntentPacketFieldContract,
} from "@perfectman/shared";
import type { AgentRuntimeInput, BodyPerception } from "@perfectman/shared";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import { PromptBuilder } from "../prompt-builder.js";
import { SCENE_CRAFT, SCENE_CRAFT_COMPACT, dramaCompactLines, dramaContractLines, dramaExamples } from "../hotel-drama-hint.js";
import { OllamaProvider } from "../../llm/ollama-provider.js";
import { intentSchemaFor } from "../../llm/sdk-transport.js";
import { hotelInput, humanLine } from "./hotel-test-helpers.js";

const FORBIDDEN = /\b(ai|ia|bots?|rob[oô]s?|models?|modelos?|agents?|agentes?|simulations?|simula[cç][aã]o|pulses?|badge|real person)\b/i;

/** What the reader is, by role or by permission, in either language, on top of FORBIDDEN (D43, act-contract.md 11.5). */
const FORBIDDEN_CRAFT = /\b(characters?|personagens?|actors?|actress|atores|atriz|roles?|papel|papéis|act as|permissions?|permiss[aã]o|allowed to|roleplay|role-play|game|jogo|prompt|assistant|assistente|npc|llm|chatbot|simulated)\b/i;

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", ".claude", "skills", "perfectman-scene-runtime");

const profileOf = (language: "pt-BR" | "en") => ({ ...EXAMPLE_PROMPT_PROFILE, language, hotelMode: true, relationshipBiases: {}, messageLength: "short" as const });

function withDrama(input: AgentRuntimeInput): AgentRuntimeInput {
  return { ...input, perceptionPacket: { ...input.perceptionPacket, body: { ...input.perceptionPacket.body!, drama: true } } };
}

describe.each(["pt-BR", "en"] as const)("the drama prompt, %s", (language) => {
  const profile = profileOf(language);
  const built = PromptBuilder.build(withDrama(hotelInput()), profile, "action_intent");
  const compact = PromptBuilder.build(withDrama(hotelInput()), profile, "action_intent", undefined, "compact");
  const off = PromptBuilder.build(hotelInput(), profile, "action_intent");

  it("[11.5] lists all 18 verb ids and says the actor may propose any of them", () => {
    for (const verb of ACT_VERBS) expect(built.system, verb).toContain(verb);
    expect(built.system).toContain('"act"');
    expect(built.system).toMatch(language === "en" ? /You may propose any of them/ : /Você pode propor qualquer um/);
  });

  it("gives when to use each verb by the feeling behind it", () => {
    const text = built.system;
    const lines = text.split("\n").filter((l) => l.startsWith("- ") && /\(.*\)$/.test(l));
    const covered = new Set(ACT_VERBS.filter((v) => lines.some((l) => new RegExp(`\\b${v}\\b`).test(l))));
    expect([...covered].sort()).toEqual([...ACT_VERBS].sort());
    expect(text).toMatch(language === "en" ? /anger, contempt, jealousy/ : /raiva, desprezo, ciúme/);
    expect(text).toMatch(language === "en" ? /shame, grief/ : /vergonha, luto/);
  });

  it("states the ladder in plain words, one step at a time, with the way down always open", () => {
    expect(built.system).toMatch(language === "en" ? /glare, insult, shove, slap, punch, kill\. You climb one step at a time/ : /glare, insult, shove, slap, punch, kill\. Você sobe um degrau de cada vez/);
    expect(built.system).toMatch(language === "en" ? /Coming down is always fine/ : /Descer é sempre possível/);
  });

  it("[#262] tells a model that only talks that a line which confronts someone goes with an act in the same answer, in the full prompt and the compact one", () => {
    const rule = language === "en" ? /confronts, accuses or threatens someone[^.]*same answer/ : /confronta, acusa ou ameaça alguém[^.]*mesma resposta/;
    expect(built.system).toMatch(rule);
    expect(compact.system).toMatch(rule);
    expect(built.system).toMatch(language === "en" ? /glare or insult/ : /glare ou insult/);
  });

  it("says violence is stylized telenovela and that the scene sets the limit, and never that it needs permission", () => {
    expect(built.system).toMatch(language === "en" ? /telenovela, stylized/ : /novela, estilizado/);
    expect(built.system).toMatch(language === "en" ? /set by the scene itself/ : /definido pela própria cena/);
    expect(built.system).not.toMatch(/permission|permiss[aã]o|allowed to/i);
  });

  it("never says what the reader is (D43)", () => {
    for (const text of [built.system, built.user, compact.system, compact.user]) {
      const hits = [...text.matchAll(new RegExp(FORBIDDEN.source, "gi"))].map((m) => text.slice(Math.max(0, m.index - 30), m.index + 30));
      expect(hits).toEqual([]);
    }
  });

  it("teaches the `act` field in the field list, which a run without drama does not show", () => {
    expect(built.system).toMatch(/"body" \(optional\)/);
    expect(modelIntentPacketFieldContract({ body: true, act: true }).join("\n")).not.toBe(modelIntentPacketFieldContract({ body: true }).join("\n"));
    expect(off.system).not.toContain('"act"');
    expect(off.system).not.toContain("tend_fallen");
  });

  it("the compact prompt carries the verbs, the ladder and the style rule too, and is still the smaller one", () => {
    for (const verb of ACT_VERBS) expect(compact.system, verb).toContain(verb);
    expect(compact.system).toMatch(language === "en" ? /telenovela, stylized/ : /novela, estilizado/);
    expect(compact.inputTokensEstimate).toBeLessThan(built.inputTokensEstimate);
  });

  it("the drama block is never what a tight budget sheds: events go first, the verbs stay, and the block costs under 1200 tokens (about 800 before the scene-craft block, about 300 for it)", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({ ...humanLine(`linha ${i} ${"x".repeat(120)}`, "Visitante"), id: `evt-${i}`, pulseIndex: i }));
    const busy = withDrama(hotelInput(events));
    const full = PromptBuilder.build(busy, profile, "action_intent");
    const capped = PromptBuilder.build(busy, profile, "action_intent", full.inputTokensEstimate - 200);
    expect(capped.trim?.withinCap).toBe(true);
    expect(capped.trim?.droppedEvents).toBeGreaterThan(0);
    expect(capped.system).toContain("tend_fallen");
    expect(full.inputTokensEstimate - PromptBuilder.build(hotelInput(events), profile, "action_intent").inputTokensEstimate).toBeLessThan(1200);
  });
});

describe.each(["pt-BR", "en"] as const)("the scene-craft block, %s", (language) => {
  const profile = profileOf(language);
  const built = PromptBuilder.build(withDrama(hotelInput()), profile, "action_intent");
  const compact = PromptBuilder.build(withDrama(hotelInput()), profile, "action_intent", undefined, "compact");
  const off = PromptBuilder.build(hotelInput(), profile, "action_intent");
  const offCompact = PromptBuilder.build(hotelInput(), profile, "action_intent", undefined, "compact");
  const body = withDrama(hotelInput()).perceptionPacket.body;

  it("is returned by dramaContractLines (whole) and dramaCompactLines (the short one), after the style rule and before the examples", () => {
    const full = dramaContractLines(language, body);
    const short = dramaCompactLines(language, body);
    expect(full).toContain(SCENE_CRAFT[language]);
    expect(short).toContain(SCENE_CRAFT_COMPACT[language]);
    expect(short).not.toContain(SCENE_CRAFT[language]);
    expect(full.indexOf(SCENE_CRAFT[language])).toBe(full.length - 2);
    expect(short.indexOf(SCENE_CRAFT_COMPACT[language])).toBe(short.length - 2);
  });

  it("reaches the full prompt and the compact prompt with drama on, and neither without it", () => {
    expect(built.system).toContain(SCENE_CRAFT[language]);
    expect(compact.system).toContain(SCENE_CRAFT_COMPACT[language]);
    const marker = language === "en" ? "stonewall" : "encurralar";
    expect(off.system + off.user).not.toContain(marker);
    expect(offCompact.system + offCompact.user).not.toContain(marker);
    expect(built.user).not.toContain(marker);
  });

  it("carries the six ideas: one thing to do, held until it works or fails, status in the body, the body past words, a refused beat leaves the words standing, silence", () => {
    const text = SCENE_CRAFT[language];
    const ideas = language === "en"
      ? [/pick one thing to do/, /until it works, fails, or something new happens/, /how high or low you stand/, /do what words cannot/, /your words still stand/, /silent and still is also an answer/]
      : [/escolha uma coisa para fazer/, /até ela funcionar, falhar ou acontecer algo novo/, /por cima ou por baixo/, /fazer o que as palavras não fazem/, /as suas palavras continuam valendo/, /quieto e parado também é uma resposta/];
    for (const idea of ideas) expect(text).toMatch(idea);
  });

  it("the compact one stays under 450 characters and still holds the ideas", () => {
    const text = SCENE_CRAFT_COMPACT[language];
    expect(text.length).toBeLessThan(450);
    const ideas = language === "en"
      ? [/pick one thing to do/, /until it works, fails or something new happens/, /how high or low you stand/, /words cannot/, /your words still stand/, /Silence is an answer/]
      : [/escolha uma coisa para fazer/, /até funcionar, falhar ou acontecer algo novo/, /por cima ou por baixo/, /o que as palavras não fazem/, /suas palavras continuam valendo/, /quieto também é uma resposta/];
    for (const idea of ideas) expect(text).toMatch(idea);
  });

  it("[D43] says nothing about what the reader is, no permission, in the constants or in what both prompts render", () => {
    for (const text of [SCENE_CRAFT[language], SCENE_CRAFT_COMPACT[language]]) {
      expect(text.match(new RegExp(FORBIDDEN.source, "i"))).toBeNull();
      expect(text.match(FORBIDDEN_CRAFT)).toBeNull();
    }
    // The rest of the prompt has its own words; what the block adds must not add a hit to either prompt.
    const hits = (text: string): string[] => [...text.matchAll(new RegExp(FORBIDDEN_CRAFT.source, "gi"))].map((m) => m[0]);
    expect(hits(built.system)).toEqual(hits(off.system));
    expect(hits(compact.system)).toEqual(hits(offCompact.system));
  });

  it("the skill's digest files are the same text as the constants, so the two cannot drift, and carry no comment", () => {
    const full = readFileSync(join(SKILL_DIR, `digest.${language}.md`), "utf8");
    const short = readFileSync(join(SKILL_DIR, `digest-compact.${language}.md`), "utf8");
    expect(full).toBe(`${SCENE_CRAFT[language]}\n`);
    expect(short).toBe(`${SCENE_CRAFT_COMPACT[language]}\n`);
    for (const text of [full, short]) {
      expect(text).not.toMatch(/<!--|^#|^\/\/|^>|^\s*[-*] /m);
      expect(text.match(FORBIDDEN_CRAFT)).toBeNull();
    }
  });
});

describe("the three few-shot answers", () => {
  const body: BodyPerception = { ...hotelInput().perceptionPacket.body!, drama: true };
  const handles = new Set(body.people.map((p) => p.handle));

  it.each(["pt-BR", "en"] as const)("[%s] parse as a body block with an `act`, name a handle of this render, and carry speech", (language) => {
    const answers = dramaExamples(language, body);
    expect(answers).toHaveLength(3);
    for (const raw of answers) {
      const parsed = JSON.parse(raw) as { intentType: string; visibleContent: string; privateMotiveSummary: string; body: unknown };
      expect(parsed.intentType).toBe("send_message");
      expect(parsed.visibleContent.length).toBeGreaterThan(5);
      const checked = BodyIntentSchema.safeParse(parsed.body);
      expect(checked.success).toBe(true);
      const act = checked.success ? checked.data.act : undefined;
      expect(act).toBeDefined();
      if (act && ACT_TARGET_MODE[act.verb] === "required") expect(handles.has(act.target ?? "")).toBe(true);
      if (act && ACT_TARGET_MODE[act.verb] === "none") expect(act.target).toBeUndefined();
      expect(act?.intensity).toBeGreaterThanOrEqual(0);
      expect(act?.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("show a verb with a target and intensity, a second one with a target, and a solo verb", () => {
    const verbs = dramaExamples("en", body).map((r) => (JSON.parse(r) as { body: { act: { verb: (typeof ACT_VERBS)[number]; target?: string } } }).body.act);
    expect(verbs.map((a) => a.verb)).toEqual(["insult", "hug", "cry"]);
    expect(verbs.map((a) => a.target !== undefined)).toEqual([true, true, false]);
  });
});

describe("the decode grammar follows the drama flag", () => {
  it("[NEG-2] no body: plain; a body without drama: the one every run has always had; drama: the one with `act`", () => {
    expect(intentSchemaFor(undefined)).toBe(ModelIntentPacketJsonSchema);
    expect(intentSchemaFor({ withBody: true })).toBe(ModelIntentPacketWithBodyJsonSchema);
    expect(intentSchemaFor({ withBody: true, withAct: true })).toBe(ModelIntentPacketWithActJsonSchema);
    expect(JSON.stringify(ModelIntentPacketWithBodyJsonSchema)).not.toContain('"act"');
    expect(JSON.stringify(ModelIntentPacketWithActJsonSchema)).toContain('"act"');
  });

  it("the provider sends the `act` grammar only for a perception that carries `drama`", async () => {
    const spy = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ message: { content: '{"intentType":"no_op"}' }, model: "m", prompt_eval_count: 1, eval_count: 1, done: true }), { status: 200 })));
    const config = { providerType: "ollama", baseUrl: "http://localhost:11434", modelName: "m", maxInputTokens: 1000, maxOutputTokens: 200, temperature: 1, timeoutMs: 5000, retryCount: 0, responseFormatJson: true } as never;
    const built = { system: "s", user: "u", inputTokensEstimate: 1, purpose: "action_intent", version: "v", templateVersion: "t" } as never;
    const provider = new OllamaProvider(config, { fetch: spy });
    const formatOf = (n: number): unknown => JSON.parse(spy.mock.calls[n]![1].body as string).format;
    await provider.generateIntent(hotelInput(), { pulseIndex: 1, now: 0 }, built);
    await provider.generateIntent(withDrama(hotelInput()), { pulseIndex: 1, now: 0 }, built);
    expect(formatOf(0)).toEqual(ModelIntentPacketWithBodyJsonSchema);
    expect(formatOf(1)).toEqual(ModelIntentPacketWithActJsonSchema);
  });
});
