import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseVideoArgs } from "../../cli/video.js";
import { createVideo } from "../project.js";

const script = JSON.stringify({
  version: "perfectman-video-v1", title: "Saved conversation",
  agents: [{ id: "ada", name: "Ada" }],
  steps: [{ phase: "Arrival", kind: "message", actorId: "ada", text: "Anyone here?" }],
});

describe("file to video command", () => {
  it("requires explicit paths and rejects unrecognized flags", () => {
    expect(parseVideoArgs(["--input", "a.json", "--out", "out/a.mp4", "--prepare-only"]))
      .toEqual({ input: "a.json", output: "out/a.mp4", prepareOnly: true });
    expect(parseVideoArgs(["--help"])).toBeUndefined();
    expect(() => parseVideoArgs(["--input", "a.json"])).toThrow("--out");
    expect(() => parseVideoArgs(["--invent-emotions"])).toThrow();
  });
  it("prepares an auditable local project, preserves its input, and refuses replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "perfectman-video-"));
    try {
      const input = join(root, "source with spaces.json"), output = join(root, "movie.mp4");
      await writeFile(input, script);
      const result = await createVideo({ input, output, prepareOnly: true });
      const data = JSON.parse(await readFile(join(result.project, "storyboard.json"), "utf8"));
      expect(data.sourceSha256).toBe(createHash("sha256").update(script).digest("hex"));
      expect(data.steps[0].text).toBe("Anyone here?");
      expect(data.beats[0].sourceRefs).toEqual(["/steps/0"]);
      const html = await readFile(join(result.project, "index.html"), "utf8");
      expect(html).toContain('data-composition-id="run-video"');
      for (const file of ["styles.css", "gsap.min.js", "dm-sans-latin-wght-normal.woff2", "DM-Sans-LICENSE.txt", "perfectman-logo.png", "tap.wav"]) {
        expect((await stat(join(result.project, "assets", file))).size).toBeGreaterThan(0);
      }
      await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(createVideo({ input, output, prepareOnly: true })).rejects.toThrow("already exists");
      expect(await readFile(input, "utf8")).toBe(script);
      expect(await readFile(join(result.project, "index.html"), "utf8")).toBe(html);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("fails before output writes when the input is invalid or output exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "perfectman-video-errors-"));
    try {
      const input = join(root, "broken.json"), output = join(root, "movie.mp4");
      await writeFile(input, "not json");
      await expect(createVideo({ input, output, prepareOnly: true })).rejects.toThrow();
      await expect(stat(join(root, "movie.hyperframes"))).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(output, "existing video");
      await expect(createVideo({ input, output, prepareOnly: true })).rejects.toThrow("already exists");
      expect(await readFile(output, "utf8")).toBe("existing video");
      await expect(createVideo({ input, output: join(root, "movie.txt"), prepareOnly: true })).rejects.toThrow(".mp4");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
