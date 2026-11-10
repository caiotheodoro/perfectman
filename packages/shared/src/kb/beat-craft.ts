import type { ActVerb } from "../space/act-verbs.js";
import { BEAT_CRAFT_MAX_CHARS, renderStyleReference } from "./slim-render.js";
import { selectSlimBeats } from "./slim-select.js";
import type { SlimAction, SlimKb } from "./slim.js";

/**
 * The runtime feed of the KB: for each authored beat that has a tactic, up to two very short style lines from the slim file, worked out
 * once when the run starts and shown to that beat's actor only while the beat is near. Nothing is retrieved per pulse, nothing is written
 * anywhere (not into the body, not into a frame log): the text lives in this object, in memory, for the run.
 *
 * An authored beat has no tactic field of its own; its verb is the proxy. `CRAFT_FOR_VERB` says which tactic and which physical action each
 * verb stands for; a verb with no entry (a reaction, a tableau) gets no lines.
 */

/** How far ahead of its second a beat's lines start to show: the talk that builds to the act. */
export const BEAT_CRAFT_LEAD_MS = 20_000;
/** How long after its second they stay, so the aftermath is still shaped by them. */
export const BEAT_CRAFT_HOLD_MS = 10_000;
/** Style lines per beat. */
export const BEAT_CRAFT_PER_BEAT = 2;

export const CRAFT_FOR_VERB: Readonly<Partial<Record<ActVerb, { action: SlimAction; tactic: string }>>> = {
  glare: { action: "DIALOGUE_ONLY", tactic: "to intimidate" },
  insult: { action: "DIALOGUE_ONLY", tactic: "to humiliate" },
  shove: { action: "VIOLENT_PUSH", tactic: "to dominate" },
  slap: { action: "VIOLENT_STRIKE", tactic: "to rebuke" },
  punch: { action: "VIOLENT_STRIKE", tactic: "to strike" },
  kill: { action: "KILLING", tactic: "to kill" },
  hug: { action: "HUGGING", tactic: "to comfort" },
  kiss: { action: "KISSING", tactic: "to seduce" },
  cry: { action: "CRYING", tactic: "to break down" },
  storm_off: { action: "PHYSICAL_RETREAT", tactic: "to withdraw" },
  turn_back: { action: "PHYSICAL_RETREAT", tactic: "to snub" },
  faint: { action: "FAINTING", tactic: "to yield" },
};

/** The part of a scenario beat this needs. The hotel's `ScenarioBeat` has it. */
export type CraftBeat = { id: string; at_ms: number; kind: string; actor?: string; verb?: string };

type Entry = { actor: string; atMs: number; text: string };

export class BeatCraft {
  private constructor(private readonly entries: readonly Entry[]) {}

  /**
   * Works out the lines for every act beat that has a tactic. `language` is the run's language (the lines prefer it, and the header is in it);
   * `cast` is how many people the run has. Lines already given to another beat of the run are not given twice. Undefined when no beat got any.
   */
  static build(beats: readonly CraftBeat[], kb: SlimKb, opts: { language: "en" | "pt-BR"; cast: number }): BeatCraft | undefined {
    const entries: Entry[] = [];
    const used = new Set<string>();
    const ordered = [...beats].sort((a, b) => a.at_ms - b.at_ms || (a.id < b.id ? -1 : 1));
    for (const beat of ordered) {
      if (beat.kind !== "act" || beat.actor === undefined || beat.verb === undefined) continue;
      const craft = CRAFT_FOR_VERB[beat.verb as ActVerb];
      if (!craft) continue;
      const picks = selectSlimBeats(kb, { action: craft.action, tactic: craft.tactic, cast: opts.cast, language: opts.language, limit: BEAT_CRAFT_PER_BEAT, maxPerWork: 1, exclude: used, needQuip: true });
      const shown = renderStyleReference(picks, opts.language, BEAT_CRAFT_MAX_CHARS);
      if (shown === undefined) continue;
      // The renderer may have dropped a pick that did not fit: only the ones that were shown are spent.
      for (const pick of shown.used) used.add(pick.beat.id);
      entries.push({ actor: beat.actor, atMs: beat.at_ms, text: shown.text });
    }
    return entries.length === 0 ? undefined : new BeatCraft(entries);
  }

  /** The lines for this actor at this many milliseconds into the run, or undefined. The earliest beat that is near wins. */
  textFor(actor: string, runMs: number): string | undefined {
    for (const entry of this.entries) {
      if (entry.actor === actor && runMs >= entry.atMs - BEAT_CRAFT_LEAD_MS && runMs <= entry.atMs + BEAT_CRAFT_HOLD_MS) return entry.text;
    }
    return undefined;
  }

  /** How many beats have lines (for logs and tests). */
  get size(): number {
    return this.entries.length;
  }
}
