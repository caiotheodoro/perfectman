/**
 * The drama decision log (errata P9): the format of a line, the writer's collapsing of identical consults and its cap, what the director says of each `decide`, what the body writes at
 * each consult, and the run's artifact (`drama_log`, `PERFECTMAN_DRAMA_LOG=0`).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DRAMA_LOG_CAP, DramaLog, dramaLogLine } from "../director/drama/decision-log.js";
import type { DramaLogEntry, DramaLogLine } from "../director/drama/decision-log.js";
import { A, B, C, H, WIDE_BLOCK, emotion, makeRig } from "../testing/drama-rig.js";
import { FakePort, ZERO_ACT, handles, intent, rig } from "../testing/drama-body-rig.js";
import { feedFrames } from "../testing/drama-feed.js";
import { actFrames } from "../testing/fake-drama.js";
import { DRAMA_LOG_FILE, writeRunArtifacts } from "../run/artifacts.js";
import { RunDramaLog, dramaLogEnabled } from "../run/drama-log.js";

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "drama-log-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["PERFECTMAN_DRAMA_LOG"];
});

/** Every tendency of the ladder up, as the scene seeds a cast that is out for blood. */
const HOT_TENDENCIES = { jealousInspection: 0.9, resentfulColdness: 0.9, contemptuousDismissal: 0.9, impulsiveProvocation: 0.9, dominanceAssertion: 0.9, defensiveness: 0.5 };

const entry = (o: Partial<DramaLogEntry> = {}): DramaLogEntry => ({ actor: "person-3", kind: "originate", unlocked: 0, queue: 0, hold: false, result: "no_candidates", ...o });

describe("dramaLogLine", () => {
  it("is one JSON line with a fixed key order: t_ms, actor, kind, pair, verb, rung, v, theta, unlocked, unlock, grievance, provocation, dist, queue, hold, result, reason", () => {
    const line = dramaLogLine(12_345.6, entry({ kind: "continue", pair: "person-3>person-2", verb: "shove", rung: 3, v: 0.95123, theta: 0.6666, unlocked: 3, unlock: "person-3>person-2@3", grievance: 0.0801, provocation: 0.8349, dist: 4, queue: 1, hold: true, result: "blocked:ladder/contagion", reason: "LAD-10" }), 0);
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toEqual({ t_ms: 12346, actor: "person-3", kind: "continue", pair: "person-3>person-2", verb: "shove", rung: 3, v: 0.95, theta: 0.67, unlocked: 3, unlock: "person-3>person-2@3", grievance: 0.08, provocation: 0.83, dist: 4, queue: 1, hold: true, result: "blocked:ladder/contagion", reason: "LAD-10" });
    expect(Object.keys(parsed)).toEqual(["t_ms", "actor", "kind", "pair", "verb", "rung", "v", "theta", "unlocked", "unlock", "grievance", "provocation", "dist", "queue", "hold", "result", "reason"]);
  });

  it("leaves out what the consult did not look at, and carries the count of identical consults dropped before it", () => {
    expect(JSON.parse(dramaLogLine(-5, entry({ kind: "skip", result: "busy", reason: "act_busy" }), 0))).toEqual({ t_ms: 0, actor: "person-3", kind: "skip", unlocked: 0, queue: 0, hold: false, result: "busy", reason: "act_busy" });
    expect(JSON.parse(dramaLogLine(7, entry(), 12))).toMatchObject({ same: 12 });
  });
});

describe("DramaLog", () => {
  const make = (cap?: number) => {
    const lines: DramaLogLine[] = [];
    let now = 0;
    const log = new DramaLog((l) => lines.push(JSON.parse(l) as DramaLogLine), () => now, cap);
    return { log, lines, at: (ms: number) => void (now = ms) };
  };

  it("writes an idle consult once for a run of identical ones and says how many it dropped on the next line of that actor and kind", () => {
    const { log, lines, at } = make();
    for (let i = 0; i < 5; i++) {
      at(i * 7000);
      log.record(entry({ result: "pace", reason: "since_last 7s < 25s", v: 0.1 * i }));
    }
    expect(lines.map((l) => l.t_ms)).toEqual([0]);
    expect(log.dropped).toBe(4);
    at(40_000);
    log.record(entry({ result: "no_candidates" }));
    expect(lines.at(-1)).toMatchObject({ t_ms: 40_000, result: "no_candidates", same: 4 });
  });

  it("the numbers that drift do not make a consult new; the unlock, the queue and the result do", () => {
    const { log, lines } = make();
    log.record(entry({ pair: "person-3>person-1", verb: "glare", v: 0.1, dist: 3, result: "blocked:ladder/motive" }));
    log.record(entry({ pair: "person-3>person-1", verb: "glare", v: 0.2, dist: 5, result: "blocked:ladder/motive" }));
    log.record(entry({ pair: "person-3>person-1", verb: "glare", v: 0.2, result: "blocked:ladder/motive", unlock: "person-3>person-2@3" }));
    log.record(entry({ pair: "person-3>person-1", verb: "glare", v: 0.2, result: "blocked:ladder/motive", unlock: "person-3>person-2@3", queue: 1 }));
    expect(lines).toHaveLength(3);
  });

  it("a consult that sent an act is always written; kinds and actors are collapsed apart", () => {
    const { log, lines } = make();
    log.record(entry({ result: "act", verb: "glare" }));
    log.record(entry({ result: "act", verb: "glare" }));
    log.record(entry({ kind: "propose", result: "pace" }));
    log.record(entry({ kind: "originate", result: "pace" }));
    log.record(entry({ kind: "propose", result: "pace" }));
    log.record(entry({ actor: "person-2", kind: "originate", result: "pace" }));
    expect(lines.map((l) => `${l.actor}/${l.kind}/${l.result}`)).toEqual(["person-3/originate/act", "person-3/originate/act", "person-3/propose/pace", "person-3/originate/pace", "person-2/originate/pace"]);
  });

  it("at the end a stretch of identical consults still going is written once more with its count, and only once", () => {
    const { log, lines, at } = make();
    for (let i = 0; i < 4; i++) {
      at(i * 7000);
      log.record(entry({ result: "pace" }));
    }
    log.record(entry({ actor: "person-2", result: "pace" }));
    at(60_000);
    log.close();
    log.close();
    expect(lines.map((l) => `${l.t_ms}/${l.actor}/${l.same ?? 0}`)).toEqual(["0/person-3/0", "21000/person-2/0", "60000/person-3/3"]);
  });

  it("stops at the cap with one last line that says so, and counts what it dropped after it", () => {
    const { log, lines } = make(4);
    for (let i = 0; i < 10; i++) log.record(entry({ result: "act", verb: "glare" }));
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toMatchObject({ kind: "skip", result: "log_capped", reason: "cap 4" });
    expect(log.capped).toBe(true);
    expect(log.dropped).toBe(7);
    expect(DRAMA_LOG_CAP).toBe(2000);
  });
});

describe("what the director says of each decide (DramaDirector.trace)", () => {
  it("a proposal the motive gate refuses: the pair, the verb, the volition against its threshold, the rule", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const d = rig.dir.decide({ actor: A, proposal: { verb: "glare", with: B, origin: "model" }, emotion: emotion({}, { toward: [B], relation: { resentment: 0 } }) });
    expect(d).toMatchObject({ kind: "veto", detail: "motive" });
    expect(rig.dir.trace()).toMatchObject({ actor: "person-1", kind: "propose", pair: "person-1>person-2", verb: "glare", rung: 1, v: 0, unlocked: 0, dist: 1, result: "blocked:ladder/motive", reason: "LAD-6" });
    expect(rig.dir.trace()!.theta).toBeGreaterThanOrEqual(0.25);
  });

  it("an origination that sends an act: the act, who it is for, its rung and numbers; while it is in flight the actor is `busy`", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const d = rig.dir.decide({ actor: A, emotion: emotion(HOT_TENDENCIES, { toward: [B] }) });
    expect(d.kind).toBe("initiate");
    expect(rig.dir.trace()).toMatchObject({ actor: "person-1", kind: "originate", pair: "person-1>person-2", verb: "glare", rung: 1, result: "act", dist: 1 });
    await rig.clock.advance(7000);
    // The glare is in flight: the actor is busy until the hotel says it ended.
    expect(rig.dir.decide({ actor: A, emotion: emotion(HOT_TENDENCIES, { toward: [B] }) })).toMatchObject({ kind: "pass", why: "actor_busy" });
    expect(rig.dir.trace()).toMatchObject({ kind: "originate", result: "busy", reason: "actor_busy" });
  });

  it("the pace of the climb: `pace` with how long since the last beat", async () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    const first = rig.dir.decide({ actor: A, emotion: emotion(HOT_TENDENCIES, { toward: [B] }) });
    if (first.kind !== "initiate") throw new Error("no beat");
    rig.hotel(actFrames({ actId: first.actId, verb: first.verb, actor: A, with: B, origin: "director", outcome: "landed", scene: rig.dir.scene, at: rig.clock.now() }));
    await rig.clock.advance(7000);
    expect(rig.dir.decide({ actor: A, emotion: emotion(HOT_TENDENCIES, { toward: [B] }) })).toMatchObject({ kind: "pass", why: "pace" });
    expect(rig.dir.trace()).toMatchObject({ kind: "originate", result: "pace", reason: "since_last 7s < 25s" });
  });

  it("an unlocked person who is too far for the blow: `far`, the blow it would walk up for, `unlocked` on the pair", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.world.put(B, { tile: [15, 5] });
    const reading = emotion({}, { toward: [B], relation: { resentment: 0, unlocked: 3, provocation: 0.85 } });
    // A glare and an insult are out of range at that distance too, and a shove wants the two side by side: it is the one the actor would walk up for.
    const d = rig.dir.decide({ actor: A, emotion: reading });
    expect(d).toMatchObject({ kind: "pass", approach: B });
    expect(rig.dir.trace()).toMatchObject({ pair: "person-1>person-2", verb: "shove", rung: 3, unlocked: 3, result: "far", reason: "blocked:too_far/distance", dist: 10 });
  });

  it("nobody to aim at says why: nobody else in the room, or people in the room the actor has no relation with", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.dir.decide({ actor: A, emotion: { actionEmotions: ZERO_ACT, relations: new Map() } });
    expect(rig.dir.trace()).toMatchObject({ result: "no_candidates", reason: "not_in_relations(3 in room)" });
    for (const id of [B, C, H]) rig.world.remove(id);
    rig.dir.decide({ actor: A, emotion: emotion(HOT_TENDENCIES, { toward: [B] }) });
    expect(rig.dir.trace()).toMatchObject({ result: "no_candidates", reason: "none_in_room" });
    rig.dir.decide({ actor: A });
    expect(rig.dir.trace()).toMatchObject({ result: "no_emotion", reason: "no_emotion" });
  });

  it("a proposal the hotel's own gates refuse names the gate: a calm room says `blocked:calm_room` for the blow the spine opened", () => {
    const rig = makeRig({ block: WIDE_BLOCK });
    rig.state({ scene: rig.dir.scene, calm: true });
    const reading = emotion({}, { toward: [B], relation: { resentment: 0, unlocked: 3, provocation: 0.85 } });
    const d = rig.dir.decide({ actor: A, proposal: { verb: "shove", with: B, origin: "model" }, emotion: reading });
    expect(d).toMatchObject({ kind: "veto", reason: "calm_room" });
    expect(rig.dir.trace()).toMatchObject({ kind: "propose", pair: "person-1>person-2", verb: "shove", rung: 3, v: 0.95, unlocked: 3, result: "blocked:calm_room", reason: "GATE-2" });
  });
});

describe("what the body writes at each consult", () => {
  const lines = (log: { lines: DramaLogLine[] }) => log.lines;
  const make = () => {
    const out: DramaLogLine[] = [];
    let now = 0;
    return { log: new DramaLog((l) => out.push(JSON.parse(l) as DramaLogLine), () => now), lines: out, at: (ms: number) => void (now = ms) };
  };

  it("a proposal: one `propose` line with the director's reading and the queue; the consult is not asked to originate, and says so", () => {
    const { log, lines: out } = make();
    const r = rig({ log });
    r.port!.next = { kind: "veto", reason: "ladder", rule: "LAD-6", detail: "motive" };
    r.port!.traced = { actor: "person-1", kind: "propose", pair: "person-1>person-2", verb: "glare", rung: 1, v: 0.11, theta: 0.42, unlocked: 0, grievance: 0.08, provocation: 0, dist: 1, result: "blocked:ladder/motive", reason: "LAD-6" };
    r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "glare", target: "p1" } }), handles }));
    expect(out.map((l) => `${l.kind}/${l.result}/${l.reason ?? ""}/${l.queue}/${l.hold}`)).toEqual(["propose/blocked:ladder/motive/LAD-6/1/false", "skip/not_asked/model_proposed/1/false"]);
    expect(out[0]).toMatchObject({ actor: "duda", pair: "person-1>person-2", verb: "glare", v: 0.11, theta: 0.42 });
    expect(lines({ lines: out })).toHaveLength(2);
  });

  it("an approved proposal holds the actor; a passive consult is an `originate` line; a consult with no feelings says `no_emotion`", () => {
    const { log, lines: out } = make();
    const r = rig({ log });
    r.port!.traced = { actor: "duda", kind: "originate", unlocked: 0, result: "no_candidates", reason: "none_in_room" };
    r.body.planFor("duda", r.input());
    r.body.planFor("rafa", r.input({ actionEmotions: undefined as never }, "rafa"));
    expect(out.map((l) => `${l.actor}/${l.kind}/${l.result}`)).toEqual(["duda/originate/no_candidates", "rafa/skip/no_emotion"]);
  });

  it("an actor who holds an open unlock: every line says which one, whoever the line is about", () => {
    const { log, lines: out } = make();
    const r = rig({ log, allow: (a, b) => a !== b });
    r.body.grant("duda", "rafa", "shove", "test");
    r.port!.traced = { actor: "duda", kind: "originate", unlocked: 0, result: "no_candidates" };
    r.body.planFor("duda", r.input());
    // Granting looks at the director once (the climb watch's look) and then the consult asks again: both say what the actor holds.
    expect(out.every((l) => l.unlock === "duda>rafa@3")).toBe(true);
    // A consult nobody was looked at in is filed under the unlock's own pair and rung; one about someone else says that person's (here: nothing opened).
    expect(out.at(-1)).toMatchObject({ pair: "duda>rafa", unlocked: 3 });
  });

  it("an actor that holds an act or a lock is a `skip` of result `busy`", () => {
    const { log, lines: out } = make();
    const r = rig({ log });
    r.port!.busy.set(-701, "d1");
    r.body.planFor("duda", r.input());
    expect(out).toMatchObject([{ actor: "duda", kind: "skip", result: "busy", reason: "act_busy", hold: true }]);
  });

  it("the hotel's answers to an act of an own actor are lines of their own: started, how it ended, and a refusal with its reason", () => {
    const { log, lines: out } = make();
    const r = rig({ log });
    feedFrames(r.body, actFrames({ actId: "d1", verb: "shove", actor: -701, with: -702, origin: "director", outcome: "landed", scene: "7.1", at: 1 }));
    feedFrames(r.body, actFrames({ actId: "d2", verb: "slap", actor: -701, with: -702, origin: "director", outcome: "blocked", reason: "too_far", detail: "moving", scene: "7.1", at: 2 }));
    expect(out.map((l) => `${l.kind}/${l.actor}/${l.pair}/${l.verb}/${l.result}`)).toEqual([
      "hotel/duda/duda>rafa/shove/started",
      "hotel/duda/duda>rafa/shove/done:landed",
      "hotel/duda/duda>rafa/slap/blocked:too_far/moving",
    ]);
    expect(out[0]).toMatchObject({ rung: 3 });
  });

  it("without a log nothing is written and nothing changes", () => {
    const r = rig();
    r.port!.next = { kind: "veto", reason: "ladder", rule: "LAD-6", detail: "motive" };
    expect(() => r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "glare", target: "p1" } }), handles }))).not.toThrow();
    expect(new FakePort().trace()).toBeUndefined();
  });
});

describe("the run's artifact", () => {
  it("is streamed to drama-log.jsonl counted from the run's start, and registered as drama_log in the manifest", async () => {
    const dataDir = tmp();
    const runDir = join(dataDir, "runs", "9");
    let now = 1000;
    const out = new RunDramaLog(join(runDir, DRAMA_LOG_FILE), () => now);
    out.log.record(entry({ result: "act", verb: "glare", pair: "person-3>person-2", rung: 1 }));
    now = 5500;
    out.log.record(entry({ kind: "skip", result: "busy", reason: "act_busy" }));
    out.log.record(entry({ kind: "skip", result: "busy", reason: "act_busy" }));
    await out.flush();
    const rows = readFileSync(join(runDir, DRAMA_LOG_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l) as DramaLogLine);
    // The second identical busy consult is dropped and counted when the run is flushed.
    expect(rows.map((r) => [r.t_ms, r.kind, r.result, r.same ?? 0])).toEqual([[1000, "originate", "act", 0], [5500, "skip", "busy", 0], [5500, "skip", "busy", 1]]);

    const written = await writeRunArtifacts(dataDir, 9, [], { frames: [], snapshots: [] } as never, { run: 9, simulationId: "s", scenarioVersion: 1, scenarioSha256: "x", finalState: "ended", stopReason: "completed", startedAt: 0, endedAt: 1, pulse: 1, counters: {} });
    expect(written.files["drama_log"]).toBe(join(runDir, DRAMA_LOG_FILE));
    expect((JSON.parse(readFileSync(join(runDir, "replay.json"), "utf8")) as { files: Record<string, string> }).files["drama_log"]).toBe("drama-log.jsonl");
  });

  it("a run that never consulted the drama planner leaves no file and no entry", async () => {
    const dataDir = tmp();
    const written = await writeRunArtifacts(dataDir, 10, [], { frames: [], snapshots: [] } as never, { run: 10, simulationId: "s", scenarioVersion: 1, scenarioSha256: "x", finalState: "ended", stopReason: "completed", startedAt: 0, endedAt: 1, pulse: 1, counters: {} });
    expect(Object.keys(written.files)).toEqual(["events", "director", "replay", "body_frames"]);
  });

  it("PERFECTMAN_DRAMA_LOG=0 turns it off for the process, anything else leaves it on", () => {
    expect(dramaLogEnabled()).toBe(true);
    process.env["PERFECTMAN_DRAMA_LOG"] = "0";
    expect(dramaLogEnabled()).toBe(false);
    process.env["PERFECTMAN_DRAMA_LOG"] = "1";
    expect(dramaLogEnabled()).toBe(true);
  });
});
