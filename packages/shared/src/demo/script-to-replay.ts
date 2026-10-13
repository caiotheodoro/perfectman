/**
 * A hand-written screenplay becomes a replay the director can film.
 *
 * Nothing here calls a model. A beat says who speaks, to whom, what they say
 * out loud and what they really think; a `feel` says how somebody in the room
 * is doing, and it holds until another beat changes it, the way a mood does.
 * The result has the same shape as a stored run, so the landing page and the
 * exported video are drawn by the same director that draws a real run.
 */
import type { SceneLook } from "../stage/scene-look.js";
import type { DirectorChannel, DirectorPulse, DirectorReplay, DirectorProfile } from "../director/types.js";

export type Feel = "calm" | "panic" | "smug" | "suspicious" | "warm" | "mortified" | "furious" | "tired";

const FEELS: Record<Feel, { valence: number; arousal: number; energy: number; social: Record<string, number> }> = {
  calm: { valence: 0.15, arousal: 0.3, energy: 1, social: {} },
  panic: { valence: -0.25, arousal: 0.9, energy: 1, social: { socialAnxiety: 0.8, fearOfExclusion: 0.5 } },
  smug: { valence: 0.45, arousal: 0.55, energy: 1, social: { pride: 0.8, desireForStatus: 0.5 } },
  suspicious: { valence: -0.1, arousal: 0.55, energy: 1, social: { suspicion: 0.85 } },
  warm: { valence: 0.6, arousal: 0.5, energy: 1, social: { affection: 0.85 } },
  mortified: { valence: -0.4, arousal: 0.7, energy: 1, social: { humiliation: 0.85, shame: 0.5 } },
  furious: { valence: -0.5, arousal: 0.85, energy: 1, social: { resentment: 0.8, contempt: 0.4 } },
  tired: { valence: -0.1, arousal: 0.15, energy: 0.25, social: {} },
};

export type ScriptBeat = {
  /** Who is speaking. */
  who: string;
  /** What they say out loud. */
  say: string;
  /** What they are really thinking; only an omniscient viewer sees it. */
  think?: string;
  /** Who it is aimed at. Defaults to everyone else in the channel. */
  to?: string[];
  /** The channel; defaults to the main room. */
  in?: string;
  /** How people are doing from this beat on. Anyone not named keeps their last feel. */
  feel?: Partial<Record<string, Feel>>;
};

export type Script = {
  title: string;
  /** The people, in the order they are drawn. */
  cast: Array<{ id: string; name: string; archetype: string; writingStyle?: string; feel?: Feel }>;
  channels: DirectorChannel[];
  look?: SceneLook;
  /** Story clock "HH:MM" at the first beat, and minutes per beat. */
  start: string;
  step: number;
  beats: ScriptBeat[];
};

export function scriptToReplay(script: Script): DirectorReplay & { simulationName: string } {
  const ids = script.cast.map((p) => p.id);
  const channelOf = (id: string): DirectorChannel => {
    const c = script.channels.find((x) => x.id === id);
    if (!c) throw new Error(`Script beat names an unknown channel "${id}"`);
    return c;
  };
  const main = script.channels[0];
  if (!main) throw new Error("A script needs at least one channel");

  const feels: Record<string, Feel> = Object.fromEntries(script.cast.map((p) => [p.id, p.feel ?? "calm"]));
  const pulses: DirectorPulse[] = [];

  script.beats.forEach((beat, index) => {
    if (!ids.includes(beat.who)) throw new Error(`Beat ${index} is spoken by "${beat.who}", who is not in the cast`);
    const channel = channelOf(beat.in ?? main.id);
    if (!channel.memberAgentIds.includes(beat.who)) throw new Error(`Beat ${index}: ${beat.who} is not in #${channel.name}`);
    for (const [id, feel] of Object.entries(beat.feel ?? {})) {
      if (!ids.includes(id)) throw new Error(`Beat ${index} feels for "${id}", who is not in the cast`);
      if (feel) feels[id] = feel;
    }

    const to = beat.to ?? channel.memberAgentIds.filter((id) => id !== beat.who);
    pulses.push({
      pulseIndex: index,
      committedEvents: [{
        id: `demo_${index}`,
        channelId: channel.id,
        actorId: beat.who,
        type: index > 0 ? "reply_sent" : "message_sent",
        payload: { content: beat.say, addresseeIds: to },
      }],
      agentStates: Object.fromEntries(ids.map((id) => {
        const f = FEELS[feels[id]!];
        return [id, { coreMood: { valence: f.valence, arousal: f.arousal, energy: f.energy }, socialEmotions: f.social }];
      })),
      ...(beat.think ? {
        agentThinking: { [beat.who]: { privateMotiveSummary: beat.think, emotionDrivers: [feels[beat.who]!], intentType: "reply_to_message" } },
      } : {}),
    });
  });

  const agentProfiles: Record<string, DirectorProfile> = Object.fromEntries(script.cast.map((p) => [p.id, {
    displayName: p.name, archetype: p.archetype, language: "en", messageLength: "short" as const,
    ...(p.writingStyle ? { writingStyle: p.writingStyle } : {}),
  }]));
  const [h, m] = script.start.split(":").map(Number) as [number, number];
  return {
    simulationName: script.title,
    agentIds: ids,
    agentNames: Object.fromEntries(script.cast.map((p) => [p.id, p.name])),
    agentArchetypes: Object.fromEntries(script.cast.map((p) => [p.id, p.archetype])),
    agentProfiles,
    channels: script.channels,
    pulses,
    storyClock: { start: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, minutesPerPulse: script.step },
    ...(script.look ? { look: script.look } : {}),
  };
}
