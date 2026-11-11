import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scoreRun } from "../cinematic/index.js";
import { baselineMarkdown, baselineRow, parseRunList, runCinematicCli } from "../cli/cinematic.js";
import { flatScene, goodScene, writeRun } from "./cinematic-fixtures.js";

const tmp = () => mkdtempSync(join(tmpdir(), "pm-cine-cli-"));

describe("the CLI", () => {
  const run = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
    let out = "";
    let err = "";
    const code = await runCinematicCli(args, { env, out: (s) => (out += s), err: (s) => (err += s) });
    return { code, out, err };
  };

  it("parses run lists", () => {
    expect(parseRunList("55-57")).toEqual([55, 56, 57]);
    expect(parseRunList("55,57,60-61")).toEqual([55, 57, 60, 61]);
    expect(() => parseRunList("a-b")).toThrow(/bad run list/);
    expect(() => parseRunList("9-3")).toThrow(/bad range/);
  });

  it("--run prints the report, --json prints the score, --require-climax turns a failed invariant into exit 1", async () => {
    const good = writeRun(goodScene());
    const flat = writeRun(flatScene());
    const a = await run(["--run", good]);
    expect(a.code).toBe(0);
    expect(a.out).toContain("cinematic");
    expect(a.out).toContain("physical climax by 4:00: PASS");
    const b = await run(["--run", flat, "--require-climax"]);
    expect(b.code).toBe(1);
    expect(b.out).toContain("FAIL");
    const c = await run(["--run", good, "--json"]);
    expect(JSON.parse(c.out)).toMatchObject({ version: "cinematic-v1", run: "100", partial: true });
  });

  it("--judge mock fills the engagement group and says so; --write-replay writes it", async () => {
    const dir = writeRun(goodScene());
    const r = await run(["--run", dir, "--judge", "mock", "--write-replay"]);
    expect(r.out).toContain("MOCK: measures nothing");
    expect(JSON.parse(readFileSync(join(dir, "replay.json"), "utf8")).cinematic_score.engagement).toMatchObject({ mock: true });
  });

  it("--judge llm without a model or a key is a usage error, not a crash", async () => {
    const dir = writeRun(goodScene());
    expect((await run(["--run", dir, "--judge", "llm"], {})).code).toBe(2);
    const noKey = await run(["--run", dir, "--judge", "llm", "--model", "strong/model"], {});
    expect(noKey.code).toBe(2);
    expect(noKey.err).toMatch(/API key/);
    expect((await run(["--run", dir, "--judge", "bogus"])).code).toBe(2);
  });

  it("--judge llm uses the provider it is given and refuses an actor model", async () => {
    const dir = writeRun(goodScene());
    const reply = JSON.stringify({ scores: Object.fromEntries(["tension", "surprise", "payoff", "distinctiveness", "rewatchability", "entertaining"].map((a) => [a, { score: 4, evidence: "at 0:04 she accuses him" }])) });
    let out = "";
    const code = await runCinematicCli(["--run", dir, "--judge", "llm", "--json"], { env: {}, out: (s) => (out += s), err: () => {}, makeProvider: () => ({ model: "strong/model", complete: async () => reply }) });
    expect(code).toBe(0);
    expect(JSON.parse(out).engagement).toMatchObject({ judge: "strong/model", mean: 4, mock: false });
    let err = "";
    const code2 = await runCinematicCli(["--run", dir, "--judge", "llm"], { env: {}, out: () => {}, err: (s) => (err += s), makeProvider: () => ({ model: "actor-model/a1", complete: async () => reply }) });
    expect(code2).toBe(1);
    expect(err).toMatch(/also an actor model/);
  });

  it("--baseline scores a list of runs, writes the JSON and prints the markdown table; a missing run is skipped, not fatal", async () => {
    const root = tmp();
    writeRun({ ...goodScene(), run: 1 }, join(root, "1"));
    writeRun({ ...flatScene(), run: 2 }, join(root, "2"));
    const file = join(root, "out", "baseline.json");
    const r = await run(["--baseline", root, "--runs", "1-3", "--out-json", file, "--markdown"]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("run 3");
    expect(r.out).toContain("| 1 |");
    expect(r.out).toContain("pass (slap 3:00)");
    expect(r.out).toContain("fail (none)");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(doc.version).toBe("cinematic-baseline-v2");
    expect(doc.runs.map((x: { run: string }) => x.run)).toEqual(["1", "2"]);
    expect(doc.runs[0].groups.arc.name).toBe("arc");
  });

  it("baseline rows and markdown carry the climax verdict and the four group scores", async () => {
    const s = await scoreRun(writeRun(goodScene()));
    const row = baselineRow(s);
    expect(row.climax).toMatchObject({ pass: true, verb: "slap" });
    expect(baselineMarkdown([row])).toContain("pass (slap 3:00)");
  });

  it("no mode is a usage error", async () => {
    const r = await run([]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Usage");
  });
});
