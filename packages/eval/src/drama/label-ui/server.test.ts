import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DRAMA_AXES } from "../axes.js";
import { PNG, VIDEO, createFixture, send, validLabel, type Fixture } from "./server-test-kit.js";
import { startLabelServer, type RunningLabelServer } from "./server.js";

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

