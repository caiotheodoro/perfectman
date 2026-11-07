import type { UploadedFile } from "./run-api.types.js";

/** The persona compiler rejects fewer style examples than this. */
const MIN_EXAMPLES = 3;
export const ROLES = {
  connector: { label: "Peacemaker", calibration: "caio", voice: "Warm and quick; looks for common ground.", examples: ["Can we hear everyone out?", "I think we want the same thing.", "Let's take this one step at a time."],
    examplesPt: ["Calma, vamos ouvir todo mundo.", "Acho que a gente quer a mesma coisa.", "Uma coisa de cada vez, tá?", "Bora conversar com calma.", "Ninguém aqui é inimigo de ninguém.", "Me conta o seu lado, sem pressa."] },
  skeptic: { label: "Straight talker", calibration: "mariana", voice: "Brief and direct; asks the question others avoid.", examples: ["What aren't we saying?", "That doesn't answer the question.", "I'd rather sort this out now."],
    examplesPt: ["O que a gente não está dizendo?", "Isso não responde a pergunta.", "Prefiro resolver isso agora.", "Fala logo o que você quer dizer.", "Hmm, não me convenceu.", "E se a gente olhar os fatos?"] },
  performer: { label: "Instigator", calibration: "goulart", voice: "Bold and playful; fills silence and challenges the room.", examples: ["Someone had to say it.", "Wait, hear me out.", "You're all being very quiet."],
    examplesPt: ["Alguém tinha que falar.", "Espera, me escuta essa.", "Tá todo mundo quieto demais.", "Ah, qual é, anima essa noite!", "Quem topa uma aposta?", "Duvido que vocês aguentem."] },
} as const;
/** A reply speed; it sets how long the person takes to answer (`presence.responseDelayMs` in the persona file). */
export type ReplySpeed = "quick" | "normal" | "slow";
const REPLY_DELAY_MS: Record<ReplySpeed, [number, number]> = { quick: [400, 2000], normal: [800, 4000], slow: [2500, 8000] };
/** `voice` and `lines` are what a drafted person says in their own register; without them the temperament speaks for them. `identity` is who they are (looks, history), `triggers` what sets them off, `speed` how fast they answer. */
export type CharacterDraft = { name: string; role: keyof typeof ROLES; goal: string; voice?: string; lines?: string[]; identity?: string; triggers?: Array<{ trigger: string; behavior: string }>; speed?: ReplySpeed };
export type RoomDraft = { title: string; situation: string; people: CharacterDraft[]; language?: "en" | "pt-BR"; /** What the person typed, kept so it can be drafted again. */ idea?: string };
export type RoomFiles = { personas: UploadedFile[]; scenario: UploadedFile };

/** The most people one scene holds (the hotel's cast limit is 12). */
export const MAX_PEOPLE = 12;

/** The scene's fixed text: pt-BR for a pt-BR scene, so what the model reads is in the scene's language. */
const SCAFFOLD = {
  "pt-BR": {
    mood: "Expectativa; cada pessoa está concentrada no próprio objetivo.",
    intro: "Comece no meio da situação. Não se apresente.",
    first: "Responda à situação com a sua própria voz.",
    goal: "Objetivo secreto",
    constraint: "Nunca diga o objetivo em voz alta; conquiste o grupo pelas suas escolhas.",
    identity: "Você é",
    commonRoom: "Sala comum",
  },
  en: {
    mood: "Expectant; each person is focused on their own goal.",
    intro: "Begin in the middle of the situation. Do not introduce yourself.",
    first: "Respond to the situation in your own voice.",
    goal: "Private goal",
    constraint: "Do not state your private goal outright; win the group over through your choices.",
    identity: "You are",
    commonRoom: "Common room",
  },
} as const;

const prose = (text: string) => text.replace(/\s+/g, " ").trim();
const header = (fields: Record<string, unknown>) => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n`;

/** Use the existing Markdown compiler; the beginner form adds no new run format. */
export function roomFiles(draft: RoomDraft): RoomFiles {
  if (draft.people.length < 2 || draft.people.length > MAX_PEOPLE) throw new Error(`Choose between two and ${MAX_PEOPLE} characters.`);
  const words = SCAFFOLD[draft.language === "pt-BR" ? "pt-BR" : "en"];
  if (!prose(draft.title) || !prose(draft.situation)) throw new Error("Give your scene a name and a situation.");
  const names = draft.people.map(person => prose(person.name).toLowerCase());
  if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error("Give each character a different name.");
  const ids = draft.people.map((_, index) => `person-${index + 1}`);
  const personas = draft.people.map((person, index) => {
    const role = ROLES[person.role];
    if (!role || !prose(person.goal)) throw new Error("Choose a personality and a private goal for each character.");
    const name = prose(person.name);
    const voice = prose(person.voice ?? "") || role.voice;
    // The compiler wants three style examples; a model that wrote fewer gets the temperament's to fill the gap.
    const written = (person.lines ?? []).map(prose).filter(Boolean);
    // A pt-BR scene gets Portuguese examples (a model copies them), rotated per person so two people of one temperament do not share lines.
    const pool: readonly string[] = draft.language === "pt-BR" ? [...role.examplesPt.slice(index % role.examplesPt.length), ...role.examplesPt.slice(0, index % role.examplesPt.length)] : role.examples;
    const lines = [...written, ...pool].slice(0, Math.max(MIN_EXAMPLES, written.length));
    const identity = prose(person.identity ?? "");
    // Triggers are structured YAML under their own heading (docs of the persona format); a quote is JSON-escaped, which YAML reads.
    const triggers = (person.triggers ?? []).map(t => ({ trigger: prose(t.trigger), behavior: prose(t.behavior) })).filter(t => t.trigger && t.behavior).slice(0, 6);
    const speed = person.speed && REPLY_DELAY_MS[person.speed];
    return { filename: `${ids[index]}.persona.md`, text: header({ personaId: ids[index], displayName: name,
      archetype: person.role, language: draft.language ?? "en", calibrationFrom: role.calibration, writingStyle: voice,
      ...(speed ? { presence: { responseDelayMs: speed } } : {}) }) +
      `\n## Identity\n${words.identity} ${name}. ${identity ? `${identity} ` : ""}${voice}\n\n## Voice\n- ${voice}\n\n## Style Examples\n${lines.map(line => `- ${line}`).join("\n")}\n\n## Private Motives\n- ${prose(person.goal)}\n` +
      (triggers.length ? `\n## Triggers\n\n\`\`\`yaml\n${triggers.map(t => `- trigger: ${JSON.stringify(t.trigger)}\n  behavior: ${JSON.stringify(t.behavior)}`).join("\n")}\n\`\`\`\n` : "") };
  });
  const scenario = { filename: "my-scene.scenario.md", text: header({ name: prose(draft.title), language: draft.language ?? "en", seed: 42, maxPulses: 12,
    channels: [{ id: "room", name: words.commonRoom, type: "public_channel", default: true, members: ids }],
    cast: draft.people.map((person, index) => ({ agentId: ids[index], persona: personas[index]!.filename, displayName: prose(person.name) })) }) +
    `\n## Room Context\n${prose(draft.situation)}\n\n## Starting Mood\n${words.mood}\n\n## Intro Behavior\n${words.intro}\n\n## First Move\n${words.first}\n` +
    draft.people.map((person, index) => `\n## Agent: ${ids[index]}\n\n### Hidden Objective\n${words.goal}: ${prose(person.goal)} (resource: the_groups_attention)\nConstraint: ${words.constraint}\n`).join("") };
  return { personas, scenario };
}
