import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DRAMA_TUNING } from "@perfectman/hotel/drama";
import type { DramaTuning } from "@perfectman/hotel/drama";
import type { SimConfig } from "../embodiment/drama-sim.js";
import { seedState } from "../embodiment/sim-states.js";
import { RUN63_PROPS, TERRACO } from "./terraco.js";

/**
 * Run 63 (Sobremesa, Terraço) on the offline sim, for the human-likeness preview: its cast of three, its 54 lines at their seconds (`hotel/fixtures/run63/lines.json`),
 * a model that proposes nothing (the director starts nothing, as in the run), on the Terraço's own layout with the two who sat at the round table seated there. The same
 * seed, cast, script and room for every arm; only `human_likeness` changes. Authored flags (a beat sheet's note would carry them): which lines are lies, which reveal.
 */
const here = dirname(fileURLToPath(import.meta.url));
type Line = { t_s: number; speaker: string; text: string };
const LINES = JSON.parse(readFileSync(join(here, "../../../hotel/fixtures/run63/lines.json"), "utf8")) as Line[];
const REF: Record<string, string> = { Heloísa: "heloisa", Otávio: "otavio", Renato: "renato" };
const REFS = ["heloisa", "otavio", "renato"];
const fold = (t: string): string => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Heloísa's deflections and Renato's pen story: lies, in the story. */
const LIES = new Set([14, 16, 19, 20, 24, 28, 33]);
/** The accusation, the tremor called out, the pen in the drawer, "I saw", the price on silence. */
const REVEALS = new Set([0, 18, 22, 36, 38]);

export const RUN63_DURATION_MS = 450_000;

export function run63Config(likeness: number, o: { seed?: number; durationMs?: number; film?: boolean } = {}): SimConfig {
  const states = new Map(REFS.map((r) => [r, seedState(r, { others: REFS, relations: Object.fromEntries(REFS.filter((x) => x !== r).map((x) => [x, { resentment: 0.16 }])) })]));
  const pairs: Array<[string, string]> = REFS.flatMap((a) => REFS.filter((b) => b !== a).map((b): [string, string] => [a, b]));
  const tuning: DramaTuning = { ...DEFAULT_DRAMA_TUNING, origination: { ...DEFAULT_DRAMA_TUNING.origination, askAfterRefusal: false }, contagion: { ...DEFAULT_DRAMA_TUNING.contagion, ageMs: 0 } };
  const seed = o.seed ?? 63;
  return {
    title: "run63",
    seed,
    durationMs: o.durationMs ?? RUN63_DURATION_MS,
    consultMs: 12_000,
    layout: TERRACO,
    actors: [
      { ref: "heloisa", name: "Heloísa", tile: [7, 4] },
      { ref: "otavio", name: "Otávio", tile: [6, 5] },
      { ref: "renato", name: "Renato", tile: [2, 8] },
    ],
    seated: { heloisa: 16, otavio: 15 },
    states,
    drama: { max_rung: 4, may_target: pairs, may_die: [], permadeath: false },
    tuning,
    // The cast speaks the run's own script and nothing else: the sim's mock would add a line to every glare.
    model: () => undefined,
    dialogue: LINES.map((l, i) => {
      const speaker = REF[l.speaker]!;
      const named = Object.keys(REF).find((n) => REF[n] !== speaker && fold(l.text).includes(fold(n)));
      const to = named ? REF[named]! : speaker === "heloisa" ? "renato" : "heloisa";
      return { atMs: l.t_s * 1000, actor: speaker, text: l.text, to, ...(LIES.has(i) ? { lie: true } : {}), ...(REVEALS.has(i) ? { reveal: true } : {}) };
    }),
    humanLike: { likeness, seed, film: o.film ?? true, props: RUN63_PROPS, appraise: true },
    trace: true,
  };
}
