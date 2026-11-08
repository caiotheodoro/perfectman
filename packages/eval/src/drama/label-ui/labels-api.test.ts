import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseClipLabel, serializeClipLabel } from "../label.js";
import { loadClipsFromManifest, type RunningLabelServer } from "./server.js";
import { createFixture, send, validLabel, type Fixture, type Reply } from "./server-test-kit.js";

let fx: Fixture;
let root: string;
let labelsDir: string;
let running: RunningLabelServer;

beforeAll(async () => {
  fx = await createFixture();
  ({ root, labelsDir, running } = fx);
});

afterAll(() => fx.cleanup());

beforeEach(() => fx.resetLabels());

const put = (id: string, body: unknown) => fx.put(id, body);

describe("PUT /api/labels/:id validation", () => {
  async function expectRejected(body: unknown, status = 400): Promise<Reply> {
    const res = await put("alpha", body);
    expect(res.status).toBe(status);
    await expect(readdir(labelsDir)).resolves.toEqual([]);
    return res;
  }

  it("rejects a body that is not JSON", async () => {
    const res = await expectRejected("{not json");
    expect(JSON.parse(res.text).error).toMatch(/not valid JSON/);
  });

  it("rejects a body whose clipId does not match the URL", async () => {
    const res = await expectRejected(validLabel({ clipId: "beta" }));
    expect(JSON.parse(res.text).error).toMatch(/does not match/);
  });

  it("rejects out-of-range scores, bad failure codes, a missing axis and unknown keys, naming the field", async () => {
    const bad = validLabel();
    const score6 = await expectRejected({ ...bad, scores: { ...bad.scores, restraint: { score: 6 } } });
    expect(JSON.parse(score6.text).details.join(" ")).toContain("scores.restraint.score");

    const lower = await expectRejected({ ...bad, failureCodes: ["d1"] });
    expect(JSON.parse(lower.text).details.join(" ")).toContain("failureCodes.0");
    await expectRejected({ ...bad, failureCodes: ["E"] });

    const { restraint: _dropped, ...fewer } = bad.scores;
    await expectRejected({ ...bad, scores: fewer });
    await expectRejected({ ...bad, extra: 1 });
    await expectRejected({ ...bad, labeledAt: "yesterday" });
    await expectRejected({ ...bad, labeler: "" });
    await expectRejected([]);
    await expectRejected("null");
  });

  it("returns 404 for a clip that is not in the manifest and 413 for an oversized body", async () => {
    expect((await put("ghost", validLabel({ clipId: "ghost" }))).status).toBe(404);
    await expectRejected({ ...validLabel(), notes: "x".repeat(70_000) }, 413);
  });

  it("returns 405 for other methods on a label", async () => {
    expect((await send(running.port, "DELETE", "/api/labels/alpha")).status).toBe(405);
  });
});

describe("label persistence", () => {
  it("writes a one-line file that round-trips through parseClipLabel and is normalized", async () => {
    const res = await put("alpha", validLabel());
    expect(res.status).toBe(200);

    const text = await readFile(join(labelsDir, "alpha.json"), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd()).not.toContain("\n");
    const parsed = parseClipLabel(text);
    expect(parsed.failureCodes).toEqual(["D1", "D2", "E10"]);
    expect(parsed.scores.restraint.score).toBeNull();
    expect(parsed).toEqual({ ...validLabel(), failureCodes: ["D1", "D2", "E10"] });
    expect(text.trimEnd()).toBe(serializeClipLabel(parsed));
    expect(parseClipLabel(res.text)).toEqual(parsed);
  });

  it("leaves no temp files behind and overwrites on a second save", async () => {
    await put("alpha", validLabel({ pass: false }));
    await put("alpha", validLabel({ pass: true, notes: undefined }));
    await expect(readdir(labelsDir)).resolves.toEqual(["alpha.json"]);
    const stored = parseClipLabel(await readFile(join(labelsDir, "alpha.json"), "utf8"));
    expect(stored.pass).toBe(true);
    expect(stored).not.toHaveProperty("notes");
  });

  it("never exposes a torn file under concurrent saves: the result always parses as exactly one of the writes", async () => {
    const variants = Array.from({ length: 25 }, (_, i) => validLabel({ notes: `take ${i} ${"y".repeat(i * 200)}` }));
    const replies = await Promise.all(variants.map((v) => put("alpha", v)));
    expect(replies.map((r) => r.status)).toEqual(variants.map(() => 200));
    const stored = parseClipLabel(await readFile(join(labelsDir, "alpha.json"), "utf8"));
    expect(variants.map((v) => v.notes)).toContain(stored.notes);
    await expect(readdir(labelsDir)).resolves.toEqual(["alpha.json"]);
  });

  it("returns a saved label by GET and 404 before it exists", async () => {
    expect((await send(running.port, "GET", "/api/labels/alpha")).status).toBe(404);
    await put("alpha", validLabel());
    const got = await send(running.port, "GET", "/api/labels/alpha");
    expect(got.status).toBe(200);
    expect(parseClipLabel(got.text).labeler).toBe("caio");
  });

  it("reports per-clip status, counting a corrupt file as unlabelled rather than failing", async () => {
    await put("alpha", validLabel());
    await writeFile(join(labelsDir, "beta.json"), "{broken");
    const statuses = JSON.parse((await send(running.port, "GET", "/api/labels")).text);
    expect(statuses).toEqual([
      { id: "alpha", labeled: true, invalid: false, labeler: "caio", labeledAt: "2026-11-08T22:00:00.000Z", pass: false },
      { id: "beta", labeled: false, invalid: true, labeler: null, labeledAt: null, pass: null },
      { id: "empty", labeled: false, invalid: false, labeler: null, labeledAt: null, pass: null },
    ]);
    expect((await send(running.port, "GET", "/api/labels/beta")).status).toBe(422);
  });

  it("does not trust a label file that names a different clip", async () => {
    await writeFile(join(labelsDir, "beta.json"), serializeClipLabel(validLabel({ clipId: "alpha" })));
    expect((await send(running.port, "GET", "/api/labels/beta")).status).toBe(422);
    const statuses = JSON.parse((await send(running.port, "GET", "/api/labels")).text);
    expect(statuses[1]).toMatchObject({ id: "beta", labeled: false, invalid: true });
  });
});

describe("loadClipsFromManifest", () => {
  it("reads a manifest, resolves relative paths and drops contact sheets missing on disk", async () => {
    const manifestPath = join(root, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        entries: [
          { clip: "alpha.mp4", path: "alpha.mp4", contact_sheet: "alpha.png", duration_s: 3 },
          { clip: "beta.mp4", path: "beta.mp4", contact_sheet: "nope.png" },
        ],
      }),
    );
    const loaded = await loadClipsFromManifest(manifestPath);
    expect(loaded.map((c) => [c.id, c.videoPath, c.contactPath])).toEqual([
      ["alpha", join(root, "alpha.mp4"), join(root, "alpha.png")],
      ["beta", join(root, "beta.mp4"), null],
    ]);
  });

  it("fails clearly on invalid JSON", async () => {
    const manifestPath = join(root, "broken.json");
    await writeFile(manifestPath, "{");
    await expect(loadClipsFromManifest(manifestPath)).rejects.toThrow(/not valid JSON/);
  });
});
