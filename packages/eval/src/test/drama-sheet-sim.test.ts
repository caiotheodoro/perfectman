/**
 * A scene played from its beat sheet on the offline drama stack (Contract A): for every drama preset and a sweep of seeds, the physical climax is started by 4:00
 * through the real director and its gates (LAD-1 one rung per beat unless authored_skip, GATE-5 the scene's max_rung and may_die, GATE-9 the 20 s between physical beats,
 * one kill a scene), with the improvised arc running underneath it, and the sheet's quiet beats reach the stage.
 */
import { describe, expect, it } from "vitest";
import { runDramaSim } from "../embodiment/drama-sim.js";
import { DRAMA_PRESETS, sheetSimConfig } from "../embodiment/drama-sim-preset.js";
import { probeReport } from "../embodiment/sim-report.js";
import { sheetProbes } from "../probes/sheet.js";
import type { ActStartedEvent } from "../drama/index.js";
import { benchBriefs } from "../bench/sheet-briefs.js";
import { DEFAULT_DRAMA_TUNING, generateBeatSheet } from "@perfectman/hotel/drama";

const started = (r: ReturnType<typeof runDramaSim>): ActStartedEvent[] => r.events.filter((e): e is ActStartedEvent => e.kind === "act_started");

describe("a preset played from its beat sheet", () => {
  for (const id of DRAMA_PRESETS) {
    it(`[${id}] the climax comes by 240 s on seeds 1 to 6, and every sheet probe holds`, async () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const config = await sheetSimConfig(id, { seed });
        const r = runDramaSim(config);
        const sheet = config.sheet!;
        const bad = sheetProbes(r, sheet).filter((p) => !p.passed);
        expect(bad.map((p) => `${seed}: ${p.probe}=${p.measured}`)).toEqual([]);
        // The sheet's slap, or the improvised arc's own just ahead of it once the window is open (the summary calls that `organic`).
        const climax = started(r).find((a) => a.verb === "slap" && a.atMs >= sheet.arc.climax_at_ms - 20_000);
        expect(["played", "organic"], `seed ${seed}`).toContain(r.sheet!.summary.climax.outcome);
        expect(climax?.atMs, `seed ${seed}`).toBeLessThanOrEqual(240_000);
        // the gates held: the physical beats are 20 s apart and nothing died but by the sheet's word
        const physical = started(r).filter((a) => ["shove", "slap", "punch", "kill"].includes(a.verb)).map((a) => a.atMs);
        expect(physical.every((t, i) => i === 0 || t - physical[i - 1]! >= 20_000), `${seed}: ${physical.join(",")}`).toBe(true);
        expect(started(r).filter((a) => a.verb === "kill").length).toBeLessThanOrEqual(1);
        expect(r.probes.find((p) => p.probe === "ladder-compliance")?.passed, `${id} ${seed} ladder`).toBe(true);
      }
    });
  }

  it("[LAD-11] the improvised arc throws no shove, slap or punch before the climax window, on every preset: the sheet's reversal and climax stay its own", async () => {
    for (const id of DRAMA_PRESETS) {
      const config = await sheetSimConfig(id, { seed: 2 });
      const r = runDramaSim(config);
      const window = config.sheet!.arc.climax_at_ms - DEFAULT_DRAMA_TUNING.sheetHold.beforeClimaxMs;
      const early = started(r).filter((a) => ["shove", "slap", "punch", "kill"].includes(a.verb) && a.origin !== "scenario" && a.atMs < window);
      expect(early.map((a) => `${a.actor} ${a.verb} @${a.atMs}`), id).toEqual([]);
      expect(sheetProbes(r, config.sheet!).find((p) => p.probe === "sheet-improv-held")?.passed, id).toBe(true);
    }
  });

  it("[LAD-11] without the hold the same scene reproduces run 63's shape: an improvised shove and slap in the first minute, before the sheet's reversal", async () => {
    const off = { ...DEFAULT_DRAMA_TUNING, sheetHold: { ...DEFAULT_DRAMA_TUNING.sheetHold, minRung: 99 } };
    const config = { ...(await sheetSimConfig("confronto-da-traicao", { seed: 1 })), tuning: off };
    const r = runDramaSim(config);
    const early = started(r).filter((a) => ["shove", "slap"].includes(a.verb) && a.origin !== "scenario" && a.atMs < 90_000);
    expect(early.map((a) => a.verb)).toEqual(["shove", "slap"]);
    expect(sheetProbes(r, config.sheet!).find((p) => p.probe === "sheet-improv-held")?.passed).toBe(false);
  });

  it("plays the sheet's quiet beats on the stage: blocking, props, faces, camera, one pause", async () => {
    const r = runDramaSim(await sheetSimConfig("confronto-da-traicao", { seed: 7 }));
    const kinds = new Set(r.sheet!.stage.map((s) => s.kind));
    for (const k of ["block", "prop", "camera", "pause", "expression"]) expect(kinds.has(k), k).toBe(true);
    expect(r.sheet!.summary).toMatchObject({ climax: { outcome: "played" }, late: 0 });
    expect(r.sheet!.summary.climax.at_ms!).toBeLessThanOrEqual(240_000);
  });

  it("nobody speaks during the authored pause", async () => {
    const r = runDramaSim(await sheetSimConfig("tapa-na-cara", { seed: 3 }));
    const pause = r.sheet!.stage.find((s) => s.kind === "pause")!;
    expect(r.speech.filter((s) => s.atMs >= pause.atMs && s.atMs < pause.atMs + 4_000)).toEqual([]);
  });

  it("is the same every time for one seed, and different sheets (a kill, a kiss) are valid climaxes too", async () => {
    const a = JSON.stringify(runDramaSim(await sheetSimConfig("confronto-da-traicao", { seed: 5 })).events);
    const b = JSON.stringify(runDramaSim(await sheetSimConfig("confronto-da-traicao", { seed: 5 })).events);
    expect(a).toBe(b);
    for (const climax of ["kill", "punch", "shove", "kiss", "hug"] as const) {
      const r = runDramaSim(await sheetSimConfig("confronto-da-traicao", { seed: 5, climax, climaxAtMs: 150_000 }));
      expect(["played", "organic"], climax).toContain(r.sheet!.summary.climax.outcome);
      expect(sheetProbes(r, r.sheet!.sheet).find((p) => p.probe === "sheet-climax-by-240s")?.passed, climax).toBe(true);
      expect(r.sheet!.summary.climax.at_ms!, climax).toBeLessThanOrEqual(240_000);
    }
  });

  it("refuses a sheet that does not hold, with the validator's rows", async () => {
    await expect(sheetSimConfig("confronto-da-traicao", { sheet: { version: 1, premise: "x", stakes: "y", arc: { inciting_at_ms: 1, climax_at_ms: 2, aftermath_until_ms: 3 }, beats: [] } })).rejects.toThrow(/does not hold/);
  });

  it("the probe report of a sheet scene is readable (the CLI's report)", async () => {
    const r = runDramaSim(await sheetSimConfig("anuncio-do-desmaio", { seed: 2 }));
    expect(probeReport(r).acts.started).toBeGreaterThan(0);
  });

  it("the model benchmark's three briefs are real scenes: a cast with secrets, and the deterministic sheet is valid for each", async () => {
    const briefs = await benchBriefs();
    expect(briefs.map((b) => b.id)).toEqual(["sobremesa", "quarto-1214", "confronto-da-traicao"]);
    for (const { id, brief } of briefs) {
      expect(brief.cast.length, id).toBeGreaterThanOrEqual(3);
      expect(brief.situation.length, id).toBeGreaterThan(80);
      const r = await generateBeatSheet(brief, { links: [], mock: true });
      expect(r.ok, id).toBe(true);
    }
  });
});
