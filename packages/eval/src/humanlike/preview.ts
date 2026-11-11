import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { TERRACO } from "./terraco.js";
import { PREVIEW_ARMS, runArm } from "./preview-run.js";
import { renderRow } from "./report.js";

/**
 * Runs run 63's cast and script on the Terraço for each preview arm (human_likeness 0, 0.6, 1) and writes, per arm, `arm-h<n>.json`: the layout, the trace (positions, facing,
 * typing, lines, gestures, faces), the body log, the metrics and the score. `scripts/render-humanlike.py` draws them.
 *
 *   node dist/humanlike/preview.js <out dir> [seed]
 */
/** Seed 3: a draw in which the heated end-game has talk-overs to show (over 12 seeds the cut rate averages 1.2 lines at 0.6 and 2.75 at 1; seed 63 happens to have none). */
export const PREVIEW_SEED = 3;

export function writePreview(outDir: string, seed = PREVIEW_SEED): Array<{ likeness: number; score: number; file: string }> {
  mkdirSync(outDir, { recursive: true });
  const out: Array<{ likeness: number; score: number; file: string }> = [];
  for (const h of PREVIEW_ARMS) {
    const arm = runArm(h, { seed });
    const file = join(outDir, `arm-h${String(h).replace(".", "_")}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        likeness: h,
        seed,
        layout: { name: TERRACO.name, w: TERRACO.w, h: TERRACO.h, furni: TERRACO.furni },
        trace: arm.sim.trace,
        bodyLog: arm.sim.bodyLog,
        film: arm.sim.film,
        metrics: arm.metrics,
        score: arm.score,
      }),
    );
    console.log(renderRow({ metrics: arm.metrics, score: arm.score }));
    out.push({ likeness: h, score: arm.score.score, file });
  }
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(out, null, 2));
  return out;
}

/** The three arms averaged over `seeds` draws: the sim is deterministic per seed, so this is the spread of the dial, not noise. */
export function seedTable(seeds: number): string {
  const keys: Array<[string, (a: ReturnType<typeof runArm>) => number | null | undefined, number]> = [
    ["human-likeness score", (a) => a.score.score, 1],
    ["lines said within earshot", (a) => a.metrics.distance.inEarshotShare, 2],
    ["median distance at a line (tiles)", (a) => a.metrics.distance.median, 1],
    ["stacking events", (a) => a.metrics.stacking.events, 1],
    ["speaker faces addressee", (a) => a.metrics.gaze.speakerRate, 2],
    ["listener faces speaker", (a) => a.metrics.gaze.listenerRate, 2],
    ["gaze break and return", (a) => a.metrics.gaze.breakReturnRate, 2],
    ["typing length correlation", (a) => a.metrics.typing.lengthCorrelation, 2],
    ["median bubble ms", (a) => a.metrics.typing.medianMs, 0],
    ["lines landing on the last (overlap)", (a) => a.metrics.overlap.rate, 2],
    ["lines cut off by a dash", (a) => a.metrics.interruption.rate, 3],
    ["lines with a gesture", (a) => a.metrics.gesture.perLine, 2],
    ["non-verbal backchannel", (a) => a.metrics.backchannel.rate, 2],
    ["face changes per actor-minute", (a) => a.metrics.expression.changesPerActorMin, 2],
    ["walks per actor-minute", (a) => a.metrics.walks.perActorMin, 2],
    ["idle motion per actor-minute", (a) => a.metrics.idle.motionPerActorMin, 2],
    ["frozen 10 s windows", (a) => a.metrics.idle.frozenShare, 2],
    ["back-and-forth walks per actor-hour", (a) => a.metrics.idle.reversalsPerActorHour, 2],
  ];
  const sums = PREVIEW_ARMS.map(() => keys.map(() => ({ s: 0, n: 0 })));
  for (let seed = 1; seed <= seeds; seed++) {
    PREVIEW_ARMS.forEach((h, i) => {
      const arm = runArm(h, { seed });
      keys.forEach(([, f], k) => {
        const v = f(arm);
        if (v !== null && v !== undefined) {
          sums[i]![k]!.s += v;
          sums[i]![k]!.n += 1;
        }
      });
    });
  }
  const out = [`| measure | h = 0 | h = 0.6 | h = 1 |`, `|---|---|---|---|`];
  keys.forEach(([label, , d], k) => out.push(`| ${label} | ${PREVIEW_ARMS.map((_, i) => (sums[i]![k]!.n === 0 ? "n/a" : (sums[i]![k]!.s / sums[i]![k]!.n).toFixed(d))).join(" | ")} |`));
  return out.join("\n");
}

if (process.argv[1]?.endsWith("preview.js") || process.argv[1]?.endsWith("preview.ts")) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: preview <out dir> [seed]");
    process.exit(2);
  }
  const mdFlag = process.argv.indexOf("--md");
  if (mdFlag >= 0) {
    const file = resolve(process.argv[mdFlag + 1] ?? "humanlike-preview-table.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${seedTable(12)}\n`);
    console.log(`wrote ${file}`);
  } else writePreview(resolve(dir), process.argv[3] && !process.argv[3].startsWith("--") ? Number(process.argv[3]) : PREVIEW_SEED);
}
