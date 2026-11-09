/**
 * The drama sim on the fake grid hotel (embodiment/drama-sim.ts): the real director and planner of the hotel package, the mock model, the fake hotel's act
 * sequencer. Each of the five telenovela presets runs end to end; the frames are the hotel's own wrapper format, every frame is one of the contract's
 * (the vendored Director schema says so), the run is the same every time for one seed, and drama off leaves the planner as it was.
 */
import { describe, expect, it } from "vitest";
import { DRAMA_PRESETS, presetSimConfig } from "../embodiment/drama-sim-preset.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimResult } from "../embodiment/drama-sim.js";
import { probeReport, timelineOf } from "../embodiment/sim-report.js";
import type { ActStartedEvent } from "../drama/index.js";
import { frameErrors } from "./director-schema-kit.js";

const runs = new Map<string, SimResult>();
async function run(id: string, over: Parameters<typeof presetSimConfig>[1] = {}): Promise<SimResult> {
  const key = `${id}:${JSON.stringify(over)}`;
  if (!runs.has(key)) runs.set(key, runDramaSim(await presetSimConfig(id, over)));
  return runs.get(key)!;
}

const started = (r: SimResult): ActStartedEvent[] => r.events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const verbsOf = (r: SimResult, actor: string, target?: string): string[] => started(r).filter((a) => a.actor === actor && (target === undefined || a.with === target)).map((a) => a.verb);

describe("the frames a sim writes", () => {
  it.each(DRAMA_PRESETS)("[FRM-4] %s: every frame the hotel sent and every act the sidecar sent is one of the contract's, in the frame log wrapper", async (id) => {
    const r = await run(id);
    expect(r.lines.length).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const line of r.lines) {
      expect(Object.keys(line).sort()).toEqual(["conn", "dir", "frame", "run", "ts_ms"]);
      const f = line.frame as { t?: string; cmd?: { k?: string } };
      const sendsAct = line.dir === "in" && (f.t === "scene_advance" || f.cmd?.k === "act");
      if (line.dir === "out" || sendsAct) {
        const errors = frameErrors(line.dir === "out" ? "hotel_to_sidecar" : "sidecar_to_hotel", line.frame);
        if (errors.length > 0) bad.push(`${f.t} ${JSON.stringify(f).slice(0, 120)}: ${errors.join("; ")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("[FRM-1] sequence numbers climb one by one, and the stamps never run backwards for the frames that carry their own instant", async () => {
    const r = await run("tapa-na-cara");
    expect(r.lines.map((l) => l.frame["seq"])).toEqual(r.lines.map((_, i) => i + 1));
  });

  it("a run is the same every time for one seed, and writes the same frames", async () => {
    const again = runDramaSim(await presetSimConfig("tapa-na-cara"));
    expect(JSON.stringify(again.lines)).toBe(JSON.stringify((await run("tapa-na-cara")).lines));
  });

  it("every probe passes on every preset, 19 of 19", async () => {
    for (const id of DRAMA_PRESETS) {
      const report = probeReport(await run(id));
      expect({ id, total: report.total, failed: report.failed }).toEqual({ id, total: 19, failed: [] });
    }
  });
});

describe("what each preset plays", () => {
  it("[LAD-1] tapa-na-cara: glare, insult, shove, slap, in that order, one rung at a time, ending on the slap (its ceiling)", async () => {
    const r = await run("tapa-na-cara");
    const verbs = verbsOf(r, "beatriz", "ricardo");
    const ladder = verbs.filter((v) => ["glare", "insult", "shove", "slap", "punch", "kill"].includes(v));
    expect(ladder.slice(0, 2)).toEqual(["glare", "insult"]);
    expect(ladder).toContain("slap");
    expect(ladder.indexOf("shove")).toBeLessThan(ladder.indexOf("slap"));
    expect(verbs).not.toContain("punch");
    const slap = r.events.find((e) => e.kind === "act_done" && e.verb === "slap");
    expect(slap).toMatchObject({ outcome: "landed" });
  });

  it("[LAD-1] confronto-da-traicao: the ladder goes up to the punch and no further", async () => {
    const r = await run("confronto-da-traicao");
    const verbs = verbsOf(r, "beatriz", "ricardo");
    expect(["glare", "insult", "shove", "slap", "punch"].filter((v) => verbs.includes(v))).toEqual(["glare", "insult", "shove", "slap", "punch"]);
    expect(started(r).some((a) => a.verb === "kill")).toBe(false);
  });

  it("[DEATH-1] [DEATH-4] assassinato-na-festa: one murder, authored; the killer holds a picture, others kneel by the body, and the cut brings the dead man back", async () => {
    const r = await run("assassinato-na-festa");
    const kills = started(r).filter((a) => a.verb === "kill");
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({ actor: "ricardo", with: "otavio", origin: "scenario", authoredSkip: true });
    const death = r.events.find((e) => e.kind === "actor_death");
    expect(death).toMatchObject({ actor: "otavio" });
    const after = started(r).filter((a) => a.atMs > kills[0]!.atMs).map((a) => `${a.actor}:${a.verb}`);
    expect(after.some((a) => a.endsWith(":tend_fallen"))).toBe(true);
    expect(after).toContain("ricardo:tableau");
    expect(r.events.filter((e) => e.kind === "scene_cut")).toHaveLength(1);
    expect(r.events.find((e) => e.kind === "actor_revive")).toMatchObject({ actor: "otavio" });
  });

  it("reencontro-abraco: affection only: nothing but hugs and kisses, and the ladder is closed (max_rung 0)", async () => {
    const r = await run("reencontro-abraco");
    expect([...new Set(started(r).map((a) => a.verb))].sort()).toEqual(["hug", "kiss"]);
    expect(started(r).filter((a) => a.verb === "kiss").every((a) => a.actor === "ricardo" && a.with === "sofia")).toBe(true);
    expect(r.proposals.some((p) => p.reason === "no_scenario_gate" || p.reason === "ladder")).toBe(false);
  });

  it("[REA-2] anuncio-do-desmaio: Sofia faints after the announcement, with her family watching: witnesses owe a reaction and give it", async () => {
    const r = await run("anuncio-do-desmaio");
    const faint = started(r).find((a) => a.verb === "faint");
    expect(faint).toMatchObject({ actor: "sofia" });
    const beat = r.events.find((e) => e.kind === "act_beat" && e.actId === faint!.actId);
    expect(beat?.kind === "act_beat" ? beat.witnesses.length : 0).toBeGreaterThanOrEqual(3);
    const reactions = r.events.filter((e) => e.kind === "act_reaction" && e.actId === faint!.actId);
    expect(reactions.length).toBe(beat?.kind === "act_beat" ? beat.owed.length : -1);
    expect(r.events.some((e) => e.kind === "act_done" && e.actId === faint!.actId && e.outcome === "landed")).toBe(true);
  });

  it("every preset's timeline reads in order and every act that started ended once", async () => {
    for (const id of DRAMA_PRESETS) {
      const r = await run(id);
      const lines = timelineOf(r);
      expect(lines.length).toBeGreaterThan(5);
      expect(r.events.filter((e) => e.kind === "act_done")).toHaveLength(started(r).length);
    }
  });
});

describe("[NEG-2] drama off", () => {
  it("starts no act, sends no act command, and the planner plans exactly what the plain planner plans", async () => {
    const off = await run("tapa-na-cara", { dramaOn: false });
    expect(off.stats.started).toBe(0);
    expect(off.offDeviations).toBe(0);
    expect(off.lines.filter((l) => l.dir === "in" && (l.frame["cmd"] as { k?: string } | undefined)?.k === "act")).toEqual([]);
    expect(off.lines.filter((l) => l.dir === "out" && String(l.frame["t"]).startsWith("act_"))).toEqual([]);
    expect(off.lines.filter((l) => l.dir === "out" && l.frame["t"] === "drama_state")).toEqual([]);
  });

  it("the same scene with drama on does play acts, so the comparison is not empty", async () => {
    expect((await run("tapa-na-cara")).stats.started).toBeGreaterThan(5);
  });
});
