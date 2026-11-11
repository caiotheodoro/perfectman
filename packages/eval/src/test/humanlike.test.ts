import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDramaSim } from "../embodiment/drama-sim.js";
import { MEASURE, computeHumanlike, quantiles } from "../humanlike/metrics.js";
import { renderBaselineMarkdown, renderRow } from "../humanlike/report.js";
import { loadRunTrace } from "../humanlike/run-trace.js";
import { PREVIEW_ARMS, runArm } from "../humanlike/preview-run.js";
import { run63Config } from "../humanlike/run63-preview.js";
import { BANDS, bandScore, scoreHumanlike } from "../humanlike/score.js";
import type { HumanTrace, TraceEvent } from "../humanlike/trace.js";
import { bearing, dirDiffDeg } from "../humanlike/trace.js";

const A = "person-1";
const B = "person-2";

/** Two actors who face each other 2 tiles apart and talk, with whatever else a test adds. */
function trace(events: TraceEvent[], over: Partial<HumanTrace> = {}): HumanTrace {
  const base: TraceEvent[] = [
    { t: 0, kind: "pos", ref: A, tile: [4, 4], dir: 2, state: "stand" },
    { t: 0, kind: "pos", ref: B, tile: [6, 4], dir: 6, state: "stand" },
  ];
  return { run: "t", source: "run", sceneStartMs: 1000, durationMs: 59_000, actors: [{ ref: A, name: "A", human: false }, { ref: B, name: "B", human: false }], events: [...base, ...events].sort((a, b) => a.t - b.t), ...over };
}
const say = (t: number, ref: string, to: string, text: string): TraceEvent => ({ t, kind: "chat", ref, to, text, mode: "say" });

describe("geometry the metrics share with the hotel", () => {
  it("bearing and facing follow Tilehouse: 0 is toward -y, clockwise", () => {
    expect(bearing([4, 4], [4, 1])).toBe(0);
    expect(bearing([4, 4], [7, 4])).toBe(2);
    expect(bearing([4, 4], [4, 9])).toBe(4);
    expect(dirDiffDeg(7, 1)).toBe(90);
  });
});

describe("the human-likeness metrics", () => {
  it("reads the distance at each line against the bands, and a same-tile line", () => {
    const m = computeHumanlike(trace([say(2000, A, B, "oi tudo bem por aqui"), { t: 5000, kind: "pos", ref: B, tile: [4, 4], dir: 6, state: "stand" }, say(6000, A, B, "e agora")]));
    expect(m.distance.n).toBe(2);
    expect(m.distance.hist).toEqual({ "2": 1, "0": 1 });
    expect(m.distance.sameTile).toBe(1);
    expect(m.distance.bandShare?.intimate).toBe(0.5);
    expect(m.distance.bandShare?.personal).toBe(0.5);
  });

  it("counts a stack only when two avatars share a tile for a second or more", () => {
    const flick = computeHumanlike(trace([{ t: 5000, kind: "pos", ref: B, tile: [4, 4], dir: 6, state: "stand" }, { t: 5400, kind: "pos", ref: B, tile: [6, 4], dir: 6, state: "stand" }, say(2000, A, B, "oi")]));
    expect(flick.stacking.events).toBe(0);
    const held = computeHumanlike(trace([{ t: 5000, kind: "pos", ref: B, tile: [4, 4], dir: 6, state: "stand" }, { t: 9000, kind: "pos", ref: B, tile: [6, 4], dir: 6, state: "stand" }, say(2000, A, B, "oi")]));
    expect(held.stacking.events).toBe(1);
    expect(held.stacking.ms).toBeGreaterThanOrEqual(3750);
    expect(held.stacking.perActorHour).toBeGreaterThan(0);
  });

  it("measures whether the speaker and the listener face each other, and a look away that comes back", () => {
    const m = computeHumanlike(
      trace([
        say(2000, A, B, "uma frase qualquer para olhar"),
        { t: 2500, kind: "pos", ref: A, tile: [4, 4], dir: 4, state: "stand" },
        { t: 4800, kind: "pos", ref: A, tile: [4, 4], dir: 2, state: "stand" },
        say(20_000, B, A, "outra frase"),
        { t: 20_200, kind: "pos", ref: A, tile: [4, 4], dir: 0, state: "stand" },
      ]),
    );
    expect(m.gaze.n).toBe(2);
    expect(m.gaze.breakReturnRate).toBe(0.5);
    expect(m.gaze.speakerRate).toBe(0.5);
    expect(m.gaze.listenerRate).toBe(0.5);
  });

  it("measures the reaction latency from the line to the reply's first key, and a line that lands on the last one", () => {
    const events: TraceEvent[] = [
      say(2000, A, B, "primeira fala, bem longa para durar um tempo na tela do ator"),
      { t: 3500, kind: "typing", ref: B, on: true },
      say(6000, B, A, "resposta"),
      { t: 7000, kind: "typing", ref: A, on: true },
      say(9000, A, B, "treplica"),
    ];
    const m = computeHumanlike(trace(events));
    expect(m.latency.startTyping.p50).toBe(1250);
    expect(m.latency.lineToLine.n).toBe(2);
    expect(m.overlap.n).toBe(1);
    expect(quantiles([1, 2, 3, 4, 5]).p50).toBe(3);
  });

  it("reads a dash as an interrupted line, and bubble time against line length", () => {
    const texts = ["curta", "uma frase de tamanho médio aqui", "uma frase consideravelmente maior que as outras duas juntas, de verdade mesmo", "e por fim uma frase ainda bem mais longa do que todas as outras que vieram antes dela nesta cena"];
    const events: TraceEvent[] = [];
    texts.forEach((text, i) => {
      const t = 3000 + i * 10_000;
      events.push({ t: t - text.length * 40, kind: "typing", ref: A, on: true }, say(t, A, B, i === 1 ? `${text.slice(0, 12)}—` : text));
    });
    const m = computeHumanlike(trace(events));
    expect(m.interruption.n).toBe(1);
    expect(m.typing.lengthCorrelation).toBeGreaterThan(0.8);
    expect(m.typing.medianMs).toBeGreaterThan(0);
  });

  it("counts a gesture with the line and a silent answer from the listener, but not a plain turn of the head to the speaker", () => {
    const events: TraceEvent[] = [
      say(2000, A, B, "uma fala com mais de cinco palavras para responder"),
      { t: 2600, kind: "gesture", ref: A, a: "wave" },
      { t: 3200, kind: "expression", ref: B, face: "surprised" },
      say(12_000, B, A, "outra fala com mais de cinco palavras para responder"),
    ];
    const m = computeHumanlike(trace(events));
    expect(m.gesture.perLine).toBe(0.5);
    expect(m.gesture.byKind).toEqual({ wave: 1 });
    expect(m.backchannel.n).toBe(2);
    expect(m.backchannel.rate).toBe(0.5);
  });

  it("counts walks and the idle motion of an actor nobody is talking to, and a frozen minute", () => {
    const quiet = computeHumanlike(trace([say(2000, A, B, "oi")], { durationMs: 59_000 }));
    expect(quiet.idle.frozenShare).toBe(1);
    expect(quiet.walks.total).toBe(0);
    const moving = computeHumanlike(
      trace([
        say(2000, A, B, "oi"),
        { t: 20_000, kind: "pos", ref: B, tile: [6, 5], dir: 4, state: "walk" },
        { t: 20_600, kind: "pos", ref: B, tile: [6, 6], dir: 4, state: "stand" },
        { t: 40_000, kind: "pos", ref: B, tile: [6, 5], dir: 0, state: "walk" },
        { t: 40_600, kind: "pos", ref: B, tile: [6, 4], dir: 0, state: "stand" },
      ]),
    );
    expect(moving.walks.total).toBe(2);
    expect(moving.idle.reversalsPerActorHour).toBe(0);
    expect(moving.idle.frozenShare).toBeLessThan(1);
    expect(MEASURE.frozenWindowMs).toBe(10_000);
  });
});

describe("the score", () => {
  it("is 1 inside a band, falls to 0 half a band-width outside it, and every band names its source", () => {
    expect(bandScore(0.8, 0.7, 0.95)).toBe(1);
    expect(bandScore(0.575, 0.7, 0.95)).toBeCloseTo(0, 5);
    expect(bandScore(0.1, 0, 0.5)).toBe(1);
    expect(BANDS.every((b) => ["prior", "corpus", "runs"].includes(b.src) && b.note.length > 10)).toBe(true);
    expect(BANDS.filter((b) => b.src === "corpus").map((b) => b.key)).toEqual(["interruption.rate", "walks.perActorMin"]);
  });

  it("a frozen, unreacting scene scores far below a lively one and neither leaves the 0 to 100 range", () => {
    const stiff: TraceEvent[] = [];
    for (let i = 0; i < 12; i++) stiff.push({ t: 1000 + i * 3000, kind: "typing", ref: i % 2 ? B : A, on: true }, say(1500 + i * 3000, i % 2 ? B : A, i % 2 ? A : B, "uma fala com mais de cinco palavras para responder agora"));
    const dead = scoreHumanlike(computeHumanlike(trace(stiff, { durationMs: 58_000 })));
    const events: TraceEvent[] = [];
    for (let i = 0; i < 12; i++) {
      const t = 3000 + i * 4800;
      const speaker = i % 2 ? B : A;
      const to = i % 2 ? A : B;
      events.push({ t: t - 1600, kind: "typing", ref: speaker, on: true }, say(t, speaker, to, i % 3 === 0 ? "uma fala com mais de cinco palavras para responder agora" : "uma fala curta aqui, ok"));
      events.push({ t: t + 700, kind: "gesture", ref: speaker, a: "thumbs" }, { t: t + 1200, kind: "expression", ref: to, face: "smile" });
      events.push({ t: t + 2500, kind: "pos", ref: to, tile: i % 2 ? [4, 4] : [6, 4], dir: i % 2 ? 2 : 6, state: "stand" });
    }
    const lively = scoreHumanlike(computeHumanlike(trace(events, { durationMs: 58_000 })));
    expect(lively.score).toBeGreaterThan(dead.score + 8);
    expect(dead.score).toBeGreaterThanOrEqual(0);
    expect(lively.score).toBeLessThanOrEqual(100);
    expect(lively.scored).toBeGreaterThan(10);
  });
});

describe("a real run's folder as a trace", () => {
  it("reads positions, facing, typing, lines with their addressee, faces and gestures, and the cast apart from guests", () => {
    const dir = mkdtempSync(join(tmpdir(), "humanlike-"));
    const out = (t: number, frame: Record<string, unknown>) => JSON.stringify({ conn: 1, dir: "out", frame, run: 9, ts_ms: 1_000_000 + t });
    const inn = (t: number, frame: Record<string, unknown>) => JSON.stringify({ conn: 1, dir: "in", frame, run: 9, ts_ms: 1_000_000 + t });
    const delta = (t: number, msg: Record<string, unknown>) => out(t, { t: "delta", room: 5, rev: 1, seq: 1, msg });
    const lines = [
      delta(0, { t: "avatar_joined", avatar: { id: -1, name: "Ana", x: 1, y: 1, dir: 2, state: "stand" } }),
      out(1, { t: "actor_spawned", actor: -1, ref: "person-1", room: 5, x: 1, y: 1, dir: 2 }),
      delta(2, { t: "avatar_joined", avatar: { id: -2, name: "Bia", x: 3, y: 1, dir: 6, state: "stand" } }),
      out(3, { t: "actor_spawned", actor: -2, ref: "person-2", room: 5, x: 3, y: 1, dir: 6 }),
      delta(4, { t: "avatar_joined", avatar: { id: 40, name: "Gui", x: 9, y: 9, dir: 0, state: "stand" } }),
      delta(1000, { t: "typing", id: -1, on: true }),
      delta(2500, { t: "chat", from: -1, mode: "say", name: "Ana", text: "oi, Bia" }),
      delta(2600, { t: "moves", moves: [{ id: -2, x: 3, y: 1, dir: 7, state: "stand" }] }),
      delta(3000, { t: "avatar_action", id: -2, action: "expression", style: 1 }),
      delta(3100, { t: "avatar_action", id: -2, action: "wave" }),
      inn(3200, { t: "actor_cmd", actor: -2, cmd: { k: "face", tile: [1, 1] } }),
      delta(3300, { t: "chat", from: -2, mode: "thought", name: "Bia", text: "hm" }),
    ];
    writeFileSync(join(dir, "frames.jsonl"), `${lines.join("\n")}\n`);
    writeFileSync(join(dir, "replay.json"), JSON.stringify({ home: 5, run: 9 }));
    writeFileSync(join(dir, "body-frames.json"), JSON.stringify({ frames: [{ atMs: 1_002_500, dir: "out", kind: "chat", data: { agentId: "person-1", toRef: "person-2", mode: "say" } }], snapshots: [] }));
    const t = loadRunTrace(dir, "9");
    expect(t.actors).toEqual([{ ref: "person-1", name: "Ana", human: false }, { ref: "person-2", name: "Bia", human: false }, { ref: "h:40", name: "Gui", human: true }]);
    expect(t.events.find((e) => e.kind === "chat")).toMatchObject({ ref: "person-1", to: "person-2", text: "oi, Bia" });
    expect(t.events.filter((e) => e.kind === "chat")).toHaveLength(1);
    expect(t.events.find((e) => e.kind === "expression")).toMatchObject({ ref: "person-2", face: "smile" });
    expect(t.events.find((e) => e.kind === "gesture")).toMatchObject({ a: "wave" });
    expect(t.events.find((e) => e.kind === "cmd")).toMatchObject({ ref: "person-2", cmd: "face" });
    expect(t.sceneStartMs).toBe(2500);
  });

  it("renders a row and the baseline page without throwing on a run with nothing in it", () => {
    const m = computeHumanlike(trace([]));
    const row = { metrics: m, score: scoreHumanlike(m) };
    expect(renderRow(row)).toContain("human-likeness");
    expect(renderBaselineMarkdown("t", [row], "n")).toContain("| band |");
  });
});

describe("the preview sim: run 63 on the Terraço", () => {
  it("is the same on every run for one seed, and the arm at 0 writes no body log", () => {
    const a = runArm(0.6, { seed: 3, durationMs: 120_000 });
    const b = runArm(0.6, { seed: 3, durationMs: 120_000 });
    expect(JSON.stringify(a.sim.trace?.events)).toBe(JSON.stringify(b.sim.trace?.events));
    expect(a.sim.bodyLog.length).toBeGreaterThan(5);
    expect(a.sim.bodyLog.every((e) => typeof e.t_ms === "number" && e.rule.length > 0)).toBe(true);
    expect(runArm(0, { seed: 3, durationMs: 120_000 }).sim.bodyLog).toEqual([]);
    expect(PREVIEW_ARMS).toEqual([0, 0.6, 1]);
  });

  it("at human_likeness 0 the body is exactly what it was: the commands equal a sim with no human layer", () => {
    const off = runDramaSim({ ...run63Config(0, { film: false, durationMs: 150_000 }), humanLike: undefined });
    const zero = runDramaSim({ ...run63Config(0, { film: false, durationMs: 150_000 }), humanLike: { likeness: 0, film: false } });
    expect(zero.lines.map((l) => JSON.stringify(l.frame))).toEqual(off.lines.map((l) => JSON.stringify(l.frame)));
    expect(zero.speech).toEqual(off.speech);
  });

  it("the default 0.6 beats the old body on the things the owner asked for, on every seed tried", () => {
    for (const seed of [1, 2, 3]) {
      const old = runArm(0, { seed, durationMs: 300_000 });
      const now = runArm(0.6, { seed, durationMs: 300_000 });
      expect(now.metrics.gesture.perLine ?? 0).toBeGreaterThan(old.metrics.gesture.perLine ?? 0);
      expect(now.metrics.backchannel.rate ?? 0).toBeGreaterThan(old.metrics.backchannel.rate ?? 0);
      expect(now.metrics.typing.lengthCorrelation ?? 0).toBeGreaterThan(old.metrics.typing.lengthCorrelation ?? 0);
      expect(now.metrics.idle.frozenShare ?? 1).toBeLessThan(old.metrics.idle.frozenShare ?? 0);
      expect(now.metrics.stacking.events).toBe(0);
      expect(now.metrics.idle.reversalsPerActorHour).toBeLessThanOrEqual(4);
      expect(now.score.score).toBeGreaterThan(old.score.score);
    }
  });
});
