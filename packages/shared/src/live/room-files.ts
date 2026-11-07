import type { UploadedFile } from "./run-api.types.js";

/** The persona compiler rejects fewer style examples than this. */
const MIN_EXAMPLES = 3;
export const ROLES = {
  connector: { label: "Peacemaker", calibration: "caio", voice: "Warm and quick; looks for common ground.", examples: ["Can we hear everyone out?", "I think we want the same thing.", "Let's take this one step at a time."] },
  skeptic: { label: "Straight talker", calibration: "mariana", voice: "Brief and direct; asks the question others avoid.", examples: ["What aren't we saying?", "That doesn't answer the question.", "I'd rather sort this out now."] },
  performer: { label: "Instigator", calibration: "goulart", voice: "Bold and playful; fills silence and challenges the room.", examples: ["Someone had to say it.", "Wait, hear me out.", "You're all being very quiet."] },
} as const;
/** `voice` and `lines` are what a drafted person says in their own register; without them the temperament speaks for them. */
export type CharacterDraft = { name: string; role: keyof typeof ROLES; goal: string; voice?: string; lines?: string[] };
export type RoomDraft = { title: string; situation: string; people: CharacterDraft[]; language?: "en" | "pt-BR"; /** What the person typed, kept so it can be drafted again. */ idea?: string };
export type RoomFiles = { personas: UploadedFile[]; scenario: UploadedFile };

const prose = (text: string) => text.replace(/\s+/g, " ").trim();
const header = (fields: Record<string, unknown>) => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n`;

/** Use the existing Markdown compiler; the beginner form adds no new run format. */
export function roomFiles(draft: RoomDraft): RoomFiles {
  if (draft.people.length < 2 || draft.people.length > 6) throw new Error("Choose between two and six characters.");
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
    const lines = [...written, ...role.examples].slice(0, Math.max(MIN_EXAMPLES, written.length));
    return { filename: `${ids[index]}.persona.md`, text: header({ personaId: ids[index], displayName: name,
      archetype: person.role, language: draft.language ?? "en", calibrationFrom: role.calibration, writingStyle: voice }) +
      `\n## Identity\nYou are ${name}. ${voice}\n\n## Voice\n- ${voice}\n\n## Style Examples\n${lines.map(line => `- ${line}`).join("\n")}\n\n## Private Motives\n- ${prose(person.goal)}\n` };
  });
  const scenario = { filename: "my-scene.scenario.md", text: header({ name: prose(draft.title), language: draft.language ?? "en", seed: 42, maxPulses: 12,
    channels: [{ id: "room", name: "Common room", type: "public_channel", default: true, members: ids }],
    cast: draft.people.map((person, index) => ({ agentId: ids[index], persona: personas[index]!.filename, displayName: prose(person.name) })) }) +
    `\n## Room Context\n${prose(draft.situation)}\n\n## Starting Mood\nExpectant; each person is focused on their own goal.\n\n## Intro Behavior\nBegin in the middle of the situation. Do not introduce yourself.\n\n## First Move\nRespond to the situation in your own voice.\n` +
    draft.people.map((person, index) => `\n## Agent: ${ids[index]}\n\n### Hidden Objective\nPrivate goal: ${prose(person.goal)} (resource: the_groups_attention)\nConstraint: Do not state your private goal outright; win the group over through your choices.\n`).join("") };
  return { personas, scenario };
}
