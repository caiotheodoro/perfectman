import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRunBundle, scoreCamera, scoreEmbodiment, fallbackNorms, climaxInvariant } from "../cinematic/index.js";
import { flatScene, goodScene, writeRun } from "./cinematic-fixtures.js";

/** scripts/run-metrics.mjs is a second reader of the same run: it shares no code with the scorer, and these hold the two to the same figures. */
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "scripts", "run-metrics.mjs");
const tool = (await import(pathToFileURL(script).href)) as { computeCinematic: (dir: string) => Record<string, any> | undefined };
const norms = fallbackNorms();
const reading = (g: { readings: Array<{ metric: string; value: number | null }> }, m: string) => g.readings.find((r) => r.metric === m)!.value;

describe("run-metrics: cinematic section agrees with the scorer", () => {
  for (const [name, make] of [["a built scene", goodScene], ["a flat scene", flatScene]] as const) {
    it(`${name}: acts, climax, camera`, () => {
      const dir = writeRun(make());
      const c = tool.computeCinematic(dir)!;
      const b = loadRunBundle(dir);
      const emb = scoreEmbodiment(b, norms);
      const cam = scoreCamera(b, norms);
      const inv = climaxInvariant(b);

      expect(c.acts.played).toBe(emb.detail["acts"]);
      expect(c.acts.perMin).toBeCloseTo(reading(emb, "actsPerMin")!, 1);
      expect(Object.keys(c.acts.verbs).length).toBe(reading(emb, "distinctVerbs") ?? 0);
      if (inv.atS === null) expect(c.acts.climax).toBeNull();
      else expect(c.acts.climax).toMatchObject({ verb: inv.verb, at: inv.atS, byDeadline: inv.pass });
      expect(c.camera.distinctShots).toBe(reading(cam, "distinctShots") ?? 0);
      expect(c.camera.shotsPerMin).toBeCloseTo(reading(cam, "shotsPerMin")!, 1);
      expect(c.camera.shotOnSpeaker).toBeCloseTo(reading(cam, "shotOnSpeaker")!, 2);
      expect(c.camera.lostRate).toBeCloseTo(reading(cam, "staleDropRate")!, 2);
      expect(c.acts.firstAt).toBe(b.acts.length === 0 ? null : Math.min(...b.acts.map((a) => a.tS)));
    });
  }

  it("is absent for a transcript-only input, and present through the CLI as a cinematic key (the old keys are untouched)", () => {
    expect(tool.computeCinematic(path.join(path.dirname(script), "does-not-exist"))).toBeUndefined();
    const dir = writeRun(goodScene());
    const json = JSON.parse(execFileSync("node", [script, dir, "--json"], { encoding: "utf8" }));
    expect(json.cinematic.acts.climax.verb).toBe("slap");
    expect(json.turns).toBeGreaterThan(0);
    expect(json.words).toBeTruthy();
    const without = JSON.parse(execFileSync("node", [script, dir, "--json", "--no-cinematic"], { encoding: "utf8" }));
    expect(without.cinematic).toBeUndefined();
    expect(execFileSync("node", [script, dir], { encoding: "utf8" })).toContain("physical climax by 240s: PASS (slap at 180s)");
  });
});
