import type { StoryDraft, UploadedFile } from "@perfectman/server/hotel";

/** The persona compiler rejects fewer style examples than this. */
const MIN_EXAMPLES = 3;
const ROLES = {
  connector: { calibration: "caio", voice: "Warm and quick; looks for common ground.", examples: ["Can we hear everyone out?", "I think we want the same thing.", "Let's take this one step at a time."] },
  skeptic: { calibration: "mariana", voice: "Brief and direct; asks the question others avoid.", examples: ["What aren't we saying?", "That doesn't answer the question.", "I'd rather sort this out now."] },
  performer: { calibration: "goulart", voice: "Bold and playful; fills silence and challenges the room.", examples: ["Someone had to say it.", "Wait, hear me out.", "You're all being very quiet."] },
} as const;

const prose = (text: string): string => text.replace(/\s+/g, " ").trim();
const header = (fields: Record<string, unknown>): string =>
  `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n`;

/**
 * A drafted story to the markdown the existing compiler reads. Same text as the
 * web beginner form (`roomFiles` in packages/web/src/setup/room-draft.ts),
 * which the server cannot import: the form adds no new run format.
 */
export function draftToFiles(draft: StoryDraft): UploadedFile[] {
  const ids = draft.people.map((_, i) => `person-${i + 1}`);
  const personas = draft.people.map((person, i) => {
    const role = ROLES[person.role];
    const name = prose(person.name);
    const voice = prose(person.voice ?? "") || role.voice;
    const written = (person.lines ?? []).map(prose).filter(Boolean);
    const lines = [...written, ...role.examples].slice(0, Math.max(MIN_EXAMPLES, written.length));
    return {
      filename: `${ids[i]}.persona.md`,
      text:
        header({ personaId: ids[i], displayName: name, archetype: person.role, language: draft.language, calibrationFrom: role.calibration, writingStyle: voice }) +
        `\n## Identity\nYou are ${name}. ${voice}\n\n## Voice\n- ${voice}\n\n## Style Examples\n${lines.map((l) => `- ${l}`).join("\n")}\n\n## Private Motives\n- ${prose(person.goal)}\n`,
    };
  });
  const scenario = {
    filename: "scene.scenario.md",
    text:
      header({
        name: prose(draft.title),
        language: draft.language,
        seed: 42,
        maxPulses: 12,
        channels: [{ id: "room", name: "Common room", type: "public_channel", default: true, members: ids }],
        cast: draft.people.map((p, i) => ({ agentId: ids[i], persona: personas[i]?.filename, displayName: prose(p.name) })),
      }) +
      `\n## Room Context\n${prose(draft.situation)}\n\n## Starting Mood\nExpectant; each person is focused on their own goal.\n\n## Intro Behavior\nBegin in the middle of the situation. Do not introduce yourself.\n\n## First Move\nRespond to the situation in your own voice.\n` +
      draft.people.map((p, i) => `\n## Agent: ${ids[i]}\n\n### Hidden Objective\nPrivate goal: ${prose(p.goal)} (resource: the_groups_attention)\nConstraint: Do not state your private goal outright; win the group over through your choices.\n`).join(""),
  };
  return [scenario, ...personas];
}
