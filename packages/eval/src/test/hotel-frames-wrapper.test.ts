import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHotelTranscript, loadHotelRun, normalizeFrame } from "../hotel/index.js";

/** Lines copied verbatim from a real hotel run's frames.jsonl (run 7): `{conn, dir, frame, run, ts_ms}` wrappers. */
const REAL_MOVES = '{"conn":3,"dir":"out","frame":{"msg":{"moves":[{"dir":2,"id":-701,"state":"walk","x":1,"y":8}],"t":"moves"},"rev":730,"room":17,"seq":1609,"t":"delta"},"run":7,"ts_ms":1794052314084}';
const REAL_CHAT_CMD = '{"conn":3,"dir":"in","frame":{"actor":-701,"cid":794,"cmd":{"k":"chat","mode":"say","text":"oi Rafa","to":-702},"lease":1,"run":7,"seq":1168,"t":"actor_cmd"},"run":7,"ts_ms":1794052332964}';
const REAL_ACTION_CMD = '{"conn":3,"dir":"in","frame":{"actor":-704,"cid":828,"cmd":{"action":"wave","k":"action"},"lease":1,"run":7,"seq":1208,"t":"actor_cmd"},"run":7,"ts_ms":1794052351941}';
const REAL_HUMAN_CHAT = '{"conn":3,"dir":"out","frame":{"at":1794052354394,"from":{"id":28,"name":"pmguest1cef94"},"had_image":false,"mode":"say","rev":808,"room":17,"seq":1740,"t":"human_chat","text":"Rafa, tudo bem? Que lugar é esse?","untrusted":true,"untrusted_text":["from.name","text"]},"run":7,"ts_ms":1794052354394}';
const REAL_SPAWNED = '{"conn":3,"dir":"out","frame":{"actor":-701,"cid":785,"dir":2,"ref":"person-1","room":17,"seq":1607,"t":"actor_spawned","x":0,"y":8},"run":7,"ts_ms":1794052313694}';

describe("normalizeFrame on hotel frames.jsonl wrappers", () => {
  it("unwraps a real delta line: kind from frame.t, dir from the wrapper, atMs from ts_ms, room from the frame", () => {
    const n = normalizeFrame(JSON.parse(REAL_MOVES));
    expect(n).toBeDefined();
    expect(n!.kind).toBe("delta");
    expect(n!.dir).toBe("out");
    expect(n!.atMs).toBe(1794052314084);
    expect(n!.room).toBe("17");
    expect(n!.data["msg"]).toEqual({ moves: [{ dir: 2, id: -701, state: "walk", x: 1, y: 8 }], t: "moves" });
  });

  it("keeps the frame's own dir field (an avatar orientation) out of the way of the wrapper dir", () => {
    const n = normalizeFrame(JSON.parse(REAL_SPAWNED))!;
    expect(n.kind).toBe("actor_spawned");
    expect(n.dir).toBe("out");
    expect(n.data["dir"]).toBe(2);
    expect(n.data["ref"]).toBe("person-1");
  });

  it("maps a wrapped actor_cmd chat to the same chat frame a raw one gets, with the wrapper timestamp", () => {
    const n = normalizeFrame(JSON.parse(REAL_CHAT_CMD))!;
    expect(n.kind).toBe("chat");
    expect(n.atMs).toBe(1794052332964);
    expect(n.data).toMatchObject({ agentId: "-701", mode: "say", text: "oi Rafa", toRef: "-702" });
  });

  it("keeps a wrapped non-chat actor_cmd as actor_cmd with the wrapper dir", () => {
    const n = normalizeFrame(JSON.parse(REAL_ACTION_CMD))!;
    expect(n).toMatchObject({ kind: "actor_cmd", dir: "in", atMs: 1794052351941 });
    expect(n.data).toEqual({ agentId: "-704", cmd: { action: "wave", k: "action" } });
  });

  it("prefers the wrapper timestamp over the inner `at` and keeps the sender id for humans", () => {
    const n = normalizeFrame(JSON.parse(REAL_HUMAN_CHAT))!;
    expect(n).toMatchObject({ kind: "human_chat", dir: "out", atMs: 1794052354394, room: "17" });
    expect(n.data).toMatchObject({ ref: "h:28", fromId: "28", text: "Rafa, tudo bem? Que lugar é esse?" });
  });

  it("still drops a wrapper whose inner frame has no t, and objects with neither shape", () => {
    expect(normalizeFrame({ conn: 3, dir: "in", frame: { foo: 1 }, run: 7, ts_ms: 5 })).toBeUndefined();
    expect(normalizeFrame({ conn: 3, dir: "in", frame: "x", run: 7, ts_ms: 5 })).toBeUndefined();
  });
});

describe("loadHotelRun on a real-shaped frames.jsonl", () => {
  it("accepts every wrapper line with no warnings and sorts frames by wrapper time", () => {
    const dir = mkdtempSync(join(tmpdir(), "hotel-wrapper-"));
    writeFileSync(join(dir, "events.jsonl"), "");
    writeFileSync(join(dir, "frames.jsonl"), [REAL_ACTION_CMD, REAL_SPAWNED, REAL_MOVES].join("\n"));
    const run = loadHotelRun(dir);
    expect(run.warnings).toEqual([]);
    expect(run.frames.map((f) => f.kind)).toEqual(["actor_spawned", "moves", "actor_cmd"]);
    expect(run.frames.map((f) => f.atMs)).toEqual([1794052313694, 1794052314084, 1794052351941]);
  });
});

const line = (frame: Record<string, unknown>, dir: "in" | "out", ts_ms: number): string => JSON.stringify({ conn: 3, dir, frame, run: 7, ts_ms });
const SPAWNS = [
  line({ actor: -701, cid: 785, dir: 2, ref: "person-1", room: 17, seq: 1, t: "actor_spawned", x: 0, y: 8 }, "out", 1000),
  line({ actor: -702, cid: 786, dir: 2, ref: "person-2", room: 17, seq: 2, t: "actor_spawned", x: 0, y: 9 }, "out", 1001),
];

function runWith(frames: string[], bodyFrames?: unknown): ReturnType<typeof loadHotelRun> {
  const dir = mkdtempSync(join(tmpdir(), "hotel-wrapper-run-"));
  writeFileSync(join(dir, "events.jsonl"), "");
  writeFileSync(join(dir, "frames.jsonl"), [...SPAWNS, ...frames].join("\n"));
  if (bodyFrames !== undefined) writeFileSync(join(dir, "body-frames.json"), JSON.stringify(bodyFrames));
  return loadHotelRun(dir);
}

describe("loadHotelRun resolves the hotel's numeric avatar ids", () => {
  it("names speakers and addressees by actor ref, and humans by their name", () => {
    const run = runWith([
      line({ actor: -701, cid: 1, cmd: { k: "chat", mode: "say", text: "oi", to: -702 }, lease: 1, run: 7, seq: 3, t: "actor_cmd" }, "in", 2000),
      line({ at: 3000, from: { id: 28, name: "pmguest" }, mode: "say", rev: 1, room: 17, seq: 4, t: "human_chat", text: "e aí", untrusted: true }, "out", 3000),
      line({ actor: -702, cid: 2, cmd: { k: "chat", mode: "say", text: "tudo bem", to: 28 }, lease: 1, run: 7, seq: 5, t: "actor_cmd" }, "in", 4000),
    ]);
    const chats = run.frames.filter((f) => f.kind === "chat");
    expect(chats.map((f) => [f.data["agentId"], f.data["toRef"]])).toEqual([["person-1", "person-2"], ["person-2", "h:28"]]);
  });

  it("turns delta moves and avatar_action into the per-actor frames the body probes read", () => {
    const run = runWith([
      line({ msg: { moves: [{ dir: 2, id: -701, state: "walk", x: 1, y: 8 }, { dir: 6, id: -702, state: "walk", x: 3, y: 9 }], t: "moves" }, rev: 5, room: 17, seq: 6, t: "delta" }, "out", 2000),
      line({ msg: { action: "wave", id: -702, t: "avatar_action" }, rev: 6, room: 17, seq: 7, t: "delta" }, "out", 2500),
    ]);
    const moves = run.frames.filter((f) => f.kind === "moves");
    expect(moves.map((f) => f.data)).toEqual([
      { agentId: "person-1", tile: [1, 8], dir: 2, state: "walk" },
      { agentId: "person-2", tile: [3, 9], dir: 6, state: "walk" },
    ]);
    expect(moves[0]).toMatchObject({ atMs: 2000, room: "17", dir: "in" });
    const actions = run.frames.filter((f) => f.kind === "avatar_action");
    expect(actions.map((f) => f.data)).toEqual([{ agentId: "person-2", a: "wave" }]);
    // The probes read these as hotel-to-sidecar events; the wrapper's own `out` is the hotel server's view of the same wire.
    expect(actions[0]!.dir).toBe("in");
    expect(run.frames.some((f) => f.kind === "delta" && (f.data["msg"] as { t: string }).t === "moves")).toBe(false);
  });

  it("keeps deltas it does not translate as delta frames", () => {
    const run = runWith([line({ msg: { id: -701, on: true, t: "typing" }, rev: 5, room: 17, seq: 6, t: "delta" }, "out", 2000)]);
    expect(run.frames.filter((f) => f.kind === "delta")).toHaveLength(1);
  });

  it("does not carry a line twice when body-frames.json already has it (without text, as in recorded runs)", () => {
    const body = {
      frames: [
        { atMs: 2100, dir: "out", kind: "chat", data: { agentId: "person-1", mode: "say", toRef: "person-2", sameRoom: true, distance: 2 }, room: "17" },
        { atMs: 3100, dir: "in", kind: "human_chat", data: { ref: "h:28", mode: "say" }, room: "17" },
      ],
      snapshots: [],
    };
    const run = runWith(
      [
        line({ actor: -701, cid: 1, cmd: { k: "chat", mode: "say", text: "oi", to: -702 }, lease: 1, run: 7, seq: 3, t: "actor_cmd" }, "in", 2000),
        line({ at: 3000, from: { id: 28, name: "pmguest" }, mode: "say", rev: 1, room: 17, seq: 4, t: "human_chat", text: "e aí", untrusted: true }, "out", 3000),
        line({ actor: -701, cid: 3, cmd: { k: "chat", mode: "thought", text: "hmm" }, lease: 1, run: 7, seq: 9, t: "actor_cmd" }, "in", 3500),
      ],
      body,
    );
    expect(run.frames.filter((f) => f.kind === "chat").map((f) => f.data["text"])).toEqual([undefined, "hmm"]);
    expect(run.frames.filter((f) => f.kind === "chat")[0]!.data["distance"]).toBe(2);
    expect(run.frames.filter((f) => f.kind === "human_chat")).toHaveLength(1);
  });
});

describe("transcript of a run whose wire log repeats a committed line", () => {
  const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../hotel/__fixtures__/sample-run");

  it("renders a line once when the wire frame lands a couple of seconds after the committed event", () => {
    const run = loadHotelRun(FIXTURE);
    const wire = normalizeFrame({ conn: 3, dir: "in", frame: { actor: -3, cid: 1, cmd: { k: "chat", mode: "say", text: "alguém quer café?" }, lease: 1, run: 7, seq: 1, t: "actor_cmd" }, run: 7, ts_ms: 1700000032000 })!;
    const wireAsLeo = { ...wire, data: { ...wire.data, agentId: "leo" } };
    const t = buildHotelTranscript({ ...run, frames: [...run.frames, wireAsLeo] });
    expect(t.lines.filter((l) => l.includes("alguém quer café?"))).toHaveLength(1);
    expect(t.stats.actorLines).toBe(buildHotelTranscript(run).stats.actorLines);
  });

  it("keeps the same text when the same actor says it again later", () => {
    const run = loadHotelRun(FIXTURE);
    const again = normalizeFrame({ conn: 3, dir: "in", frame: { actor: -3, cid: 1, cmd: { k: "chat", mode: "say", text: "alguém quer café?" }, lease: 1, run: 7, seq: 1, t: "actor_cmd" }, run: 7, ts_ms: 1700000120000 })!;
    const t = buildHotelTranscript({ ...run, frames: [...run.frames, { ...again, data: { ...again.data, agentId: "leo" } }] });
    expect(t.lines.filter((l) => l.includes("alguém quer café?"))).toHaveLength(2);
  });

  const wireSay = (atMs: number): ReturnType<typeof normalizeFrame> => {
    const w = normalizeFrame({ conn: 3, dir: "in", frame: { actor: -3, cid: 1, cmd: { k: "chat", mode: "say", text: "alguém quer café?" }, lease: 1, run: 7, seq: 1, t: "actor_cmd" }, run: 7, ts_ms: atMs })!;
    return { ...w, data: { ...w.data, agentId: "leo" } };
  };

  it("still pairs them when the hotel sent the line 20 s after the sidecar committed it (typing, walking first)", () => {
    const run = loadHotelRun(FIXTURE);
    const t = buildHotelTranscript({ ...run, frames: [...run.frames, wireSay(1700000050000)!] });
    expect(t.lines.filter((l) => l.includes("alguém quer café?"))).toHaveLength(1);
  });

  it("lets each committed line absorb one wire copy only: a genuine repeat is still shown", () => {
    const run = loadHotelRun(FIXTURE);
    const repeat = { ...run.events.find((e) => e.id === "e30")!, id: "e40", createdAt: 1700000040000 };
    const t = buildHotelTranscript({ ...run, events: [...run.events, repeat], frames: [...run.frames, wireSay(1700000032000)!] });
    expect(t.lines.filter((l) => l.includes("alguém quer café?"))).toHaveLength(2);
  });
});
