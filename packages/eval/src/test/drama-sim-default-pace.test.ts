/**
 * The sidecar's own default tuning, on the five presets (errata P4-02): every drama probe passes with no tuning override, over several seeds and at
 * the consult cadences a run really has, and the ladder still peaks inside a four-minute scene. The sim has no `SIM_TUNING` any more.
 */
import { DEFAULT_DRAMA_TUNING } from "@perfectman/hotel/drama";
import { describe, expect, it } from "vitest";
import { runDramaSim } from "../embodiment/drama-sim.js";
import { DRAMA_PRESETS, presetSimConfig } from "../embodiment/drama-sim-preset.js";
import { probeReport } from "../embodiment/sim-report.js";

const SEEDS = [1, 2, 3, 4, 5];
const CADENCES = [4000, 6000, 8000, 10_000];
const PEAK: Record<string, string> = { "tapa-na-cara": "slap", "confronto-da-traicao": "punch" };

describe("the default pace on the presets", () => {
  it("[D6] every drama probe passes on every preset with the default tuning, for 5 seeds at each consult cadence", async () => {
    for (const id of DRAMA_PRESETS) {
      for (const seed of SEEDS) {
        for (const consultMs of CADENCES) {
          const config = { ...(await presetSimConfig(id, { seed })), consultMs };
          expect(config.tuning, "a sim names no tuning of its own").toBeUndefined();
          const report = probeReport(runDramaSim(config));
          expect({ id, seed, consultMs, total: report.total, failed: report.failed }).toEqual({ id, seed, consultMs, total: 19, failed: [] });
        }
      }
    }
  });

  it("[LAD-1] the ladder still reaches its peak inside the four-minute scene: the slap in tapa-na-cara, the punch in confronto-da-traicao", async () => {
    for (const [id, verb] of Object.entries(PEAK)) {
      for (const consultMs of CADENCES) {
        const result = runDramaSim({ ...(await presetSimConfig(id)), consultMs });
        const peak = result.events.find((e) => e.kind === "act_started" && e.verb === verb);
        expect(peak, `${id} at a consult every ${consultMs} ms`).toBeDefined();
        expect(peak!.atMs).toBeLessThan(240_000);
      }
    }
  });

  it("[D6] a quiet scene is not left silent by the pace: a passive actor is still offered a beat, the first about when the scene opens", async () => {
    const result = runDramaSim(await presetSimConfig("tapa-na-cara"));
    const directed = result.events.filter((e) => e.kind === "act_started" && e.origin === "director");
    expect(directed.length).toBeGreaterThan(0);
    expect(directed.length).toBeLessThanOrEqual(Math.ceil(result.durationMs / DEFAULT_DRAMA_TUNING.origination.minGapMs) * result.actors.length);
  });
});
