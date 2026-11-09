import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DRAMA_AXES, findFfmpeg, parseClipLabel, type DramaJudgeProvider, type DramaJudgeRequest } from "../drama/index.js";
import { runDramaJudgeCli, type DramaJudgeCliDeps } from "../cli/drama-judge.js";

const FIXTURE_RUN = join(dirname(fileURLToPath(import.meta.url)), "../hotel/__fixtures__/sample-run");
const ffmpeg = findFfmpeg();

const replyWith = (score: number): string =>
  JSON.stringify({
    scores: Object.fromEntries(DRAMA_AXES.map((a) => [a, { score, evidence: "see 1.00s" }])),
    failureCodes: [],
    pass: score >= 3,
  });

/** A fake model: answers by clip id, keeps every request it was sent. */
function fakeModel(scoreByClip: Record<string, number>): { requests: DramaJudgeRequest[]; makeProvider: NonNullable<DramaJudgeCliDeps["makeProvider"]> } {
  const requests: DramaJudgeRequest[] = [];
  return {
    requests,
    makeProvider: (config): DramaJudgeProvider => ({
      model: config.model,
      async complete(request) {
        requests.push(request);
        const id = /^Clip: (.+)$/m.exec(request.user)![1]!;
        return replyWith(scoreByClip[id] ?? 3);
      },
    }),
  };
}

function harness(env: Record<string, string | undefined>, model: ReturnType<typeof fakeModel>) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: DramaJudgeCliDeps = { env, out: (s) => out.push(s), err: (s) => err.push(s), makeProvider: model.makeProvider };
  return { out, err, deps };
}

describe("drama-judge CLI usage and guards (no ffmpeg, no model)", () => {
  it("prints usage and exits 2 when given neither a clip nor a calibration", async () => {
    const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge" }, fakeModel({}));
    expect(await runDramaJudgeCli([], h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain("Usage:");
  });

  it("documents the header and token variables in the usage text", async () => {
    const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge" }, fakeModel({}));
    await runDramaJudgeCli([], h.deps);
    const text = h.err.join("\n");
    for (const name of ["DRAMA_JUDGE_HEADERS", "DRAMA_JUDGE_SESSION_HEADER", "DRAMA_JUDGE_MAX_TOKENS", "x-opencode-session"]) expect(text).toContain(name);
  });

  it("exits 2 on bad DRAMA_JUDGE_HEADERS, without echoing a value", async () => {
    const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge", DRAMA_JUDGE_HEADERS: '{"Authorization":"SECRET-VALUE"}' }, fakeModel({}));
    expect(await runDramaJudgeCli(["--clip", "c.mp4", "--run", FIXTURE_RUN], h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain("DRAMA_JUDGE_HEADERS");
    expect(h.err.join("\n")).not.toContain("SECRET-VALUE");
  });

  it("exits 2 when the calibrate flags are incomplete, naming the missing one", async () => {
    const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge" }, fakeModel({}));
    expect(await runDramaJudgeCli(["--calibrate", "--clips-manifest", "m.json", "--labels", "labels"], h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain("--judge-out");
  });

  it("exits 2 with no judge model configured, and says which variable to set", async () => {
    const h = harness({}, fakeModel({}));
    expect(await runDramaJudgeCli(["--clip", "c.mp4", "--run", FIXTURE_RUN], h.deps)).toBe(2);
    expect(h.err.join("\n")).toContain("DRAMA_JUDGE_MODEL");
  });

  it("refuses to run when --actor-model names the judge model, before touching the clip or the model", async () => {
    const model = fakeModel({});
    const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge" }, model);
    const code = await runDramaJudgeCli(["--clip", "/nonexistent/c.mp4", "--run", FIXTURE_RUN, "--actor-model", "Fake/Judge"], h.deps);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("also an actor model");
    expect(model.requests).toHaveLength(0);
  });

  it("reads actor models from DRAMA_ACTOR_MODELS", async () => {
    const model = fakeModel({});
    const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge", DRAMA_ACTOR_MODELS: "a/one, fake/judge" }, model);
    expect(await runDramaJudgeCli(["--clip", "/nonexistent/c.mp4", "--run", FIXTURE_RUN], h.deps)).toBe(1);
    expect(model.requests).toHaveLength(0);
  });

  it("reads actor models from the run's own replay.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drama-cli-run-"));
    try {
      const run = join(dir, "run");
      cpSync(FIXTURE_RUN, run, { recursive: true });
      const replay = JSON.parse(readFileSync(join(run, "replay.json"), "utf8")) as Record<string, unknown>;
      writeFileSync(join(run, "replay.json"), JSON.stringify({ ...replay, actorModels: ["fake/judge"] }));
      const model = fakeModel({});
      const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge" }, model);
      expect(await runDramaJudgeCli(["--clip", "/nonexistent/c.mp4", "--run", run], h.deps)).toBe(1);
      expect(h.err.join("\n")).toContain("also an actor model");
      expect(model.requests).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.runIf(ffmpeg !== undefined)("drama-judge CLI end to end (real ffmpeg, fake model)", () => {
  let dir: string;
  const clipPath = (id: string): string => join(dir, "clips", `${id}.mp4`);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "drama-cli-"));
    mkdirSync(join(dir, "clips"));
    for (const id of ["c1", "c2", "c3"]) {
      const r = spawnSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=6", "-pix_fmt", "yuv420p", clipPath(id)]);
      if (r.status !== 0) throw new Error(r.stderr.toString());
    }
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("judges one clip against a recorded run and writes the label", async () => {
    const model = fakeModel({ c1: 4 });
    const h = harness({ DRAMA_JUDGE_MODEL: "env/model" }, model);
    const outFile = join(dir, "out", "label.json");

    const code = await runDramaJudgeCli(["--clip", clipPath("c1"), "--run", FIXTURE_RUN, "--out", outFile, "--model", "fake/judge"], h.deps);

    expect(code).toBe(0);
    const label = parseClipLabel(readFileSync(outFile, "utf8"));
    expect(label.clipId).toBe("c1");
    expect(label.labeler).toBe("judge:fake/judge");
    expect(label.scores.restraint.score).toBe(4);
    expect(model.requests).toHaveLength(1);
    const request = model.requests[0]!;
    expect(request.temperature).toBe(0);
    expect(request.images.length).toBeGreaterThan(0);
    expect(Buffer.from(request.images[0]!.base64, "base64").subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(request.user).toContain("Image 1: sheet 1 of");
    expect(request.user).toContain("oi Duda");
    expect(existsSync(join(dir, "out", "c1-sheets", "sheet_1.png"))).toBe(true);
  });

  it("prints the label JSON when there is no --out", async () => {
    const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge" }, fakeModel({ c2: 2 }));
    const code = await runDramaJudgeCli(["--clip", clipPath("c2"), "--run", FIXTURE_RUN, "--clip-id", "take-2", "--sheets-dir", join(dir, "sheets-c2")], h.deps);
    expect(code).toBe(0);
    expect(parseClipLabel(h.out.join("")).clipId).toBe("take-2");
  });

  function calibrationFixture(name: string, human: Record<string, number>): { manifest: string; labels: string; judgeOut: string } {
    const root = join(dir, name);
    mkdirSync(join(root, "labels"), { recursive: true });
    for (const [id, score] of Object.entries(human)) {
      const label = {
        clipId: id,
        labeler: "human:caio",
        labeledAt: "2026-11-08T22:00:00.000Z",
        scores: Object.fromEntries(DRAMA_AXES.map((a) => [a, { score }])),
        failureCodes: [],
        pass: score >= 3,
      };
      writeFileSync(join(root, "labels", `${id}.json`), JSON.stringify(label));
    }
    const manifest = join(root, "manifest.json");
    writeFileSync(manifest, JSON.stringify({ clips: Object.keys(human).map((clipId) => ({ clipId, clip: clipPath(clipId), run: FIXTURE_RUN })) }));
    return { manifest, labels: join(root, "labels"), judgeOut: join(root, "judge") };
  }

  it("calibrates: judges every labeled clip, writes judge labels, prints per-axis kappa and PASS when the judge agrees", async () => {
    const f = calibrationFixture("agree", { c1: 1, c2: 3, c3: 5 });
    const model = fakeModel({ c1: 1, c2: 3, c3: 5 });
    const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge" }, model);

    const code = await runDramaJudgeCli(["--calibrate", "--clips-manifest", f.manifest, "--labels", f.labels, "--judge-out", f.judgeOut], h.deps);

    const text = h.out.join("\n");
    expect(code).toBe(0);
    expect(model.requests).toHaveLength(3);
    for (const axis of DRAMA_AXES) expect(text).toMatch(new RegExp(`${axis}\\s+kappa\\s+1\\.000\\s+n=3\\s+PASS`));
    expect(text).toContain("PASS: weighted kappa >= 0.6 on all 6 axes");
    expect(readdirSync(f.judgeOut).sort()).toEqual(["agreement.json", "c1.json", "c2.json", "c3.json", "sheets"]);
  });

  it("calibrates: exits 1 and prints FAIL when the judge disagrees with the human", async () => {
    const f = calibrationFixture("disagree", { c1: 1, c2: 3, c3: 5 });
    const h = harness({ DRAMA_JUDGE_MODEL: "fake/judge" }, fakeModel({ c1: 5, c2: 3, c3: 1 }));

    const code = await runDramaJudgeCli(["--calibrate", "--clips-manifest", f.manifest, "--labels", f.labels, "--judge-out", f.judgeOut], h.deps);

    expect(code).toBe(1);
    expect(h.out.join("\n")).toMatch(/restraint\s+kappa\s+-1\.000\s+n=3\s+FAIL/);
    expect(h.out.join("\n")).toContain("FAIL: weighted kappa >= 0.6 is required on every axis");
  });
});
