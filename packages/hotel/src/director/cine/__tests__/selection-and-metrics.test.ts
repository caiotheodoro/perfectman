import { describe, expect, it } from "vitest";
import { computeMetrics } from "../metrics.js";
import { expire, selectNext } from "../select.js";
import type { SelectContext } from "../select.js";
import { TrackRecorder, parseTrack } from "../track.js";
import { DEFAULT_CINE } from "../types.js";
import type { TrackEntry } from "../types.js";
import type { PerfectmanUi } from "../../generated.js";
import { item, line } from "./cine-helpers.js";

const ctx = (over: Partial<SelectContext> = {}): SelectContext => ({ now: 60_000, room: 12, roomSince: 50_000, followRef: undefined, cfg: DEFAULT_CINE, ...over });

describe("parallel editing (D38)", () => {
  it("plays a room's items in the order they arrived, even when a later one is more salient", () => {
    const first = line("duda", "um", { room: 12, salience: 0.2 });
    const second = line("rafa", "dois", { room: 12, salience: 0.95 });
    expect(selectNext([first, second], 0, ctx())).toBe(first);
  });

  it("cuts to the other room when its beat is clearly better, and stays when it is not", () => {
    const here = line("duda", "oi", { room: 12, salience: 0.3 });
    const strong = line("gabi", "Socorro!", { room: 13, salience: 0.95 });
    const mild = line("gabi", "hm", { room: 13, salience: 0.4 });
    expect(selectNext([here, strong], 0, ctx())).toBe(strong);
    expect(selectNext([here, mild], 0, ctx())).toBe(here);
  });

  it("does not leave a room that has only just been cut to, unless it has nothing left", () => {
    const here = line("duda", "oi", { room: 12, salience: 0.3 });
    const strong = line("gabi", "Socorro!", { room: 13, salience: 0.95 });
    expect(selectNext([here, strong], 0, ctx({ roomSince: 57_000 }))).toBe(here);
    expect(selectNext([strong], 0, ctx({ roomSince: 57_000 }))).toBe(strong);
  });

  it("follows a character through a door, and cuts away from a room that has held the screen too long", () => {
    const here = line("duda", "oi", { room: 12, salience: 0.5 });
    const there = line("leo", "ei", { room: 13, salience: 0.5 });
    expect(selectNext([here, there], 0, ctx({ followRef: "leo" }))).toBe(there);
    expect(selectNext([here, there], 0, ctx({ roomSince: 60_000 - DEFAULT_CINE.maxRoomHoldMs - 1 }))).toBe(there);
  });

  it("drops optional items that waited too long and keeps speech however old", () => {
    const walk = item("walk", { ref: "duda", room: 12, steps: 6, at: 0 });
    const oldLine = line("duda", "ainda vale", { at: 0 });
    const queue = [walk, oldLine];
    expect(expire(queue, 60_000, DEFAULT_CINE)).toEqual([walk]);
    expect(queue).toEqual([oldLine]);
  });
});

const camera = (avatar: number, ease = 450): PerfectmanUi => ({ k: "camera", shot: "close_up", target: { avatar }, zoom: 2, ease_ms: ease, hold_ms: 3000 });
const say = (t: number, avatar: number, room = 12, ms = 3000): TrackEntry => ({ t, k: "line", room, beat: `b${t}`, ref: "r", avatar, mode: "say", text: "oi", ms });
const cue = (t: number, ui: PerfectmanUi, room = 12, beat?: string): TrackEntry => ({ t, k: "cue", room, ui, ...(beat ? { beat } : {}) });

describe("director metrics", () => {
  it("counts a line as on-speaker only when the camera had finished easing onto them before it played", () => {
    const track: TrackEntry[] = [
      cue(0, camera(1)), say(1000, 1), // eased in by 450, speaker 1: yes
      cue(5000, camera(2)), say(5200, 2), // 200 ms after the cue, still easing: no
      say(9000, 3), // camera is still on 2: no
      cue(11_000, { k: "camera", shot: "two_shot", target: { pair: [3, 4] }, zoom: 2, ease_ms: 700, hold_ms: 3000 }), say(12_000, 4), // a pair they are in: yes
      cue(15_000, { k: "camera", shot: "establishing", target: { room: true }, zoom: "fit", ease_ms: 0, hold_ms: 1000 }), say(16_000, 4), // the room, not the speaker: no
    ];
    const m = computeMetrics(track);
    expect(m.shotOnSpeaker).toEqual({ onSpeaker: 2, lines: 5, ratio: 0.4 });
  });

  it("forgets the camera at a room cut, so a stale shot of the old room never counts", () => {
    const track: TrackEntry[] = [cue(0, camera(1)), { t: 2000, k: "cut", room: 13, from: 12 }, say(4000, 1, 13)];
    expect(computeMetrics(track).shotOnSpeaker.onSpeaker).toBe(0);
  });

  it("finds stretches with nothing to read or hear, and ignores paused time", () => {
    const track: TrackEntry[] = [
      { t: 0, k: "start", run: 1, room: 12, lang: "pt-BR" },
      say(1000, 1, 12, 3000), // busy 1000-4000
      say(16_000, 1, 12, 3000), // gap 4000-16000 = 12 s over the limit
      { t: 20_000, k: "pause" },
      { t: 60_000, k: "resume" },
      say(64_000, 1, 12, 3000), // 40 s paused, then 60-64 = 4 s of gap
      { t: 67_000, k: "end", reason: "stopped" },
    ];
    const m = computeMetrics(track);
    expect(m.deadAir.gapsOverLimit).toBe(1);
    expect(m.deadAir.totalOverLimitMs).toBe(12_000);
    expect(m.deadAir.maxGapMs).toBe(12_000);
  });

  it("counts a card, a caption and a transition effect as something on screen", () => {
    const track: TrackEntry[] = [
      { t: 0, k: "start", run: 1, room: 12, lang: "en" },
      cue(0, { k: "card", kind: "title", title: "T", ms: 8000 }),
      cue(8000, { k: "caption", text: "x", ms: 8000 }, 12, "filler:1"),
      cue(16_000, { k: "cut_fx", kind: "fade", ms: 600 }),
      { t: 16_600, k: "end", reason: "completed" },
    ];
    const m = computeMetrics(track);
    expect(m.deadAir.gapsOverLimit).toBe(0);
    expect(m.fillers).toBe(1);
  });

  it("measures cut rate per minute, shot lengths within a room and jitter", () => {
    const track: TrackEntry[] = [
      { t: 0, k: "start", run: 1, room: 12, lang: "en" },
      cue(0, camera(1)), cue(1000, camera(2)), cue(6000, camera(1)),
      { t: 8000, k: "cut", room: 13, from: 12 },
      cue(8100, camera(3), 13),
      { t: 60_000, k: "end", reason: "stopped" },
    ];
    const m = computeMetrics(track, { minShotMs: 1800 });
    expect(m.cuts).toMatchObject({ shots: 4, shortShots: 1, roomCuts: 1, minShotMs: 1000 });
    expect(m.cuts.shotsPerMin).toBeCloseTo(4, 5);
    expect(m.cuts.roomCutsPerMin).toBeCloseTo(1, 5);
  });
});

describe("the director track", () => {
  it("round-trips through JSONL in playback order", () => {
    const sunk: string[] = [];
    const rec = new TrackRecorder((l) => sunk.push(l));
    rec.add(say(2000, 1));
    rec.add({ t: 500, k: "drop", beat: "b9", why: "stale" });
    expect(sunk).toHaveLength(2);
    const back = parseTrack(rec.toJsonl());
    expect(back.map((e) => e.t)).toEqual([500, 2000]);
    expect(back[1]).toMatchObject({ k: "line", avatar: 1 });
  });
});
