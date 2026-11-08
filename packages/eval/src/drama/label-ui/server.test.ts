import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRAMA_AXES } from "../axes.js";
import { parseClipLabel, serializeClipLabel, type ClipLabel } from "../label.js";
import type { ClipInfo } from "./label-session.js";
import { loadClipsFromManifest, startLabelServer, type RunningLabelServer } from "./server.js";

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text: string;
}

function send(port: number, method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text: body.toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

function validLabel(over: Partial<ClipLabel> = {}): ClipLabel {
  return {
    clipId: "alpha",
    labeler: "caio",
    labeledAt: "2026-11-08T22:00:00.000Z",
    scores: Object.fromEntries(DRAMA_AXES.map((a, i) => [a, { score: i === 5 ? null : (i % 5) + 1 }])) as ClipLabel["scores"],
    failureCodes: ["D2", "D1", "E10"],
    pass: false,
    notes: "slap with no cause",
    ...over,
  };
}

const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const PNG = Buffer.from("89504e470d0a1a0a00000000", "hex");

let root: string;
let labelsDir: string;
let running: RunningLabelServer;
let clips: ClipInfo[];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "label-ui-test-"));
  await writeFile(join(root, "alpha.mp4"), VIDEO);
  await writeFile(join(root, "alpha.png"), PNG);
  await writeFile(join(root, "beta.mp4"), VIDEO);
  await writeFile(join(root, "empty.mp4"), "");
  await writeFile(join(root, "secret.json"), "TOP SECRET");
  clips = [
    { id: "alpha", title: "Alpha scene", durationSec: 12.5, scene: "bar", videoPath: join(root, "alpha.mp4"), contactPath: join(root, "alpha.png") },
    { id: "beta", title: "beta", durationSec: null, scene: null, videoPath: join(root, "beta.mp4"), contactPath: null },
    { id: "empty", title: "empty", durationSec: null, scene: null, videoPath: join(root, "empty.mp4"), contactPath: null },
  ];
  labelsDir = join(root, "labels");
  running = await startLabelServer({ clips, labelsDir, labeler: "tester", port: 0 });
});

afterAll(async () => {
  await running.close();
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(labelsDir, { recursive: true, force: true });
  await mkdir(labelsDir, { recursive: true });
});

const put = (id: string, body: unknown) =>
  send(running.port, "PUT", `/api/labels/${id}`, { headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("server basics", () => {
  it("binds to 127.0.0.1 only", () => {
    const addr = running.server.address();
    expect(addr).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
  });

  it("serves the page and its assets", async () => {
    const html = await send(running.port, "GET", "/");
    expect(html.status).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.text).toContain('src="/page.js"');
    expect((await send(running.port, "GET", "/page.js")).headers["content-type"]).toContain("javascript");
    expect((await send(running.port, "GET", "/page.css")).headers["content-type"]).toContain("text/css");
  });

  it("serves the axes with their questions and D1-D7 definitions from the shared vocabulary", async () => {
    const meta = JSON.parse((await send(running.port, "GET", "/api/meta")).text);
    expect(meta.labeler).toBe("tester");
    expect(meta.axes.map((a: { id: string }) => a.id)).toEqual([...DRAMA_AXES]);
    expect(meta.failureCodes.map((c: { id: string }) => c.id)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7"]);
    expect(meta.failureCodes[0].definition).toContain("neither the target nor any witness");
  });

  it("lists clips without any judge or model score (blind mode)", async () => {
    const res = await send(running.port, "GET", "/api/clips");
    expect(JSON.parse(res.text)).toEqual([
      { id: "alpha", title: "Alpha scene", durationSec: 12.5, scene: "bar", hasContactSheet: true },
      { id: "beta", title: "beta", durationSec: null, scene: null, hasContactSheet: false },
      { id: "empty", title: "empty", durationSec: null, scene: null, hasContactSheet: false },
    ]);
    expect(res.text).not.toMatch(/score|judge/i);
  });

  it("rejects requests whose Host or Origin is not the local server (DNS rebinding / cross-site writes)", async () => {
    expect((await send(running.port, "GET", "/api/clips", { headers: { host: "evil.example" } })).status).toBe(403);
    const cross = await send(running.port, "PUT", "/api/labels/alpha", {
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      body: JSON.stringify(validLabel()),
    });
    expect(cross.status).toBe(403);
    await expect(readdir(labelsDir)).resolves.toEqual([]);
  });

  it("answers unknown routes with 404 and unknown clips with 404", async () => {
    expect((await send(running.port, "GET", "/nope")).status).toBe(404);
    expect((await send(running.port, "GET", "/clips/ghost")).status).toBe(404);
    expect((await send(running.port, "GET", "/contacts/beta")).status).toBe(404);
  });
});

describe("clip streaming", () => {
  it("serves the whole file as video/mp4 and advertises byte ranges", async () => {
    const res = await send(running.port, "GET", "/clips/alpha");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-length"]).toBe("1000");
    expect(res.body.equals(VIDEO)).toBe(true);
  });

  it("answers a closed range with 206, the exact Content-Range and only those bytes", async () => {
    const res = await send(running.port, "GET", "/clips/alpha", { headers: { range: "bytes=100-199" } });
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 100-199/1000");
    expect(res.headers["content-length"]).toBe("100");
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.body.equals(VIDEO.subarray(100, 200))).toBe(true);
  });

  it("supports open-ended and suffix ranges (what a browser sends when seeking)", async () => {
    const open = await send(running.port, "GET", "/clips/alpha", { headers: { range: "bytes=900-" } });
    expect(open.status).toBe(206);
    expect(open.headers["content-range"]).toBe("bytes 900-999/1000");
    expect(open.body.equals(VIDEO.subarray(900))).toBe(true);

    const suffix = await send(running.port, "GET", "/clips/alpha", { headers: { range: "bytes=-50" } });
    expect(suffix.headers["content-range"]).toBe("bytes 950-999/1000");
    expect(suffix.body.equals(VIDEO.subarray(950))).toBe(true);
  });

  it("clamps a range that runs past the end of the file", async () => {
    const res = await send(running.port, "GET", "/clips/alpha", { headers: { range: "bytes=990-5000" } });
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 990-999/1000");
    expect(res.body.length).toBe(10);
  });

  it("answers an out-of-bounds range with 416 and the size", async () => {
    const res = await send(running.port, "GET", "/clips/alpha", { headers: { range: "bytes=1000-1100" } });
    expect(res.status).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */1000");
    expect(res.body.length).toBe(0);
  });

  it("serves a HEAD with headers and no body", async () => {
    const res = await send(running.port, "HEAD", "/clips/alpha");
    expect(res.status).toBe(200);
    expect(res.headers["content-length"]).toBe("1000");
    expect(res.body.length).toBe(0);
  });

  it("handles a zero-byte file without crashing", async () => {
    const res = await send(running.port, "GET", "/clips/empty");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it("serves the contact sheet as image/png", async () => {
    const res = await send(running.port, "GET", "/contacts/alpha");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.body.equals(PNG)).toBe(true);
  });

  it("returns 404 when the mp4 is missing on disk", async () => {
    const missing = await startLabelServer({
      clips: [{ id: "gone", title: "gone", durationSec: null, scene: null, videoPath: join(root, "gone.mp4"), contactPath: null }],
      labelsDir,
      port: 0,
    });
    try {
      expect((await send(missing.port, "GET", "/clips/gone")).status).toBe(404);
    } finally {
      await missing.close();
    }
  });
});

describe("path traversal", () => {
  const attacks = ["..%2Fsecret", "%2e%2e%2fsecret", "..%2F..%2Fetc%2Fpasswd", "%2e%2e", "a%5Cb", "..", "alpha%00", "%zz", "alpha.json%2F..%2F..%2Fsecret"];

  it.each(attacks)("PUT /api/labels/%s is refused and writes nothing", async (id) => {
    const res = await put(id, validLabel({ clipId: decodeURIComponentSafe(id) }));
    expect([400, 404]).toContain(res.status);
    await expect(readdir(labelsDir)).resolves.toEqual([]);
    expect((await readFile(join(root, "secret.json"), "utf8"))).toBe("TOP SECRET");
    await expect(readdir(root)).resolves.not.toContain("evil.json");
  });

  it.each(attacks)("GET /clips/%s and /api/labels/%s never leave the manifest", async (id) => {
    const clip = await send(running.port, "GET", `/clips/${id}`);
    const label = await send(running.port, "GET", `/api/labels/${id}`);
    expect([400, 404]).toContain(clip.status);
    expect([400, 404]).toContain(label.status);
    expect(clip.text + label.text).not.toContain("TOP SECRET");
  });

  it("answers an encoded traversal id with 400, not just 404", async () => {
    expect((await put("..%2F..%2Fevil", validLabel({ clipId: "../../evil" }))).status).toBe(400);
  });
});

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

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
