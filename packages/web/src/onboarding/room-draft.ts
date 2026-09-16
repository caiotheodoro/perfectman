import type { UploadedFile } from "@perfectman/shared";

export const ROLES = {
  connector: { label: "Peacemaker", calibration: "caio", voice: "Warm and quick; looks for common ground.", examples: ["Can we hear everyone out?", "I think we want the same thing.", "Let's take this one step at a time."] },
  skeptic: { label: "Straight talker", calibration: "mariana", voice: "Brief and direct; asks the question others avoid.", examples: ["What aren't we saying?", "That doesn't answer the question.", "I'd rather sort this out now."] },
  performer: { label: "Instigator", calibration: "goulart", voice: "Bold and playful; fills silence and challenges the room.", examples: ["Someone had to say it.", "Wait, hear me out.", "You're all being very quiet."] },
} as const;
export type CharacterDraft = { name: string; role: keyof typeof ROLES; goal: string };
export type RoomDraft = { title: string; situation: string; people: CharacterDraft[] };
export type RoomFiles = { personas: UploadedFile[]; scenario: UploadedFile };
export const INITIAL_ROOM: RoomDraft = {
  title: "The last free evening",
  situation: "Three friends have one evening together before one of them moves away. They need to agree on a plan, but each wants something different.",
  people: [
    { name: "Alex", role: "connector", goal: "Keep everyone together for one more evening." },
    { name: "Sam", role: "skeptic", goal: "Have an honest conversation before it is too late." },
    { name: "Robin", role: "performer", goal: "Make tonight memorable without admitting how much the move hurts." },
  ],
};
// Single-line prose keeps form input from accidentally becoming a Markdown section.
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
    return { filename: `${ids[index]}.persona.md`, text: header({ personaId: ids[index], displayName: name,
      archetype: person.role, language: "en", calibrationFrom: role.calibration, writingStyle: role.voice }) +
      `\n## Identity\nYou are ${name}. ${role.voice}\n\n## Voice\n- ${role.voice}\n\n## Style Examples\n${role.examples.map(line => `- ${line}`).join("\n")}\n\n## Private Motives\n- ${prose(person.goal)}\n` };
  });
  const scenario = { filename: "my-scene.scenario.md", text: header({ name: prose(draft.title), language: "en", seed: 42, maxPulses: 12,
    channels: [{ id: "room", name: "Common room", type: "public_channel", default: true, members: ids }],
    cast: draft.people.map((person, index) => ({ agentId: ids[index], persona: personas[index]!.filename, displayName: prose(person.name) })) }) +
    `\n## Room Context\n${prose(draft.situation)}\n\n## Starting Mood\nExpectant; each person is focused on their own goal.\n\n## Intro Behavior\nBegin in the middle of the situation. Do not introduce yourself.\n\n## First Move\nRespond to the situation in your own voice.\n` +
    draft.people.map((person, index) => `\n## Agent: ${ids[index]}\n\n### Hidden Objective\nPrivate goal: ${prose(person.goal)} (resource: the_groups_attention)\nConstraint: Do not state your private goal outright; win the group over through your choices.\n`).join("") };
  return { personas, scenario };
}
