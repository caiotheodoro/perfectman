import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BodyFrame } from "@perfectman/shared";
import { alignWireFrames, normalizeFrame } from "../hotel/index.js";
import { extractDramaEvents, type DramaEvent } from "../drama/index.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../drama/__fixtures__/run7-wrapper-excerpt.jsonl");

/** ~46 verbatim lines of a real hotel run (run 7), as the loader reads them. */
const realFrames = (): BodyFrame[] =>
  readFileSync(FIXTURE, "utf8")
    .trim()
    .split("\n")
    .map((l) => normalizeFrame(JSON.parse(l) as Record<string, unknown>)!);

const of = <K extends DramaEvent["kind"]>(events: DramaEvent[], kind: K): Extract<DramaEvent, { kind: K }>[] =>
  events.filter((e): e is Extract<DramaEvent, { kind: K }> => e.kind === kind);

const wire = (frame: Record<string, unknown>, tsMs: number, dir: "in" | "out" = "out"): BodyFrame =>
  normalizeFrame({ conn: 3, dir, frame, run: 7, ts_ms: tsMs })!;

describe("extractDramaEvents on real run 7 frames", () => {
  const events = extractDramaEvents(realFrames());

  it("puts time relative to run start and returns events in time order", () => {
    expect(events[0]!.atMs).toBeGreaterThanOrEqual(0);
    expect(events.map((e) => e.atMs)).toEqual([...events.map((e) => e.atMs)].sort((a, b) => a - b));
    expect(events.at(-1)!.atMs).toBeLessThan(720_000);
  });

  it("reads speech by actor ref, merging a command with the hotel's echo of it", () => {
    const speech = of(events, "speech");
    const gabi = speech.find((e) => e.text === "Você mora aqui por perto?")!;
    expect(gabi).toMatchObject({ actor: "person-3", mode: "say", atMs: 23_497, room: "17" });
    expect(speech.filter((e) => e.text === "Você mora aqui por perto?")).toHaveLength(1);
    // echo-only lines (no command in the excerpt) still count once
    expect(speech.find((e) => e.text === "Toco aqui toda sexta, se quiser ouvir.")).toMatchObject({ actor: "person-4", mode: "say" });
    expect(speech.find((e) => e.text === "Hmm, entendi.")).toMatchObject({ actor: "person-2" });
    expect(speech.filter((e) => e.mode === "thought")).toHaveLength(4);
  });

  it("names the human by the hotel's h:<id> and keeps what they said", () => {
    const human = of(events, "speech").filter((e) => e.actor === "h:28");
    expect(human.map((e) => e.text)).toEqual(["Rafa, tudo bem? Que lugar é esse?", "Duda, o que você recomenda pra beber hoje?"]);
  });

  it("reads gestures and expressions once each, preferring the command's richer name over the echo's", () => {
    const acts = of(events, "body_act").filter((e) => e.act === "gesture" || e.act === "expression");
    const leo = acts.filter((e) => e.actor === "person-4");
    expect(leo.map((e) => [e.act, e.name, e.atMs])).toEqual([
      ["gesture", "wave", 38_466],
      ["expression", "smile", 38_467],
      ["expression", "expression", 53_764],
      ["gesture", "wave", 92_107],
    ]);
  });

  it("reads a pair act, its reaction, and the consent answer that reaction is", () => {
    const pairs = of(events, "body_act").filter((e) => e.act === "pair");
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ actor: "person-3", name: "kiss", with: "h:28", pairId: "pr:person-3:mw6cmik7", room: "17" });
    const reactions = of(events, "body_act").filter((e) => e.act === "pair_reaction");
    expect(reactions.map((e) => [e.pairId, e.name, e.outcome, e.with])).toEqual([
      ["pr:person-3:mw6cmik7", "kiss", "dodge", "h:28"],
      ["pr:person-3:mw6cu8fj", "kiss", "accept", "h:28"],
    ]);
    const answered = of(events, "consent_chip").filter((e) => e.phase === "answered");
    expect(answered.map((e) => e.phase === "answered" && [e.pairId, e.answer])).toEqual([
      ["pr:person-3:mw6cmik7", "decline"],
      ["pr:person-3:mw6cu8fj", "accept"],
    ]);
  });

  it("gives the same events whether or not the loader's alignment ran first", () => {
    expect(extractDramaEvents(alignWireFrames(realFrames()))).toEqual(events);
  });

  it("is deterministic and does not depend on input order", () => {
    expect(extractDramaEvents([...realFrames()].reverse())).toEqual(events);
  });
});

describe("extractDramaEvents on the minimal act frames (the first guess, still read)", () => {
  const spawn = (id: number, ref: string, room = 17): BodyFrame =>
    wire({ actor: id, cid: 1, dir: 2, ref, room, seq: 1, t: "actor_spawned", x: 0, y: 8 }, 1000);
  const base = [
    wire({ admin: { id: 27, name: "a" }, cap_actors: 12, lease: 1, mode: "default", room: 17, run: 7, seq: 1, t: "run_start" }, 1000),
    spawn(-701, "person-1"),
    spawn(-702, "person-2"),
    spawn(-703, "person-3"),
  ];

  it("turns act_started, act_reaction and act_done into events, with times relative to run start", () => {
    const frames = [
      ...base,
      wire({ t: "act_started", act_id: "a1", verb: "slap", actor: "person-1", with: "person-2", intensity: 0.6, run: 7, seq: 12 }, 11_000),
      wire({ t: "act_reaction", act_id: "a1", who: "person-2", role: "target", reaction: "flinch" }, 11_400),
      wire({ t: "act_reaction", act_id: "a1", who: "person-3", role: "witness", reaction: "gasp" }, 11_900),
      wire({ t: "act_done", act_id: "a1", outcome: "landed" }, 12_000),
    ];
    const events = extractDramaEvents(frames);
    expect(events.filter((e) => e.kind.startsWith("act_"))).toEqual([
      { kind: "act_started", atMs: 10_000, room: "17", actId: "a1", verb: "slap", actor: "person-1", with: "person-2", intensity: 0.6, run: 7, seq: 12 },
      { kind: "act_reaction", atMs: 10_400, room: "17", actId: "a1", who: "person-2", role: "target", reaction: "flinch" },
      { kind: "act_reaction", atMs: 10_900, room: "17", actId: "a1", who: "person-3", role: "witness", reaction: "gasp" },
      { kind: "act_done", atMs: 11_000, room: "17", actId: "a1", outcome: "landed" },
    ]);
  });

  it("omits the optional act_started fields it was not given", () => {
    const [e] = of(extractDramaEvents([...base, wire({ t: "act_started", act_id: "a2", verb: "glare", actor: "person-1", intensity: 0.2 }, 5000)]), "act_started");
    expect(e).toEqual({ kind: "act_started", atMs: 4000, room: "17", actId: "a2", verb: "glare", actor: "person-1", intensity: 0.2 });
  });

  it("reads authored_skip and target_opt_in off an act_started frame, only when they are booleans", () => {
    const frames = [
      ...base,
      wire({ t: "act_started", act_id: "s1", verb: "kill", actor: "person-1", with: "person-2", intensity: 1, authored_skip: true, target_opt_in: false }, 5000),
      wire({ t: "act_started", act_id: "s2", verb: "kill", actor: "person-1", with: "person-2", intensity: 1, authored_skip: "yes", target_opt_in: 1 }, 5001),
    ];
    const [skip, junk] = of(extractDramaEvents(frames), "act_started");
    expect(skip).toMatchObject({ actId: "s1", authoredSkip: true, targetOptIn: false });
    expect(junk).not.toHaveProperty("authoredSkip");
    expect(junk).not.toHaveProperty("targetOptIn");
  });

  it("resolves a numeric actor id in an act frame to its ref", () => {
    const [e] = of(extractDramaEvents([...base, wire({ t: "act_started", act_id: "a3", verb: "shove", actor: -702, with: -703, intensity: 1 }, 5000)]), "act_started");
    expect(e).toMatchObject({ actor: "person-2", with: "person-3" });
  });

  it("reads an actor death", () => {
    const [e] = of(extractDramaEvents([...base, wire({ t: "actor_death", actor: "person-2", cause: "punch" }, 9000)]), "actor_death");
    expect(e).toEqual({ kind: "actor_death", atMs: 8000, room: "17", actor: "person-2", cause: "punch" });
  });

  it("drops act frames that lack their required fields or carry values outside the contract", () => {
    const frames = [
      ...base,
      wire({ t: "act_started", verb: "slap", actor: "person-1", intensity: 0.5 }, 2000),
      wire({ t: "act_started", act_id: "x", verb: "slap", actor: "person-1", intensity: 3 }, 2000),
      wire({ t: "act_reaction", act_id: "x", who: "person-2", role: "bystander", reaction: "stare" }, 2000),
      wire({ t: "act_done", act_id: "x", outcome: "exploded" }, 2000),
    ];
    expect(extractDramaEvents(frames).filter((e) => e.kind.startsWith("act_"))).toEqual([]);
  });

  it("accepts every act_done outcome the wire allows", () => {
    const outcomes = ["landed", "dodged", "blocked", "declined", "timeout", "aborted"] as const;
    const frames = [...base, ...outcomes.map((o, i) => wire({ t: "act_done", act_id: `a${i}`, outcome: o }, 2000 + i))];
    expect(of(extractDramaEvents(frames), "act_done").map((e) => e.outcome)).toEqual([...outcomes]);
  });
});

describe("extractDramaEvents: consent chip, appearance and run start", () => {
  it("reads a shown chip from the hotel's pair_prompt delta", () => {
    const frames = [
      wire({ actor: -703, cid: 1, dir: 2, ref: "person-3", room: 17, seq: 1, t: "actor_spawned", x: 0, y: 8 }, 1000),
      wire({ msg: { from: -703, kind: "kiss", name: "Gabi", pair: "pr:1", t: "pair_prompt", ttl_ms: 15_000 }, rev: 2, room: 17, seq: 2, t: "delta" }, 3000),
    ];
    expect(of(extractDramaEvents(frames), "consent_chip")).toEqual([
      { kind: "consent_chip", phase: "shown", atMs: 2000, room: "17", pairId: "pr:1", from: "person-3", pairKind: "kiss", ttlMs: 15_000 },
    ]);
  });

  it("maps pair outcomes to chip answers, and shows no chip for an actor-to-actor 'done' or 'aborted'", () => {
    const outcomes = ["accept", "dodge", "push", "timeout", "done", "aborted"];
    const frames = outcomes.map((o, i) => wire({ actor: -701, at: 1000 + i, outcome: o, pair: `p${i}`, run: 7, seq: i, t: "pair_reaction", with: 28 }, 1000 + i));
    const answers = of(extractDramaEvents(frames), "consent_chip").map((e) => e.phase === "answered" && e.answer);
    expect(answers).toEqual(["accept", "decline", "decline", "timeout"]);
  });

  it("reads an appearance command and the hotel's appearance_changed as one change", () => {
    const frames = [
      wire({ actor: -701, cid: 1, dir: 2, ref: "person-1", room: 17, seq: 1, t: "actor_spawned", x: 0, y: 8 }, 1000),
      wire({ actor: -701, cid: 9, cmd: { k: "appearance", effect: "fire" }, lease: 1, run: 7, seq: 2, t: "actor_cmd" }, 2000, "in"),
      wire({ msg: { effect: "fire", figure: "hd-1", id: -701, t: "appearance_changed" }, rev: 3, room: 17, seq: 3, t: "delta" }, 2001),
    ];
    expect(of(extractDramaEvents(frames), "body_act")).toEqual([{ kind: "body_act", atMs: 1000, room: "17", actor: "person-1", act: "appearance", name: "fire" }]);
  });

  it("measures from the first frame when there is no run_start", () => {
    const frames = [wire({ actor: -701, cid: 1, cmd: { k: "chat", mode: "say", text: "oi" }, lease: 1, run: 7, seq: 1, t: "actor_cmd" }, 50_000, "in")];
    expect(extractDramaEvents(frames)[0]!.atMs).toBe(0);
  });

  it("returns nothing for no frames", () => {
    expect(extractDramaEvents([])).toEqual([]);
  });

  it("keeps a real repeat from one actor: two identical gestures a second apart are two events", () => {
    const cmd = (ts: number): BodyFrame => wire({ actor: -701, cid: ts, cmd: { action: "wave", k: "action" }, lease: 1, run: 7, seq: ts, t: "actor_cmd" }, ts, "in");
    expect(of(extractDramaEvents([cmd(1000), cmd(2000)]), "body_act")).toHaveLength(2);
  });

  it("does not turn the sidecar's body log copy of a command into a second event", () => {
    const sidecar: BodyFrame = { atMs: 2005, dir: "out", kind: "actor_cmd", data: { actor: "person-1", cmd: { k: "action", action: "wave" } }, room: "17" };
    const hotel = wire({ actor: -701, cid: 1, cmd: { action: "wave", k: "action" }, lease: 1, run: 7, seq: 1, t: "actor_cmd" }, 2000, "in");
    const spawn = wire({ actor: -701, cid: 1, dir: 2, ref: "person-1", room: 17, seq: 1, t: "actor_spawned", x: 0, y: 8 }, 1000);
    expect(of(extractDramaEvents([spawn, hotel, sidecar]), "body_act")).toHaveLength(1);
  });

  it("reads one event when the command, its hotel echo and the sidecar's copy of the command all arrive", () => {
    const spawn = wire({ actor: -701, cid: 1, dir: 2, ref: "person-1", room: 17, seq: 1, t: "actor_spawned", x: 0, y: 8 }, 1000);
    const hotel = wire({ actor: -701, cid: 1, cmd: { action: "wave", k: "action" }, lease: 1, run: 7, seq: 1, t: "actor_cmd" }, 2000, "in");
    const echo = wire({ msg: { action: "wave", id: -701, t: "avatar_action" }, rev: 3, room: 17, seq: 3, t: "delta" }, 2001);
    const sidecar: BodyFrame = { atMs: 2005, dir: "out", kind: "actor_cmd", data: { actor: "person-1", cmd: { k: "action", action: "wave" } }, room: "17" };
    expect(of(extractDramaEvents([spawn, hotel, echo, sidecar]), "body_act")).toHaveLength(1);
    expect(of(extractDramaEvents([spawn, sidecar, echo, hotel]), "body_act")).toHaveLength(1);
    // a second wave from the same source is a second wave
    expect(of(extractDramaEvents([spawn, hotel, echo, sidecar, { ...hotel, atMs: 3000 }]), "body_act")).toHaveLength(2);
  });

  it("reads an actor command from a log that names the actor `agentId` (the fake grid hotel) as well as `actor`", () => {
    const f: BodyFrame = { atMs: 2000, dir: "out", kind: "actor_cmd", data: { agentId: "person-1", cmd: { k: "action", action: "laugh" } } };
    expect(of(extractDramaEvents([f]), "body_act")).toEqual([{ kind: "body_act", atMs: 0, actor: "person-1", act: "gesture", name: "laugh" }]);
  });
});
