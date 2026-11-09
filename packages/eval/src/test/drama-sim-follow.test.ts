/**
 * Issue #262, the live shape: a real model consults an actor every ~20 s (not the sim's 8 s) and the person it is after keeps walking away. The director's
 * approach fires once per consult and the target has left by the time the actor arrives, so the ladder used to stall after the insult. The body now follows
 * the target for a bounded window (`climb.followWindowMs`) once the director has said the only thing missing is the distance.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DRAMA_TUNING } from "@perfectman/hotel/drama";
import type { ActStartedEvent } from "../drama/index.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimConfig, SimResult } from "../embodiment/drama-sim.js";
import { presetSimConfig } from "../embodiment/drama-sim-preset.js";
import { probeReport } from "../embodiment/sim-report.js";

const started = (r: SimResult): ActStartedEvent[] => r.events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const PHYSICAL = ["shove", "slap", "punch"];

/** tapa-na-cara, a model that only talks and consults every 20 s, and Ricardo (the target of Beatriz's climb) walking to a far corner every 5 s. */
async function walkingAway(over: Partial<SimConfig> = {}): Promise<SimConfig> {
  const c = await presetSimConfig("tapa-na-cara");
  return { ...c, speechOnly: true, consultMs: 20_000, durationMs: 240_000, wander: { actor: "ricardo", everyMs: 5000, tiles: [[10, 1], [1, 6], [10, 5], [2, 1]] }, ...over };
}

describe("a climb whose target keeps walking away (tapa-na-cara, speech-only model, slow consults)", () => {
  it("[#262] reaches shove and slap inside four minutes: the body follows the target until the blow", async () => {
    const r = runDramaSim(await walkingAway());
    const climb = started(r).filter((e) => e.origin === "director");
    expect(climb.map((e) => e.verb).slice(0, 2), "the ladder starts on its own").toEqual(["glare", "insult"]);
    const blows = climb.filter((e) => PHYSICAL.includes(e.verb));
    expect(blows.map((e) => e.verb)).toEqual(expect.arrayContaining(["shove", "slap"]));
    expect(new Set(blows.map((e) => e.actor)).size).toBe(1);
  });

  it("keeps every gate: 20 s between blows, nothing above rung 4, no veto of the director's own, every probe passes", async () => {
    const r = runDramaSim(await walkingAway());
    const blows = started(r).filter((e) => PHYSICAL.includes(e.verb));
    for (let i = 1; i < blows.length; i++) expect(blows[i]!.atMs - blows[i - 1]!.atMs).toBeGreaterThanOrEqual(20_000);
    expect(started(r).filter((e) => ["punch", "kill"].includes(e.verb))).toHaveLength(0);
    expect(r.proposals.filter((p) => p.decision === "veto")).toEqual([]);
    expect({ failed: probeReport(r).failed }).toEqual({ failed: [] });
  });

  it("without the follow window (followWindowMs 0, the code before the fix) the ladder stalls after the insult, which is what the live run showed", async () => {
    const o = DEFAULT_DRAMA_TUNING.origination;
    const r = runDramaSim(await walkingAway({ tuning: { ...DEFAULT_DRAMA_TUNING, origination: { ...o, climb: { ...o.climb, followWindowMs: 0 } } } }));
    expect(started(r).filter((e) => PHYSICAL.includes(e.verb))).toEqual([]);
    expect(started(r).some((e) => e.verb === "insult")).toBe(true);
  });

  it("a target that stands still is reached as before: the follow changes nothing when the first walk is enough", async () => {
    const { wander: _w, ...still } = await walkingAway();
    const r = runDramaSim(still);
    expect(started(r).filter((e) => e.origin === "director").map((e) => e.verb).slice(0, 4)).toEqual(["glare", "insult", "shove", "slap"]);
  });
});
