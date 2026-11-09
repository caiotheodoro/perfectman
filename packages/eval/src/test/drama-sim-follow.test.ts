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

/** The live shape of the stall (issue #262, run 6): the actor's own model keeps sending it somewhere else every 6-10 s, over the follow's walks. */
const OWN_WALK = { actor: "beatriz", everyMs: [6000, 10_000] } as const;
const SUPPRESSED = "follow_suppressed_walk";
const walkingAwayAndSelf = async (over: Partial<SimConfig> = {}): Promise<SimConfig> => ({ ...(await walkingAway()), ownWalk: OWN_WALK, ...over });
const suppressed = (r: SimResult) => r.bodyBlocked.filter((b) => b.detail === SUPPRESSED);

describe("a climb whose actor's own model keeps walking it away too (tapa-na-cara, own walks every 6-10 s)", () => {
  it("[#262] still reaches shove and slap: while the follow window is open the actor's own walks are not sent", async () => {
    const r = runDramaSim(await walkingAwayAndSelf());
    const blows = started(r).filter((e) => e.origin === "director" && PHYSICAL.includes(e.verb));
    expect(blows.map((e) => e.verb)).toEqual(expect.arrayContaining(["shove", "slap"]));
  });

  it("drops only the actor's own walks, each one traced as a `follow_suppressed_walk` (busy_moving, move part)", async () => {
    const r = runDramaSim(await walkingAwayAndSelf());
    const dropped = suppressed(r);
    expect(dropped.length).toBeGreaterThan(0);
    expect(new Set(dropped.map((b) => b.actor))).toEqual(new Set(["beatriz"]));
    expect(dropped.every((b) => b.code === "busy_moving")).toBe(true);
    // The target's own walks are untouched, and so are the actor's acts (the glare and the insult still come first).
    expect(r.bodyBlocked.filter((b) => b.actor === "ricardo")).toEqual([]);
    expect(started(r).filter((e) => e.origin === "director").map((e) => e.verb).slice(0, 2)).toEqual(["glare", "insult"]);
  });

  it("without the follow window nothing is suppressed and the stall stays (the own walks win)", async () => {
    const o = DEFAULT_DRAMA_TUNING.origination;
    const r = runDramaSim(await walkingAwayAndSelf({ tuning: { ...DEFAULT_DRAMA_TUNING, origination: { ...o, climb: { ...o.climb, followWindowMs: 0 } } } }));
    expect(suppressed(r)).toEqual([]);
    expect(started(r).filter((e) => PHYSICAL.includes(e.verb))).toEqual([]);
  });

  it("keeps every gate with the suppression on: 20 s between blows, nothing above rung 4, no veto of the director's own, every probe passes", async () => {
    const r = runDramaSim(await walkingAwayAndSelf());
    const blows = started(r).filter((e) => PHYSICAL.includes(e.verb));
    for (let i = 1; i < blows.length; i++) expect(blows[i]!.atMs - blows[i - 1]!.atMs).toBeGreaterThanOrEqual(20_000);
    expect(started(r).filter((e) => ["punch", "kill"].includes(e.verb))).toHaveLength(0);
    expect(r.proposals.filter((p) => p.decision === "veto")).toEqual([]);
    expect({ failed: probeReport(r).failed }).toEqual({ failed: [] });
  });

  it("releases the own walks once the follow is over: a run with no target to follow is not suppressed at all", async () => {
    const { wander: _w, ...still } = await walkingAwayAndSelf();
    const r = runDramaSim(still);
    // Standing still, the first approach is enough: after the slap no follow is open, so the actor's own walks go through again.
    const lastBlow = Math.max(...started(r).filter((e) => PHYSICAL.includes(e.verb)).map((e) => e.atMs));
    expect(suppressed(r).filter((b) => b.atMs > lastBlow + 5000)).toEqual([]);
  });

  it("starts the next rung at the climb's gap, not at the model's next committed turn (the watch of a climb's actor)", async () => {
    const r = runDramaSim(await walkingAwayAndSelf());
    const climb = started(r).filter((e) => e.origin === "director");
    const glare = climb.find((e) => e.verb === "glare")!;
    const insult = climb.find((e) => e.verb === "insult")!;
    // Consults are 20 s apart, so without the watch the insult waits for the turn at ~41 s; with it, it comes 25 s (`climb.gapMs`) after the glare.
    expect(insult.atMs - glare.atMs).toBeGreaterThanOrEqual(DEFAULT_DRAMA_TUNING.origination.climb.gapMs);
    expect(insult.atMs - glare.atMs).toBeLessThan(DEFAULT_DRAMA_TUNING.origination.climb.gapMs + 5000);
  });

  it("the watch is off with the follow window (followWindowMs 0): the insult waits for the model's turn again", async () => {
    const o = DEFAULT_DRAMA_TUNING.origination;
    const r = runDramaSim(await walkingAwayAndSelf({ tuning: { ...DEFAULT_DRAMA_TUNING, origination: { ...o, climb: { ...o.climb, followWindowMs: 0 } } } }));
    const climb = started(r).filter((e) => e.origin === "director");
    expect(climb.find((e) => e.verb === "insult")!.atMs - climb.find((e) => e.verb === "glare")!.atMs).toBeGreaterThan(o.climb.gapMs + 5000);
  });
});
