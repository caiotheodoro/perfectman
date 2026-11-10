import { CONTACT_VERBS, repairBeats } from "./draft-beats.js";
import type { DraftBeat } from "./draft-beats.js";
import type { UploadedFile } from "./run-api.types.js";
import type { MessageLength } from "../script-likeness/guards.js";

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
export type CharacterDraft = {
  name: string; role: keyof typeof ROLES; goal: string; voice?: string; lines?: string[]; identity?: string; triggers?: Array<{ trigger: string; behavior: string }>; speed?: ReplySpeed;
  /** What stands in the way (usually another person's goal) and what they do about it; together one trigger in the persona. */
  obstacle?: string; method?: string;
  /** Who holds the room when the scene opens, and whether that reverses by its peak; written into `## Voice` as manner, never as a label. */
  standing?: "high" | "low"; flips?: boolean;
  /** How long a line runs (`presence.messageLength`): `short` when a draft does not say, so a drafted person speaks in lines of a few words, not paragraphs. */
  messageLength?: MessageLength;
};
export type RoomDraft = {
  title: string; situation: string; people: CharacterDraft[]; language?: "en" | "pt-BR"; /** `spite`: a pt-BR scene of contained hatred over one object, with no temperament calibration. */ tone?: "spite"; /** What the person typed, kept so it can be drafted again. */ idea?: string;
  /** The scene's script by cast name: acts and cuts at a second of the run. `roomFiles` repairs it (`repairBeats`) and derives the `drama` block; absent means free play. */
  beats?: DraftBeat[];
};
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
    constraint: "Diga o que você quer, uma vez, em voz alta. Não explique o plano.",
    identity: "Você é",
    commonRoom: "Sala comum",
    resource: "the_groups_attention",
  },
  en: {
    mood: "Expectant; each person is focused on their own goal.",
    intro: "Begin in the middle of the situation. Do not introduce yourself.",
    first: "Respond to the situation in your own voice.",
    goal: "Private goal",
    constraint: "Do not state your private goal outright; win the group over through your choices.",
    identity: "You are",
    commonRoom: "Common room",
    resource: "the_groups_attention",
  },
} as const;

/** How standing shows in a person's manner (the persona reads manner, never the label). */
const MANNER = {
  "pt-BR": {
    high: "Fala devagar, sem pressa, sustenta o olhar e interrompe quando quer.",
    low: "Fala depressa, perde a frase no meio e desvia o olhar.",
    highToLow: "Quando perde o chão, a voz encurta e o olhar cai.",
    lowToHigh: "Quando acha o chão, a voz abaixa, firma e o olhar não desvia.",
    side: "começam de pé, lado a lado.",
    and: "e",
  },
  en: {
    high: "Slow and unhurried; holds eye contact and interrupts when they choose.",
    low: "Quick; loses the thread mid-sentence and looks away.",
    highToLow: "When the ground goes, the voice shortens and the eyes drop.",
    lowToHigh: "When they find their footing, the voice drops, steadies and the gaze holds.",
    side: "start standing side by side.",
    and: "and",
  },
} as const;

/** A spite scene's fixed text: the objective is the object, and the standing order forbids a second plot. */
const SPITE = {
  mood: "Ódio contido. Ninguém faz as pazes e ninguém inventa outro assunto.",
  intro: "Comece no meio. A primeira frase é uma das tuas falas.",
  first: "Se a outra pessoa mudar de assunto, repete a tua fala. Não pede desculpa. Não chega perto.",
  goal: "O que você diz",
  constraint: "Só fala do objeto e da pessoa na tua frente. Não inventa objeto, parente, aposta, piada nem outro cômodo. Não pede desculpa. Não anda.",
  identity: "Você é",
  commonRoom: "Sala comum",
  resource: "the_object",
} as const;

const prose = (text: string) => text.replace(/\s+/g, " ").trim();
const header = (fields: Record<string, unknown>) => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n`;

/** Use the existing Markdown compiler; the beginner form adds no new run format. */
export function roomFiles(draft: RoomDraft): RoomFiles {
  if (draft.people.length < 2 || draft.people.length > MAX_PEOPLE) throw new Error(`Choose between two and ${MAX_PEOPLE} characters.`);
  const spite = draft.tone === "spite" && draft.language !== "en";
  const words = spite ? SPITE : SCAFFOLD[draft.language === "pt-BR" ? "pt-BR" : "en"];
  if (!prose(draft.title) || !prose(draft.situation)) throw new Error("Give your scene a name and a situation.");
  const names = draft.people.map(person => prose(person.name).toLowerCase());
  if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error("Give each character a different name.");
  const ids = draft.people.map((_, index) => `person-${index + 1}`);
  const tongue = draft.language === "pt-BR" ? "pt-BR" : "en";
  const manner = MANNER[tongue];
  const script = draft.beats === undefined ? undefined : repairBeats(draft.beats, draft.people.map(person => person.name), tongue);
  const idOf = (name: string | undefined) => ids[names.indexOf(prose(name ?? "").toLowerCase())];
  const personas = draft.people.map((person, index) => {
    const role = ROLES[person.role];
    if (!role || !prose(person.goal)) throw new Error("Choose a personality and a private goal for each character.");
    const name = prose(person.name);
    const voice = prose(person.voice ?? "") || role.voice;
    // Standing as manner: how they carry themselves at the start, and how that turns if it flips.
    const carriage = person.standing === "high" || person.standing === "low" ? [manner[person.standing], ...(person.flips ? [person.standing === "high" ? manner.highToLow : manner.lowToHigh] : [])] : [];
    // The compiler wants three style examples; a model that wrote fewer gets the temperament's to fill the gap.
    const written = (person.lines ?? []).map(prose).filter(Boolean);
    // A pt-BR scene gets Portuguese examples (a model copies them), rotated per person so two people of one temperament do not share lines.
    const pool: readonly string[] = draft.language === "pt-BR" ? [...role.examplesPt.slice(index % role.examplesPt.length), ...role.examplesPt.slice(0, index % role.examplesPt.length)] : role.examples;
    const lines = [...written, ...pool].slice(0, Math.max(MIN_EXAMPLES, written.length));
    const identity = prose(person.identity ?? "");
    // Triggers are structured YAML under their own heading (docs of the persona format); a quote is JSON-escaped, which YAML reads.
    // The obstacle is the event, the method what the person does about it (the skill's mapping from obstacle and tactic to a trigger).
    const drafted = prose(person.obstacle ?? "") && prose(person.method ?? "") ? [{ trigger: prose(person.obstacle ?? ""), behavior: prose(person.method ?? "") }] : [];
    const triggers = [...drafted, ...(person.triggers ?? []).map(t => ({ trigger: prose(t.trigger), behavior: prose(t.behavior) }))].filter(t => t.trigger && t.behavior).slice(0, 6);
    const speed = person.speed && REPLY_DELAY_MS[person.speed];
    return { filename: `${ids[index]}.persona.md`, text: header({ personaId: ids[index], displayName: name,
      archetype: person.role, language: draft.language ?? "en", ...(spite ? {} : { calibrationFrom: role.calibration }), writingStyle: voice,
      presence: { messageLength: person.messageLength ?? "short", ...(speed ? { responseDelayMs: speed } : {}) } }) +
      `\n## Identity\n${words.identity} ${name}. ${identity ? `${identity} ` : ""}${voice}\n\n## Voice\n${[voice, ...carriage].map(line => `- ${line}`).join("\n")}\n\n## Style Examples\n${lines.map(line => `- ${line}`).join("\n")}\n\n## Private Motives\n- ${prose(person.goal)}\n` +
      (triggers.length ? `\n## Triggers\n\n\`\`\`yaml\n${triggers.map(t => `- trigger: ${JSON.stringify(t.trigger)}\n  behavior: ${JSON.stringify(t.behavior)}`).join("\n")}\n\`\`\`\n` : "") };
  });
  // Contact needs both people still and adjacent (GATE-7): say so once per pair in the opening, so the script's contact beats can land.
  const pairs = new Map<string, string>();
  for (const beat of script?.beats ?? []) {
    if (beat.verb === undefined || beat.with === undefined || beat.actor === undefined || !(CONTACT_VERBS as readonly string[]).includes(beat.verb)) continue;
    pairs.set([beat.actor, beat.with].sort().join("|"), `${beat.actor} ${manner.and} ${beat.with} ${manner.side}`);
  }
  const together = [...pairs.values()].slice(0, 2).join(" ");
  const toIds = (beat: DraftBeat) => beat.cut !== undefined ? beat : { at: beat.at, actor: idOf(beat.actor), verb: beat.verb, ...(beat.with !== undefined ? { with: idOf(beat.with) } : {}), ...(beat.skip ? { skip: true } : {}) };
  const drama = script?.drama && { ...script.drama, may_target: script.drama.may_target.map(([a, v]) => [idOf(a), idOf(v)]), may_die: script.drama.may_die.map(idOf) };
  const scenario = { filename: "my-scene.scenario.md", text: header({ name: prose(draft.title), language: draft.language ?? "en", seed: 42, maxPulses: 12,
    channels: [{ id: "room", name: words.commonRoom, type: "public_channel", default: true, members: ids }],
    cast: draft.people.map((person, index) => ({ agentId: ids[index], persona: personas[index]!.filename, displayName: prose(person.name) })),
    ...(drama && script?.beats.length ? { drama, beats: script.beats.map(toIds) } : {}) }) +
    `\n## Room Context\n${prose(draft.situation)}\n\n## Starting Mood\n${words.mood}\n\n## Intro Behavior\n${words.intro}\n\n## First Move\n${words.first}${together ? ` ${together}` : ""}\n` +
    draft.people.map((person, index) => `\n## Agent: ${ids[index]}\n\n### Hidden Objective\n${words.goal}: ${prose(person.goal)} (resource: ${words.resource})\nConstraint: ${words.constraint}\n`).join("") };
  return { personas, scenario };
}
