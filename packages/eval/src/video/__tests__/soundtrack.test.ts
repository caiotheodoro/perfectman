import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AUDIO_CREDITS, planSoundtrack, renderSoundtrack } from "../soundtrack.js";
import type { VideoBeat, VideoStoryboard, RecordedEmotion } from "../types.js";

function board(duration: number, inputs: Array<{ start: number; emotion?: RecordedEmotion } & Partial<VideoBeat>> = []): VideoStoryboard {
  const beats = inputs.map((input, index) => ({
    id: `step-${index}`, phase: "Simulation", kind: "message", text: "Hello.", actorId: "ada", visibility: "public",
    sourceRefs: [`/steps/${index}`], stepIndex: index, pageIndex: 0, pageCount: 1, duration: 2,
    ...input,
  })) as VideoBeat[];
  return { title: "Room", sourceKind: "script", agents: [{ id: "ada", name: "Ada" }], steps: [], beats,
    notices: [], version: "perfectman-storyboard-v1", sourceFile: "script.json", sourceSha256: "hash", duration, fps: 30 };
}
const authored = (label: string): RecordedEmotion => ({ source: "authored", label });

describe("soundtrack", () => {
  it("uses a calm score for unknown labels and arousal or salience alone", () => {
    for (const emotion of [undefined, authored("quantum"), { source: "snapshot" as const, values: { arousal: .99 } }]) {
      const music = planSoundtrack(board(30, [{ start: 3, emotion }])).filter(cue => cue.kind === "music");
      expect(music.map(cue => cue.mood)).toEqual(["calm"]);
      expect(music[0]?.volume).toBeCloseTo(.153, 2);
    }
  });

  it("does not move a recorded emotion backward and holds mood through unlabelled steps", () => {
    const music = planSoundtrack(board(40, [
      { start: 2 }, { start: 12, emotion: authored("angry") }, { start: 18 },
      { start: 24, emotion: { source: "driver", drivers: ["affection"] } },
    ])).filter(cue => cue.kind === "music");
    expect(music.map(cue => [cue.start, cue.mood])).toEqual([[0, "calm"], [12, "tension"], [24, "warmth"]]);
    expect(music[0]?.duration).toBe(14);
    expect(music[1]?.reason).toContain("Authored: angry at step 2");
  });

  it("does not flap on brief changes and lets explicit unknown cues return to calm", () => {
    const music = planSoundtrack(board(40, [
      { start: 2, emotion: authored("angry") }, { start: 4, emotion: authored("happy") },
      { start: 6, emotion: authored("angry") }, { start: 12, emotion: authored("unknown") },
    ])).filter(cue => cue.kind === "music");
    expect(music.map(cue => [cue.start, cue.mood])).toEqual([[0, "calm"], [2, "tension"], [12, "calm"]]);
  });

  it("restarts long tracks with bounded overlapping fades and ordered cues", () => {
    const cues = planSoundtrack(board(1000));
    expect(cues).toHaveLength(5);
    expect(cues.every(cue => cue.start >= 0 && cue.start + cue.duration <= 1000 && cue.mediaStart === 0)).toBe(true);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.start).toBeGreaterThan(cues[i - 1]!.start);
      expect(cues[i - 1]!.start + cues[i - 1]!.duration - cues[i]!.start).toBeCloseTo(2, 6);
    }
    expect(cues.at(-1)!.start + cues.at(-1)!.duration).toBe(1000);
  });

  it("adds message sounds once per step and arrival/departure sounds only for explicit actions", () => {
    const cues = planSoundtrack(board(40, [
      { start: 2, stageAction: { kind: "arrive", agentIds: ["ada"] } },
      { start: 5, pageIndex: 1, pageCount: 2, stepIndex: 0 },
      { start: 10, kind: "event", presence: "offline", text: "I leave" },
      { start: 15, kind: "event", stageAction: { kind: "leave", agentIds: ["ada"] } },
      { start: 20, kind: "event", stageAction: { kind: "invite", agentIds: ["nox"] } },
    ])).filter(cue => cue.kind === "sfx");
    expect(cues.map(cue => cue.file).sort()).toEqual(["arrival.ogg", "departure.ogg", "message.ogg"]);
    expect(cues.every(cue => cue.volume <= .15)).toBe(true);
  });

  it("writes linear clip-local automation at absolute gains on distinct tracks", () => {
    const cues = planSoundtrack(board(20, [{ start: 3 }]));
    const html = renderSoundtrack(cues);
    const lanes = [...html.matchAll(/data-automation="([^"]+)"/g)].map(match => JSON.parse(match[1]!.replaceAll("&quot;", '"')));
    const music = lanes[0].lanes[0];
    expect(music.target).toBe("volume");
    expect(music.points).toEqual([{ t: 0, v: 0 }, { t: 2, v: cues[0]!.volume }, { t: 18, v: cues[0]!.volume }, { t: 20, v: 0 }]);
    expect(html).toContain('data-media-start="0"');
    expect(new Set([...html.matchAll(/data-track-index="(\d+)"/g)].map(match => match[1])).size).toBe(cues.length);
    expect(() => planSoundtrack(board(Infinity))).toThrow("finite");
    expect(() => renderSoundtrack([{ ...cues[0]!, file: "../secret.mp3" }])).toThrow("Invalid");
  });

  it("ships attributed assets whose local content matches the recorded hashes", async () => {
    const root = new URL("../../../assets/video/audio/", import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8")) as Array<{ path: string; sha256: string; license: string; source: string }>;
    expect(manifest).toHaveLength(6);
    for (const entry of manifest) {
      expect(createHash("sha256").update(await readFile(new URL(entry.path, root))).digest("hex")).toBe(entry.sha256);
      expect(entry.source).toMatch(/^https:\/\/(incompetech.com|kenney.nl)\//);
      expect(["CC BY 4.0", "CC0 1.0"]).toContain(entry.license);
    }
    expect(AUDIO_CREDITS).toContain("Kevin MacLeod");
    expect(await readFile(new URL("ATTRIBUTION.md", root), "utf8")).toContain("Re-encoded complete track");
  });
});
