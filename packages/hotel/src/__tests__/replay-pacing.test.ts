import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActorCmd } from "../director/index.js";
import {
  ACTOR_CHAT_PER_WINDOW,
  ACTOR_CHAT_WINDOW_MS,
  ACTOR_CMDS_PER_WINDOW,
  ACTOR_CMD_WINDOW_MS,
  ACTOR_TYPING_PER_WINDOW,
  ACTOR_TYPING_WINDOW_MS,
  ActorPacer,
  JOIN_INTERVAL_MS,
} from "../run/replay-pacing.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, compiledScenario, waitFor } from "../testing/helpers.js";

const chat = (text = "oi"): ActorCmd => ({ k: "chat", mode: "say", text });
const thought = (): ActorCmd => ({ k: "chat", mode: "thought", text: "hm" });
const walk: ActorCmd = { k: "walk", x: 2, y: 2 };
const wave: ActorCmd = { k: "action", action: "wave" };
const smile: ActorCmd = { k: "expression", face: "smile" };
const face: ActorCmd = { k: "face", dir: 2 };
const typingOn: ActorCmd = { k: "typing", on: true };
const typingOff: ActorCmd = { k: "typing", on: false };
const door: ActorCmd = { k: "move_room", room: 14, via: "door" };

/** What the hotel does to one actor: each budget refuses what goes over it. Mirrors `actors.rs` `spend`, `spend_typing` and `JOIN_INTERVAL`. */
class HotelLimiter {
  private chats: number[] = [];
  private cmds: number[] = [];
  private typings: number[] = [];
  private joinedAt: number | undefined;
  refused: Array<{ at: number; k: string }> = [];

  join(at: number): void {
    this.joinedAt = at;
  }

  accepts(at: number, cmd: ActorCmd): boolean {
    const take = (queue: number[], max: number, windowMs: number): boolean => {
      while (queue.length > 0 && at - (queue[0] ?? 0) > windowMs) queue.shift();
      if (queue.length >= max) return false;
      queue.push(at);
      return true;
    };
    let ok = true;
    if (cmd.k === "chat") ok = take(this.chats, ACTOR_CHAT_PER_WINDOW, ACTOR_CHAT_WINDOW_MS);
    else if (cmd.k === "typing") ok = !cmd.on || take(this.typings, ACTOR_TYPING_PER_WINDOW, ACTOR_TYPING_WINDOW_MS);
    else {
      ok = take(this.cmds, ACTOR_CMDS_PER_WINDOW, ACTOR_CMD_WINDOW_MS);
      if (ok && cmd.k === "move_room") {
        if (this.joinedAt !== undefined && at - this.joinedAt < JOIN_INTERVAL_MS) ok = false;
        else this.joinedAt = at;
      }
    }
    if (!ok) this.refused.push({ at, k: cmd.k });
    return ok;
  }
}

type Due = { at: number; cmd: ActorCmd };

/** Plays commands (when each was meant to go) through the pacer on a virtual clock, in order, as one actor's chain does. */
function play(due: Due[], joinedAt?: number): { sent: Due[]; hotel: HotelLimiter } {
  const pacer = new ActorPacer();
  const hotel = new HotelLimiter();
  if (joinedAt !== undefined) {
    pacer.noteJoin(joinedAt);
    hotel.join(joinedAt);
  }
  const sent: Due[] = [];
  let now = 0;
  for (const d of due) {
    now = Math.max(now, d.at);
    for (let w = pacer.waitMs(now, d.cmd); w > 0; w = pacer.waitMs(now, d.cmd)) now += w;
    pacer.record(now, d.cmd);
    hotel.accepts(now, d.cmd);
    sent.push({ at: now, cmd: d.cmd });
  }
  return { sent, hotel };
}

/** What the unpaced replay would do to the same commands. */
function unpaced(due: Due[]): HotelLimiter {
  const hotel = new HotelLimiter();
  for (const d of due) hotel.accepts(d.at, d.cmd);
  return hotel;
}

describe("replay pacing keeps every command kind inside the hotel's limits", () => {
  it("lets a recorded pace through untouched", () => {
    const due = [0, 2000, 4000, 6500, 9000, 12000].map((at, i): Due => ({ at, cmd: i % 2 === 0 ? chat() : walk }));
    const { sent, hotel } = play(due);
    expect(sent.map((s) => s.at)).toEqual(due.map((d) => d.at));
    expect(hotel.refused).toEqual([]);
  });

  it("never holds the first four lines of a burst, and holds the fifth past the window", () => {
    expect(play([0, 0, 0, 0].map((at) => ({ at, cmd: chat() }))).sent.map((s) => s.at)).toEqual([0, 0, 0, 0]);
    expect(play([0, 0, 0, 0, 0].map((at) => ({ at, cmd: chat() }))).sent[4]?.at).toBeGreaterThan(ACTOR_CHAT_WINDOW_MS);
  });

  it("holds lines and thoughts a 4x replay would have dropped, and the hotel takes every one", () => {
    // 20 lines 1.2 s apart in the recording, squeezed to 0.3 s by a 4x replay
    const due = Array.from({ length: 20 }, (_, i): Due => ({ at: i * 300, cmd: i % 3 === 0 ? thought() : chat() }));
    expect(unpaced(due).refused.length).toBeGreaterThan(0);
    const { sent, hotel } = play(due);
    expect(hotel.refused).toEqual([]);
    expect(sent.map((s) => s.at)).toEqual([...sent.map((s) => s.at)].sort((a, b) => a - b));
    for (let i = ACTOR_CHAT_PER_WINDOW; i < sent.length; i += 1) expect((sent[i]?.at ?? 0) - (sent[i - ACTOR_CHAT_PER_WINDOW]?.at ?? 0)).toBeGreaterThan(ACTOR_CHAT_WINDOW_MS);
  });

  it("holds moves and actions: walk, sit, gesture, expression and face share the 8 per 5 s budget", () => {
    const kinds: ActorCmd[] = [walk, { k: "sit", furni: 1 }, wave, smile, face, { k: "action", action: "laugh" }, { k: "action", action: "stand" }];
    const due = Array.from({ length: 30 }, (_, i): Due => ({ at: i * 100, cmd: kinds[i % kinds.length] as ActorCmd }));
    expect(unpaced(due).refused.length).toBeGreaterThan(0);
    const { sent, hotel } = play(due);
    expect(hotel.refused).toEqual([]);
    for (let i = ACTOR_CMDS_PER_WINDOW; i < sent.length; i += 1) expect((sent[i]?.at ?? 0) - (sent[i - ACTOR_CMDS_PER_WINDOW]?.at ?? 0)).toBeGreaterThan(ACTOR_CMD_WINDOW_MS);
  });

  it("holds typing bubbles, but never an off", () => {
    const due = Array.from({ length: 12 }, (_, i): Due => ({ at: i * 200, cmd: i % 2 === 0 ? typingOn : typingOff }));
    const { sent, hotel } = play(due);
    expect(hotel.refused).toEqual([]);
    expect(unpaced(Array.from({ length: 20 }, (_, i): Due => ({ at: i * 200, cmd: typingOn }))).refused.length).toBeGreaterThan(0);
    expect(play(Array.from({ length: 20 }, (_, i): Due => ({ at: i * 200, cmd: typingOn }))).hotel.refused).toEqual([]);
    expect(sent.length).toBe(12);
  });

  it("holds a door taken right after a spawn or another door, so the hotel does not refuse the join", () => {
    const due: Due[] = [{ at: 50, cmd: door }, { at: 60, cmd: door }, { at: 70, cmd: walk }];
    expect(unpaced(due).refused.length).toBeGreaterThan(0);
    const { sent, hotel } = play(due, 0);
    expect(hotel.refused).toEqual([]);
    expect((sent[0]?.at ?? 0) - 0).toBeGreaterThanOrEqual(JOIN_INTERVAL_MS);
    expect((sent[1]?.at ?? 0) - (sent[0]?.at ?? 0)).toBeGreaterThanOrEqual(JOIN_INTERVAL_MS);
  });

  it("mixes every kind in one burst and loses none", () => {
    const kinds: ActorCmd[] = [chat(), walk, typingOn, thought(), wave, door, smile, face, chat(), typingOff];
    const due = Array.from({ length: 80 }, (_, i): Due => ({ at: i * 50, cmd: kinds[i % kinds.length] as ActorCmd }));
    const { sent, hotel } = play(due, 0);
    expect(hotel.refused).toEqual([]);
    expect(sent.length).toBe(80);
  });
});

describe("a 4x replay through the sidecar, against a hotel that enforces its limits", () => {
  let fake: FakeDirector | undefined;
  let sidecar: Sidecar | undefined;
  afterEach(async () => {
    await sidecar?.close();
    await fake?.stop();
    sidecar = fake = undefined;
  });

  it("delivers every recorded line, gesture, expression and move to the watcher", async () => {
    fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4, enforceBudgets: true });
    fake.addRoom(12);
    fake.addRoom(14);
    fake.addHuman(14, 9, "ana", 6, 5);
    const booted = await bootSidecar({ fake, timing: { replayTailMs: 100 } });
    sidecar = booted.sidecar;

    // A lively recording: 9 lines, 12 gestures, expressions and moves, one every 100 ms, from one actor.
    const ref = ((compiledScenario().body as { config: { agents: Array<{ id: string }> } }).config.agents[0] as { id: string }).id;
    const frame = (atMs: number, cmd: unknown) => ({ atMs, dir: "out", room: "12", kind: "actor_cmd", data: { actor: ref, cmd } });
    const recorded: ActorCmd[] = [];
    for (let i = 0; i < 21; i += 1) {
      if (i % 7 < 3) recorded.push({ k: "chat", mode: i % 2 === 0 ? "say" : "thought", text: `linha ${i}` });
      else recorded.push([wave, smile, face, { k: "walk", x: 3 + (i % 3), y: 3 }][i % 4] as ActorCmd);
    }
    const dir = join(booted.cfg.dataDir, "runs", "77");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "replay.json"), JSON.stringify({ run: 77, scenarioVersion: 31, startedAt: 0, home: 12, mode: "default", actors: {} }));
    writeFileSync(join(dir, "body-frames.json"), JSON.stringify({ frames: recorded.map((cmd, i) => frame(1000 + i * 100, cmd)) }));

    fake.grantLease(80);
    fake.pmCommand(80, 14, "replay", "77 default 4x", "chat");
    await waitFor(() => fake?.received.find((f) => f.t === "run_end" && f.run === 80), "the replay's run_end", 30_000);

    expect(fake.refused).toEqual([]);
    const sentByReplay = fake.received.filter((f) => f.t === "actor_cmd" && f.run === 80).length;
    expect(sentByReplay).toBe(recorded.length);
  }, 40_000);
});
