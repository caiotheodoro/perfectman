/**
 * Run 63 (Sobremesa in the Terraço, deepseek) replayed on the offline sim, live-shaped: its 54 spoken lines at their seconds (`hotel/fixtures/run63/lines.json`), cold feelings
 * (a resentment of 0.16 toward each other, no tendency the ladder reads), a model that proposes a glare at someone on every consult, a scene of three that allows up to the slap.
 * The run was 7:22 long and held one act: 13 glares refused on the motive, 12 originations that found nothing (volition 0.36 against a theta of 0.52), provocation above 0 in
 * 2 of 29 log rows, the director never asked while the model proposed. Four arms, the first being the run as it was (the old word list read one of its lines; the sim's
 * `read: false` is the ledger not seeing the others) and the rest what this change adds, one at a time.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_DRAMA_TUNING } from "@perfectman/hotel/drama";
import type { DramaTuning } from "@perfectman/hotel/drama";
import type { ActStartedEvent } from "../drama/index.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimConfig } from "../embodiment/drama-sim.js";
import { seedState } from "../embodiment/sim-states.js";

const here = dirname(fileURLToPath(import.meta.url));
type Line = { t_s: number; speaker: string; text: string };
const LINES = JSON.parse(readFileSync(join(here, "../../../hotel/fixtures/run63/lines.json"), "utf8")) as Line[];
const REF: Record<string, string> = { Heloísa: "heloisa", Otávio: "otavio", Renato: "renato" };
const REFS = ["heloisa", "otavio", "renato"];
const fold = (t: string): string => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The one line the old word list read as hostile in the whole run. */
const OLD_READ = "senão eu conto tudo";

type Arm = { oldLexicon?: boolean; assist: boolean; ageMs: number; pressure: boolean; talk?: boolean; resentment?: number };

function config(arm: Arm): SimConfig {
  const resentment = arm.resentment ?? 0.16;
  const states = new Map(REFS.map((r) => [r, seedState(r, { others: REFS, relations: Object.fromEntries(REFS.filter((x) => x !== r).map((x) => [x, { resentment }])) })]));
  const pairs: Array<[string, string]> = REFS.flatMap((a) => REFS.filter((b) => b !== a).map((b): [string, string] => [a, b]));
  const tuning: DramaTuning = { ...DEFAULT_DRAMA_TUNING, origination: { ...DEFAULT_DRAMA_TUNING.origination, askAfterRefusal: arm.assist }, contagion: { ...DEFAULT_DRAMA_TUNING.contagion, ageMs: arm.ageMs } };
  return {
    title: "run63",
    seed: 1,
    durationMs: 300_000,
    consultMs: 12_000,
    actors: [{ ref: "heloisa", name: "Heloísa" }, { ref: "otavio", name: "Otávio" }, { ref: "renato", name: "Renato" }],
    states,
    drama: { max_rung: 4, may_target: pairs, may_die: [], permadeath: false },
    tuning,
    ...(arm.pressure ? { pressure: { climax_at_ms: 240_000 } } : {}),
    model: ({ ref, handleOf }) => ({ act: { verb: "glare", target: handleOf(ref === "heloisa" ? "renato" : "heloisa") } }),
    dialogue:
      arm.talk === false
        ? []
        : LINES.map((l) => {
            const speaker = REF[l.speaker]!;
            const named = Object.keys(REF).find((n) => REF[n] !== speaker && fold(l.text).includes(fold(n)));
            const to = named ? REF[named]! : speaker === "heloisa" ? "renato" : "heloisa";
            return { atMs: l.t_s * 1000, actor: speaker, text: l.text, to, ...(arm.oldLexicon && !l.text.includes(OLD_READ) ? { read: false } : {}) };
          }),
  };
}

const started = (r: ReturnType<typeof runDramaSim>): ActStartedEvent[] => r.events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const byDirector = (r: ReturnType<typeof runDramaSim>): ActStartedEvent[] => started(r).filter((a) => a.origin === "director");
const rungAt = (r: ReturnType<typeof runDramaSim>, verb: string): number | undefined => started(r).find((a) => a.verb === verb)?.atMs;

describe("run 63 on the sim: what the director does with a model that only glares", () => {
  const old = runDramaSim(config({ oldLexicon: true, assist: false, ageMs: 0, pressure: false }));
  const lexicon = runDramaSim(config({ assist: false, ageMs: 0, pressure: false }));
  const assisted = runDramaSim(config({ assist: true, ageMs: 90_000, pressure: false }));
  const floor = runDramaSim(config({ assist: true, ageMs: 90_000, pressure: true }));

  it.skipIf(!process.env["PRINT"])("prints the arms", () => {
    for (const [name, r] of [["old", old], ["lexicon", lexicon], ["assisted", assisted], ["floor", floor]] as const) {
      const orig = r.dramaLog.filter((l) => l.kind === "originate");
      const tally = orig.reduce<Record<string, number>>((m, l) => ((m[l.result] = (m[l.result] ?? 0) + 1), m), {});
      console.log(name, "acts", started(r).length, "director", byDirector(r).length, "first", started(r)[0]?.atMs, "originate", JSON.stringify(tally), "prov>0", r.dramaLog.filter((l) => (l.provocation ?? 0) > 0).length, "/", r.dramaLog.length, "|", started(r).map((a) => `${Math.round(a.atMs / 1000)}s ${a.actor}>${a.with} ${a.verb}/${a.origin}`).join("; "));
    }
  });

  it("the run as it was: the model's glares are refused, the director starts nothing, the cast's talk raises one grievance", () => {
    expect(byDirector(old)).toHaveLength(0);
    expect(started(old).filter((a) => a.verb !== "glare")).toEqual([]);
    expect(old.counters["grievance_raised"]).toBe(1);
    expect(old.dramaLog.filter((l) => (l.provocation ?? 0) > 0)).toHaveLength(0);
  });

  it("the word list alone raises the grievance (11 hostile lines counted, not 1) and gives the model's glare a motive, but the director is still not asked", () => {
    expect(lexicon.counters["grievance_raised"]).toBeGreaterThanOrEqual(10);
    expect(lexicon.dramaLog.filter((l) => (l.provocation ?? 0) > 0).length).toBeGreaterThanOrEqual(5);
    expect(byDirector(lexicon)).toHaveLength(0);
  });

  it("asking the director after a refusal and on a heat watch: it answers the opening accusation within 30 s and climbs on its own to a shove", () => {
    const own = byDirector(assisted);
    expect(own.length).toBeGreaterThanOrEqual(4);
    expect(own[0]!.atMs).toBeLessThanOrEqual(30_000);
    expect(started(assisted).some((a) => a.verb === "insult")).toBe(true);
    expect(rungAt(assisted, "shove")).toBeDefined();
  });

  it("the pressure floor of a scene with a climax at 240 s: a shove by 200 s and the slap by 250 s, with the contract's spacing and no skipped rung", () => {
    expect(rungAt(floor, "shove")).toBeLessThanOrEqual(200_000);
    expect(rungAt(floor, "slap")).toBeLessThanOrEqual(250_000);
    const physical = started(floor).filter((a) => ["shove", "slap", "punch", "kill"].includes(a.verb)).map((a) => a.atMs);
    for (let i = 1; i < physical.length; i++) expect(physical[i]! - physical[i - 1]!).toBeGreaterThanOrEqual(20_000);
    expect(floor.probes.filter((p) => !p.passed).map((p) => p.probe)).toEqual([]);
    // The ladder never went above the scene's ceiling.
    expect(started(floor).some((a) => a.verb === "punch" || a.verb === "kill")).toBe(false);
    // Fewer originations that found nothing (the run had 12 of 12).
    const origin = floor.dramaLog.filter((l) => l.kind === "originate");
    expect(origin.filter((l) => l.result === "act").length).toBeGreaterThanOrEqual(3);
  });

  it("free play is safe: the same cold cast with no heat gets no floor to climb (no talk, no resentment) and starts nothing, floor or no floor", () => {
    for (const pressure of [false, true]) {
      const cold = runDramaSim(config({ assist: true, ageMs: 90_000, pressure, talk: false, resentment: 0 }));
      expect(byDirector(cold), `pressure ${pressure}`).toHaveLength(0);
      expect(started(cold).filter((a) => a.verb !== "glare")).toEqual([]);
    }
  });

  it("without a climax deadline the director is as before for a cast that is not heated: nothing above a glare", () => {
    const calm = runDramaSim(config({ assist: true, ageMs: 90_000, pressure: false, talk: false }));
    expect(started(calm).filter((a) => a.verb !== "glare" && a.origin === "director")).toEqual([]);
  });
});
