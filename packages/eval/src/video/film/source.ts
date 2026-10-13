import { basename, extname } from "node:path";
import { z } from "zod";
import type { DirectorReplay } from "@perfectman/shared";
import { parseVideoSourceText } from "../read-source.js";
import { readTextSource } from "../source-file.js";

const Pulse = z.object({
  pulseIndex: z.number().int(),
  committedEvents: z.array(z.object({ id: z.string(), channelId: z.string(), actorId: z.string(), type: z.string(), payload: z.record(z.unknown()) }).passthrough()),
  agentStates: z.record(z.object({ coreMood: z.object({ valence: z.number(), arousal: z.number(), energy: z.number() }).passthrough(), socialEmotions: z.record(z.unknown()) }).passthrough()),
}).passthrough();

const Replay = z.object({
  simulationName: z.string().optional(),
  agentIds: z.array(z.string().min(1)).min(1),
  agentNames: z.record(z.string()),
  agentArchetypes: z.record(z.string()),
  channels: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), memberAgentIds: z.array(z.string()) })),
  pulses: z.array(Pulse).min(1),
}).passthrough();

export type FilmSource = { replay: DirectorReplay; title: string; sha256: string };

/**
 * A stored replay: `replay.json` from a finished run, or a snapshot page that
 * carries one. Anything else is refused with the reason; the film needs every
 * pulse's recorded state, which only a replay has.
 */
export async function readFilmSource(input: string, maxPulses?: number): Promise<FilmSource> {
  const source = await readTextSource(input);
  const value = parseVideoSourceText(source.text);
  const parsed = Replay.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`The film needs a stored replay with every pulse's recorded state (${first?.path.join(".") || "root"}: ${first?.message}). Use replay.json from a finished run, not a transcript or an event list.`);
  }
  const raw = parsed.data as unknown as DirectorReplay & { simulationName?: string };
  const replay: DirectorReplay = maxPulses ? { ...raw, pulses: raw.pulses.slice(0, maxPulses) } : raw;
  return { replay, title: raw.simulationName ?? basename(input, extname(input)), sha256: source.sha256 };
}
