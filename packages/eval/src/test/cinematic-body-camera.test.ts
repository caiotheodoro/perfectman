import { describe, expect, it } from "vitest";
import {
  fallbackNorms,
  groupOf,
  loadRunBundle,
  proximityChanges,
  scoreCamera,
  scoreEmbodiment,
  shotOnSpeaker,
} from "../cinematic/index.js";
import { CAST, flatScene, goodScene, writeRun, type FxSpec } from "./cinematic-fixtures.js";

const norms = fallbackNorms();
const load = (spec: FxSpec) => loadRunBundle(writeRun(spec));
const reading = (g: { readings: Array<{ metric: string; value: number | null; score: number | null }> }, m: string) => g.readings.find((r) => r.metric === m)!;

describe("embodiment", () => {
  it("acts per minute counts the acts on screen only", () => {
    const b = load({
      durationS: 120,
      acts: [{ tS: 10, verb: "glare", actor: "p1", target: "p2" }, { tS: 40, verb: "insult", actor: "p1", target: "p2" }, { tS: 70, verb: "shove", actor: "p1", target: "p2", outcome: "aborted" }],
    });
    const g = scoreEmbodiment(b, norms);
    expect(reading(g, "actsPerMin").value).toBe(1);
    expect(g.detail["actsNotPlayed"]).toBe(1);
  });

  it("flags spam of one verb and rewards a wide ladder", () => {
    const spam = load({ durationS: 120, acts: Array.from({ length: 5 }, (_, i) => ({ tS: 10 + i * 20, verb: "glare", actor: "p1", target: "p2" })) });
    const wide = load({ durationS: 120, acts: ["glare", "insult", "shove", "slap"].map((verb, i) => ({ tS: 10 + i * 20, verb, actor: "p1", target: "p2" })) });
    expect(reading(scoreEmbodiment(spam, norms), "topVerbShare")).toMatchObject({ value: 1, score: 0 });
    expect(reading(scoreEmbodiment(wide, norms), "ladderSpan")).toMatchObject({ value: 3, score: 100 });
    expect(reading(scoreEmbodiment(wide, norms), "distinctVerbs").value).toBe(4);
  });

  it("reaction integrity is the share of owed reactions not missed, and absent when none were owed", () => {
    const ok = load({ durationS: 60, acts: [{ tS: 5, verb: "slap", actor: "p1", target: "p2", owed: 2, reactions: 2 }] });
    const bad = load({ durationS: 60, acts: [{ tS: 5, verb: "slap", actor: "p1", target: "p2", owed: 2, reactions: 0, missed: 2 }] });
    const none = load({ durationS: 60, acts: [{ tS: 5, verb: "cry", actor: "p1" }] });
    expect(reading(scoreEmbodiment(ok, norms), "reactionIntegrity").value).toBe(1);
    expect(reading(scoreEmbodiment(bad, norms), "reactionIntegrity")).toMatchObject({ value: 0, score: 0 });
    expect(reading(scoreEmbodiment(none, norms), "reactionIntegrity").score).toBeNull();
  });

  it("counts faces and gestures, but neutral-only faces and stop/stand are not variety", () => {
    const g = scoreEmbodiment(
      load({
        durationS: 60,
        cmds: [
          { tS: 1, ref: "p1", cmd: { k: "expression", face: "angry" } },
          { tS: 2, ref: "p1", cmd: { k: "expression", face: "sad" } },
          { tS: 3, ref: "p1", cmd: { k: "action", action: "wave" } },
          { tS: 4, ref: "p1", cmd: { k: "action", action: "stop" } },
          { tS: 5, ref: "p1", cmd: { k: "action", action: "stand" } },
        ],
      }),
      norms,
    );
    expect(reading(g, "distinctFaces").value).toBe(2);
    expect(reading(g, "distinctGestures").value).toBe(1);
  });

  it("entrances are walks on an enter plan; exits are mid-scene, not the stop command clearing the stage", () => {
    const enter = (ref: string, tS: number) => ({ tS, ref, cmd: { k: "walk", plan: `${ref}:enter`, x: 3, y: 3 } });
    const g = scoreEmbodiment(load({ durationS: 100, cmds: [enter("p1", 1), enter("p2", 2)], moveRooms: [{ tS: 50, ref: "p2" }, { tS: 95, ref: "p1" }] }), norms);
    expect(reading(g, "entranceShare").value).toBeCloseTo(2 / 3, 3);
    expect(reading(g, "exits").value).toBe(1);
  });

  it("proximity changes count a pair crossing touching / talking / across the room", () => {
    const b = load({ durationS: 100 });
    b.arrivals = [
      { tS: 1, actor: "Ana", x: 0, y: 0 },
      { tS: 2, actor: "Bruno", x: 1, y: 0 }, // touching
      { tS: 10, actor: "Bruno", x: 4, y: 0 }, // talking: change 1
      { tS: 20, actor: "Bruno", x: 12, y: 0 }, // across the room: change 2
      { tS: 30, actor: "Bruno", x: 12, y: 1 }, // same band: none
    ];
    expect(proximityChanges(b)).toBe(2);
  });

  it("scores the good scene near the top, and a body that barely moves low", () => {
    const good = scoreEmbodiment(load(goodScene()), norms);
    const flat = scoreEmbodiment(load(flatScene()), norms);
    expect(good.score!).toBeGreaterThan(90);
    expect(flat.score!).toBeLessThan(30);
  });

  it("a scene with one act cannot be carried by its faces and walks (core cap)", () => {
    const g = scoreEmbodiment(
      load({
        durationS: 450,
        acts: [{ tS: 10, verb: "glare", actor: "p1", target: "p2" }],
        cmds: [
          ...["smile", "angry", "sad", "surprised"].map((f, i) => ({ tS: i + 1, ref: "p1", cmd: { k: "expression", face: f } })),
          ...["wave", "laugh", "sign"].map((a, i) => ({ tS: i + 5, ref: "p1", cmd: { k: "action", action: a } })),
          ...CAST.map((c, i) => ({ tS: i, ref: c.ref, cmd: { k: "walk", plan: `${c.ref}:enter`, x: 3, y: 3 } })),
        ],
      }),
      norms,
    );
    expect(g.score!).toBeLessThanOrEqual(40);
  });

  it("groupOf holds a group to its weakest core reading plus 40, records the cap, and leaves the rest alone", () => {
    const r = (metric: string, score: number | null, weight = 1) => ({ metric, value: score, score, weight, note: "" });
    const capped = groupOf("embodiment", [r("core", 10), r("a", 100), r("b", 100), r("c", 100)], {}, ["core"]);
    expect(capped.score).toBe(50);
    expect(capped.detail["coreCap"]).toBe(50);
    const free = groupOf("embodiment", [r("core", 80), r("a", 100)], {}, ["core"]);
    expect(free.score).toBe(90);
    expect(free.detail["coreCap"]).toBeUndefined();
    // a reading with no score is left out of the mean, and a group with none is null
    expect(groupOf("arc", [r("x", null), r("y", 60)]).score).toBe(60);
    expect(groupOf("arc", [r("x", null)]).score).toBeNull();
  });
});

describe("camera", () => {
  it("shot-on-speaker needs the camera finished easing on the speaker in the same room, and no cut since", () => {
    const base: FxSpec = { durationS: 60, trackLines: [{ tMs: 10_000, ms: 3000, ref: "p1" }] };
    const on = load({ ...base, cues: [{ tMs: 8000, shot: "close_up", ref: "p1", easeMs: 500 }] });
    const early = load({ ...base, cues: [{ tMs: 9800, shot: "close_up", ref: "p1", easeMs: 500 }] });
    const wrong = load({ ...base, cues: [{ tMs: 8000, shot: "close_up", ref: "p2" }] });
    const pair = load({ ...base, cues: [{ tMs: 8000, shot: "two_shot", pairRefs: ["p1", "p2"] }] });
    const est = load({ ...base, cues: [{ tMs: 8000, shot: "establishing", ref: "p1" }] });
    const cut = load({ ...base, cues: [{ tMs: 8000, shot: "close_up", ref: "p1" }], cuts: [{ tMs: 9000 }] });
    const room = load({ ...base, cues: [{ tMs: 8000, shot: "close_up", ref: "p1", room: 5 }] });
    expect(shotOnSpeaker(on.camera!).ratio).toBe(1);
    expect(shotOnSpeaker(early.camera!).ratio).toBe(0);
    expect(shotOnSpeaker(wrong.camera!).ratio).toBe(0);
    expect(shotOnSpeaker(pair.camera!).ratio).toBe(1);
    expect(shotOnSpeaker(est.camera!).ratio).toBe(0);
    expect(shotOnSpeaker(cut.camera!).ratio).toBe(0);
    expect(shotOnSpeaker(room.camera!).ratio).toBe(0);
  });

  it("stale drop rate is lost cues over everything queued, and a run-end drop does not count", () => {
    const b = load({
      durationS: 60,
      otherCues: 6,
      cues: [{ tMs: 1000, shot: "close_up", ref: "p1" }, { tMs: 5000, shot: "two_shot", pairRefs: ["p1", "p2"] }],
      drops: [{ tMs: 2000, why: "stale" }, { tMs: 3000, why: "unstageable" }, { tMs: 59_000, why: "stopped" }],
    });
    const g = scoreCamera(b, norms);
    // 8 cues shown + 2 lost
    expect(reading(g, "staleDropRate").value).toBeCloseTo(0.2, 3);
    expect(g.detail["lost"]).toBe(2);
  });

  it("variety and cut rate: one shot kind scores 0, five kinds at a film's pace score 100", () => {
    const g1 = scoreCamera(load(flatScene()), norms);
    const g2 = scoreCamera(load(goodScene()), norms);
    expect(reading(g1, "distinctShots")).toMatchObject({ value: 1, score: 0 });
    expect(reading(g2, "distinctShots")).toMatchObject({ value: 5, score: 100 });
    expect(reading(g2, "shotsPerMin").score).toBe(100);
  });

  it("a run with no director track has no camera score", () => {
    const g = scoreCamera(load({ durationS: 30, noTrack: true, lines: [{ tS: 1, ref: "p1", text: "hi" }] }), norms);
    expect(g.score).toBeNull();
  });

  it("shots shorter than 1.8 s are jitter", () => {
    const b = load({ durationS: 30, cues: [0, 1000, 2000, 3000, 10_000].map((tMs) => ({ tMs, shot: "close_up", ref: "p1" })) });
    // spans 1000, 1000, 1000, 7000 -> 3 of 4 short
    expect(reading(scoreCamera(b, norms), "shortShotShare").value).toBe(0.75);
  });
});
