import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFilmTimeline, PACES, type DirectorReplay } from "@perfectman/shared";
import { parseVideoArgs } from "../../../cli/video.js";
import { renderSoundtrack } from "../../soundtrack.js";
import { OUTRO_SECONDS, renderFilmComposition } from "../composition.js";
import { createFilmVideo } from "../project.js";
import { readFilmSource } from "../source.js";
import { planFilmSoundtrack } from "../soundtrack.js";
import { catReplayJson } from "./replay-json.js";

const choices = { pace: PACES.normal, huddle: "push" as const, fictionOnly: false };
const replay = (): DirectorReplay => JSON.parse(catReplayJson()) as DirectorReplay;
const timeline = (c = choices) => buildFilmTimeline(replay(), c);

describe("film command line", () => {
  it("keeps the story command as it was and adds the film flags", () => {
    expect(parseVideoArgs(["--film", "--input", "r.json", "--out", "o.mp4", "--pace", "fast", "--huddle", "door", "--fiction-only", "--pulses", "6", "--prepare-only"]))
      .toEqual({ kind: "film", options: { input: "r.json", output: "o.mp4", prepareOnly: true, fictionOnly: true, pace: "fast", huddle: "door", maxPulses: 6 } });
  });

  it("refuses film flags without --film, and bad values", () => {
    expect(() => parseVideoArgs(["--input", "a", "--out", "b.mp4", "--pace", "fast"])).toThrow("only applies with --film");
    expect(() => parseVideoArgs(["--film", "--input", "a", "--out", "b.mp4", "--pace", "slow"])).toThrow("--pace must be");
    expect(() => parseVideoArgs(["--film", "--input", "a", "--out", "b.mp4", "--huddle", "up"])).toThrow("--huddle must be");
    expect(() => parseVideoArgs(["--film", "--input", "a", "--out", "b.mp4", "--pulses", "0"])).toThrow("--pulses must be");
    expect(() => parseVideoArgs(["--film", "--input", "a", "--out", "b.mp4", "--scenario", "x"])).toThrow("--scenario does not apply");
  });
});

describe("film source", () => {
  it("reads a stored replay, and only the first pulses when asked", async () => {
    const root = await mkdtemp(join(tmpdir(), "perfectman-film-"));
    try {
      const file = join(root, "replay.json");
      await writeFile(file, catReplayJson());
      const all = await readFilmSource(file);
      const short = await readFilmSource(file, 3);

      expect(all.replay.pulses).toHaveLength(24);
      expect(short.replay.pulses).toHaveLength(3);
      expect(all.title).toBe("The cat on the roof");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("explains why a transcript or an event list is not enough", async () => {
    const root = await mkdtemp(join(tmpdir(), "perfectman-film-"));
    try {
      const file = join(root, "events.json");
      await writeFile(file, JSON.stringify({ events: [] }));

      await expect(readFilmSource(file)).rejects.toThrow(/stored replay/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("film soundtrack", () => {
  const T = timeline();
  const end = T.duration + 0.5 + OUTRO_SECONDS;
  const cues = planFilmSoundtrack(T, end);

  it("keeps every cue inside the film and valid for the renderer", () => {
    for (const c of cues) {
      expect(c.start).toBeGreaterThanOrEqual(0);
      expect(c.start + c.duration).toBeLessThanOrEqual(end + 1e-6);
    }
    expect(() => renderSoundtrack(cues)).not.toThrow();
  });

  it("plays music from the first second to the last, and a pop for every line", () => {
    const music = cues.filter((c) => c.kind === "music");

    expect(music[0]!.start).toBe(0);
    expect(Math.max(...music.map((c) => c.start + c.duration))).toBeCloseTo(end, 3);
    expect(cues.filter((c) => c.file === "message.ogg")).toHaveLength(T.msgs.length);
  });

  it("marks a pair slipping away and the group coming back", () => {
    const huddles = T.scenes.filter((s) => s.type === "huddle").length;

    expect(cues.filter((c) => c.file === "departure.ogg")).toHaveLength(huddles);
    expect(cues.filter((c) => c.file === "arrival.ogg").length).toBeGreaterThan(0);
  });
});

describe("film composition", () => {
  const T = timeline();
  const html = renderFilmComposition({ title: "A < B </script>", replay: replay(), ...choices, filmSeconds: T.duration, cues: [], fps: 30 });

  it("is one seekable timeline the length of the film plus the credits", () => {
    const total = T.duration + 0.5 + OUTRO_SECONDS;

    expect(html).toContain('data-composition-id="run-video"');
    expect(html).toContain(`data-duration="${total}"`);
    expect(html).toContain('data-width="1920" data-height="1080" data-fps="30"');
    expect(html).toContain('window.__timelines["run-video"] = tl;');
  });

  it("cannot be broken out of by the title or the replay text", () => {
    expect(html).toContain("A &lt; B &lt;/script&gt;");
    expect(html.match(/<\/script>/g)).toHaveLength(3);
  });

  it("carries the music credits the license asks for", () => {
    expect(html).toContain("Kevin MacLeod");
    expect(html).toContain("CC BY 4.0");
  });
});

describe("film project", () => {
  it("prepares an auditable project from a replay without rendering, and refuses to replace it", async () => {
    const root = await mkdtemp(join(tmpdir(), "perfectman-film-"));
    try {
      const input = join(root, "replay.json"), output = join(root, "film.mp4");
      await writeFile(input, catReplayJson());
      const result = await createFilmVideo({ input, output, prepareOnly: true, maxPulses: 6, pace: "fast" });
      const info = JSON.parse(await readFile(join(result.project, "film.json"), "utf8")) as { pulses: number; pace: string; messages: number; totalSeconds: number };
      const page = await readFile(join(result.project, "assets", "film.js"), "utf8");
      const css = await readFile(join(result.project, "assets", "film.css"), "utf8");

      expect(info.pulses).toBe(6);
      expect(info.pace).toBe("fast");
      expect(info.messages).toBeGreaterThan(0);
      expect(result.seconds).toBeCloseTo(info.totalSeconds, 5);
      expect(page).toContain("PerfectmanFilm");
      expect(css).toContain("Shantell Sans Variable");
      expect((await stat(join(result.project, "assets", "fonts", "fraunces-latin-full-italic.woff2"))).size).toBeGreaterThan(1000);
      expect((await stat(join(result.project, "assets", "audio", "calm-bossa-antigua.mp3"))).size).toBeGreaterThan(1000);
      await expect(createFilmVideo({ input, output, prepareOnly: true })).rejects.toThrow("already exists");
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);
});
