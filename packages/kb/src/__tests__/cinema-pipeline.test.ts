import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildNorms } from "../cinema/aggregate.js";
import { runPipeline } from "../cinema/pipeline.js";
import { buildSources } from "../cinema/sources.js";
import type { SceneFeatures, SourceStats } from "../cinema/types.js";

// Everything here is invented: no third-party text is committed.
const words = ["harbour", "lantern", "velvet", "ferry", "copper", "meadow", "orchid", "quarry", "saddle", "tundra"];
const line = (i: number): string => `${words[i % 10]} ${words[(i + 3) % 10]} ${words[(i + 7) % 10]} ${i % 5 === 0 ? "you liar get out!" : "after the rain"}`;

function xmlScript(n: number): string {
  const body = Array.from({ length: n }, (_, i) => `<character>${i % 2 ? "ANNA" : "BEN"}</character><dialogue>${line(i)}</dialogue>${i === 6 ? "<scene_description>He slaps the table hard .</scene_description>" : ""}`).join("");
  return `<script><scene><stage_direction>INT. KITCHEN</stage_direction>${body}</scene><scene>${body}</scene></script>`;
}
function opusXml(): string {
  let s = `<?xml version="1.0"?><document id="1">`;
  for (let i = 0; i < 320; i++) {
    const t0 = (i % 40 === 0 ? 40 : 0) + i * 3;
    const f = (x: number): string => `00:${String(Math.floor(x / 60)).padStart(2, "0")}:${String(Math.floor(x % 60)).padStart(2, "0")},000`;
    s += `<s id="${i}"><time id="T${i}S" value="${f(t0)}" />\n${line(i)}\n<time id="T${i}E" value="${f(t0 + 2)}" /></s>`;
  }
  return `${s}</document>`;
}

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pm-cinema-"));
  const cin = path.join(root, "corpus", "cinema");
  for (const d of ["moviesum", "summscreen", "opus-en", "imdb"]) mkdirSync(path.join(cin, d), { recursive: true });
  writeFileSync(path.join(cin, "moviesum", "train.jsonl"), `${JSON.stringify({ movie_name: "Invented Film_2001", imdb_id: "tt0000042", script: xmlScript(24), summary: "" })}\n`);
  writeFileSync(path.join(cin, "summscreen", "fd_train.json"), JSON.stringify([{ "File Name": "Invented_Show_01x01.json", Transcript: ["(Anna stands at the window.)", ...Array.from({ length: 20 }, (_, i) => `${i % 2 ? "ANNA" : "BEN"}: ${line(i)}`)] }]));
  writeFileSync(path.join(cin, "opus-en", "en__2001__7__1.xml"), opusXml());
  writeFileSync(path.join(cin, "imdb", "title.basics.tsv.gz"), gzipSync(["tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres", "tt0000042\tmovie\tInvented\tInvented\t0\t2001\t\\N\t96\tThriller,Crime", "tt0000007\tmovie\tInvented Two\tInvented Two\t0\t2001\t\\N\t17\tCrime"].join("\n")));
  return root;
}

describe("cinema pipeline on an invented corpus", () => {
  it("runs every group, keeps provenance without text, and the norms carry no five-word run", async () => {
    const root = fixture();
    const rows: SceneFeatures[] = [];
    const srcs: SourceStats[] = [];
    const { stats, provenance } = await runPipeline({ corpus: path.join(root, "corpus"), cinema: path.join(root, "corpus", "cinema"), groups: ["moviesum", "summscreen", "opus-en"] }, (f) => rows.push(f), (s) => srcs.push(s));
    expect(stats.byGroup["moviesum"]?.sources).toBe(1);
    expect(stats.byGroup["summscreen"]?.sources).toBe(1);
    expect(stats.byGroup["opus-en"]?.sources).toBe(1);
    expect(provenance.map((p) => p.group).sort()).toEqual(["moviesum", "opus-en", "summscreen"]);
    const film = rows.filter((r) => r.form === "screenplay");
    expect(film.length).toBe(2);
    expect(film[0]!.timeSource).toBe("runtime");
    expect(film[0]!.genre).toBe("thriller");
    expect(film.reduce((a, r) => a + r.durSec, 0)).toBeGreaterThan(80 * 60 * 0.9); // the 96 minutes are shared out over the scenes (modulo dropped ones)
    expect(film[0]!.hardActs).toBeGreaterThanOrEqual(1);
    const subs = rows.filter((r) => r.form === "subtitle");
    expect(subs.length).toBeGreaterThan(5); // 12 s silences cut the file
    expect(subs[0]!.silenceShare).not.toBeNull();
    expect(subs[0]!.hasDirections).toBe(false);
    expect(rows.filter((r) => r.form === "transcript").length).toBe(1);
    expect(srcs.every((s) => s.minutes > 0)).toBe(true);

    const norms = buildNorms(rows, srcs, { byGroup: stats.byGroup, calibration: {}, minScenes: 1 });
    const json = JSON.stringify(norms).toLowerCase();
    const src = JSON.stringify(Array.from({ length: 10 }, (_, i) => line(i))).toLowerCase();
    const w = src.replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
    for (let i = 0; i + 4 < w.length; i++) expect(json).not.toContain(w.slice(i, i + 5).join(" "));
    expect(Object.keys(norms.buckets)).toContain("en/film/screenplay/thriller");
    expect(Object.keys(norms.buckets)).toContain("en/film/subtitle");

    const sources = JSON.stringify(buildSources({ corpus: path.join(root, "corpus"), provenance, stats: { byGroup: stats.byGroup, skipped: stats.skipped }, built: "2026-11-11" }));
    expect(sources).toContain("tt0000042");
    for (let i = 0; i + 4 < w.length; i++) expect(sources.toLowerCase()).not.toContain(w.slice(i, i + 5).join(" "));
  });
});
