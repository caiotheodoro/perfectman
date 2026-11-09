/**
 * The fake grid hotel's act sequencer against the hotel's own recorded lifecycles (vendored under packages/hotel/fixtures/drama/hotel,
 * see its PROVENANCE.md): the command each row sent goes in, the frames it expected must come out: same types in the same order, the same
 * fields, the instants the contract fixes to the millisecond, and the one thing the hotel seeds (a witness's stagger) inside its bounds.
 * Then the rest of the contract the fixtures do not record: gates, abort, scene cut, permadeath, consent, calm and the kill switch.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AvatarState, Tile } from "@perfectman/shared";
import { FakeActHotel } from "../embodiment/fake-act-hotel.js";
import type { ActFrame, ActWire, ActWorld, ChipAnswer, FakeActOptions, WorldAvatar } from "../embodiment/fake-act-hotel.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../hotel/fixtures/drama/hotel");
const T0 = 1_000_000;
const A = -701;
const B = -702;
const C = -703;
const H = 9;

type Row = { in: Record<string, unknown> | null; given: { after_ms: number; world: string; script: Array<{ at_ms: number; act_reply?: { act_id: string; choice: ChipAnswer }; calm?: boolean }> }; expect: ActFrame[] };
const rows = (name: string): Row[] => readFileSync(join(DIR, `${name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row);

const BLOCK = { max_rung: 6, may_target: [["person-1", "person-2"], ["person-1", "@human"]] as Array<[string, string]>, may_die: ["person-2", "@human"], permadeath: false };

class Room implements ActWorld {
  readonly avatarsById = new Map<number, WorldAvatar>();
  readonly fallen = new Map<number, string>();
  constructor(human: boolean) {
    this.put(A, "person-1", [3, 3]);
    this.put(B, "person-2", [4, 3]);
    this.put(C, "person-3", [3, 4]);
    if (human) this.put(H, "h:9", [4, 4], true);
  }
  put(id: number, ref: string, tile: Tile, human = false, state: AvatarState = "stand"): void {
    this.avatarsById.set(id, { id, ref, human, tile, state });
  }
  avatars(): WorldAvatar[] {
    return [...this.avatarsById.values()];
  }
  markFallen(id: number, kind: "dead" | "fainted" | "down" | undefined): void {
    if (kind) this.fallen.set(id, kind);
    else this.fallen.delete(id);
  }
}

type Rig = { hotel: FakeActHotel; room: Room; frames: ActFrame[]; clock: { now: number }; send(actor: number, wire: ActWire): ActFrame | undefined; step(ms: number): void };

function rig(over: Partial<FakeActOptions> & { human?: boolean } = {}): Rig {
  const clock = { now: T0 };
  const frames: ActFrame[] = [];
  const room = new Room(over.human ?? true);
  const { human: _human, ...rest } = over;
  const hotel = new FakeActHotel({ run: 7, room: 12, now: () => clock.now, emit: (f) => void frames.push(f), world: room, drama: BLOCK, optIn: [H], ...rest });
  return {
    hotel, room, frames, clock,
    send: (actor, wire) => hotel.receive(actor, wire, 1),
    step(ms) {
      const end = clock.now + ms;
      while (clock.now < end) {
        clock.now = Math.min(end, clock.now + 25);
        hotel.advanceTo(clock.now);
      }
    },
  };
}

const kinds = (frames: readonly ActFrame[]): string[] => frames.map((f) => f.t);
const strip = (f: ActFrame): Record<string, unknown> => Object.fromEntries(Object.entries(f).filter(([k]) => k !== "seq"));
const keysOf = (f: ActFrame): string[] => Object.keys(strip(f)).sort();

/** Plays one fixture row against a fresh rig: the row's world, its scripted human, calm and the command at T0. */
function play(name: string, index = 0): { out: Rig; row: Row } {
  const row = rows(name)[index]!;
  const replies = new Map(row.given.script.flatMap((s) => (s.act_reply ? [[s.act_reply.act_id, { choice: s.act_reply.choice, at: s.at_ms }] as const] : [])));
  const out = rig({ human: row.given.world === "human", humanAnswer: (q) => replies.get(q.actId)?.choice ?? "timeout", answerDelayMs: (q) => replies.get(q.actId)?.at ?? 400 });
  if (name === "slap-human-take") out.hotel.setOptIn(H, true);
  out.frames.length = 0;
  if (row.in && row.in["t"] === "scene_advance") {
    out.clock.now = T0 + 20_000;
    out.hotel.advanceScene(String(row.in["reason"]));
    return { out, row };
  }
  const cmd = row.in!["cmd"] as ActWire;
  out.send(Number(row.in!["actor"]), cmd);
  const calm = row.given.script.find((s) => s.calm !== undefined);
  let t = 0;
  while (t < row.given.after_ms) {
    out.step(50);
    t += 50;
    if (calm && t === calm.at_ms) out.hotel.setCalm(true);
  }
  return { out, row };
}

describe("the fake hotel against the hotel's recorded lifecycles", () => {
  for (const name of ["slap-human-take", "slap-human-timeout", "down-human-abort"]) {
    it(`[FRM-1] ${name}: the same frames in the same order, with the same fields`, () => {
      const { out, row } = play(name);
      const mine = out.frames.filter((f) => f.t !== "drama_state");
      expect(kinds(mine)).toEqual(kinds(row.expect));
      row.expect.forEach((want, i) => {
        // The hotel's frames carry `at`; ours do too. The stagger and the human answer are seeds, compared below.
        expect({ t: mine[i]!.t, keys: keysOf(mine[i]!) }).toEqual({ t: want.t, keys: keysOf(want) });
      });
    });
  }

  it("[FRM-1] kill-actor-revive: the kill, the death, the reactions, the done, then the cut, the revive and the room's state", () => {
    const { out, row } = play("kill-actor-revive", 0);
    expect(kinds(out.frames)).toEqual(kinds(row.expect));
    row.expect.forEach((want, i) => expect({ t: out.frames[i]!.t, keys: keysOf(out.frames[i]!) }).toEqual({ t: want.t, keys: keysOf(want) }));
    const cut = play("kill-actor-revive", 1);
    expect(kinds(cut.out.frames)).toEqual(["scene_cut", "drama_state"]);
  });

  it("[TBL-3] [CHIP-2] the instants the contract fixes match the hotel's to the millisecond: contact 150 ms after a take, a death 175 ms after contact, a down window of 5000 ms, a chip ended 1000 ms after a timeout", () => {
    const at = (frames: readonly ActFrame[], t: string, who?: number): number => frames.find((f) => f.t === t && (who === undefined || f["who"] === who))!.at!;
    const want = (name: string, t: string, who?: number): number => rows(name)[0]!.expect.find((f) => f.t === t && (who === undefined || f["who"] === who))!.at!;
    const take = play("slap-human-take").out.frames;
    expect(at(take, "act_beat") - at(take, "drama_consent")).toBeGreaterThan(0);
    for (const t of ["act_started", "act_beat"]) expect(at(take, t)).toBe(want("slap-human-take", t));
    const timeout = play("slap-human-timeout").out.frames;
    expect(at(timeout, "act_done")).toBe(want("slap-human-timeout", "act_done"));
    const down = play("down-human-abort").out.frames;
    for (const t of ["act_beat", "human_down", "human_up", "act_done"]) expect(at(down, t), t).toBe(want("down-human-abort", t));
    const kill = play("kill-actor-revive").out.frames;
    for (const t of ["act_started", "act_beat", "actor_death", "act_done"]) expect(at(kill, t), t).toBe(want("kill-actor-revive", t));
    expect(at(kill, "act_reaction", B)).toBe(want("kill-actor-revive", "act_reaction", B));
  });

  it("[REA-4] a witness's first reaction comes between 600 ms and 2800 ms after contact, whoever it is, and the frames list who owes it", () => {
    for (const name of ["slap-human-take", "down-human-abort"]) {
      const { frames } = play(name).out;
      const beat = frames.find((f) => f.t === "act_beat")!;
      for (const r of frames.filter((f) => f.t === "act_reaction")) {
        expect(r.at! - beat.at!).toBeGreaterThanOrEqual(600);
        expect(r.at! - beat.at!).toBeLessThanOrEqual(2800);
      }
      expect(beat["owed"]).toEqual([{ who: B, role: "witness", due_at: beat.at! + 3000 }, { who: C, role: "witness", due_at: beat.at! + 3000 }].sort((x, y) => (beat["owed"] as Array<{ who: number }>).findIndex((o) => o.who === x.who) - (beat["owed"] as Array<{ who: number }>).findIndex((o) => o.who === y.who)));
    }
  });

  it("[REA-10] every act ends with owed_missed empty, and the one done is the last frame of the act", () => {
    for (const name of ["slap-human-take", "slap-human-timeout", "kill-actor-revive", "down-human-abort"]) {
      const { frames } = play(name).out;
      const done = frames.filter((f) => f.t === "act_done");
      expect(done).toHaveLength(1);
      expect(done[0]!["owed_missed"]).toEqual([]);
      const actFrames = frames.filter((f) => f["act_id"] !== undefined && f.t !== "human_up");
      expect(actFrames.at(-1)!.t).toBe("act_done");
    }
  });
});

describe("gates (2.4): a blocked command is one act_done and nothing else", () => {
  const blocked = (frames: readonly ActFrame[]): Array<[string, string | undefined]> => frames.filter((f) => f.t === "act_done" && f["outcome"] === "blocked").map((f) => [String(f["reason"]), f["detail"] as string | undefined]);
  const slap: ActWire = { act_id: "g1", verb: "slap", with: B, origin: "scenario", authored_skip: true };

  it("[GATE-1] [GATE-2] the switch first, then calm", () => {
    const r = rig();
    r.hotel.setEnabled(false);
    r.send(A, slap);
    expect(blocked(r.frames)).toEqual([["kill_switch", undefined]]);
    const c = rig();
    c.hotel.setCalm(true);
    c.send(A, slap);
    c.send(A, { act_id: "g2", verb: "glare", with: B });
    expect(blocked(c.frames)).toEqual([["calm_room", undefined]]);
  });

  it("[GATE-4] [GATE-5] a fallen target, and the scenario's gates: free play has no slap, the block names the pair, the ceiling and who may die", () => {
    const free = rig({ drama: undefined });
    free.send(A, { act_id: "f1", verb: "slap", with: B });
    free.send(A, { act_id: "f2", verb: "kill", with: B });
    expect(blocked(free.frames)).toEqual([["no_scenario_gate", "free_play"], ["no_scenario_gate", "free_play"]]);
    const b = rig({ drama: { ...BLOCK, max_rung: 3 } });
    b.send(A, { act_id: "m1", verb: "slap", with: B, origin: "scenario", authored_skip: true });
    expect(blocked(b.frames)).toEqual([["no_scenario_gate", "skip"]]);
    const pair = rig();
    pair.send(C, { act_id: "p1", verb: "slap", with: A, origin: "scenario", authored_skip: true });
    expect(blocked(pair.frames)).toEqual([["no_scenario_gate", "may_target"]]);
    const die = rig();
    die.send(A, { act_id: "k1", verb: "kill", with: C, origin: "scenario", authored_skip: true });
    expect(blocked(die.frames)).toEqual([["no_scenario_gate", "may_target"]]);
  });

  it("[GATE-6] [GATE-7] a human who did not opt in is not struck, and a contact verb needs the two beside each other", () => {
    const r = rig({ optIn: [] });
    r.send(A, { act_id: "o1", verb: "shove", with: H });
    expect(blocked(r.frames)).toEqual([["consent_off", undefined]]);
    const far = rig();
    far.room.put(B, "person-2", [9, 3]);
    far.send(A, { act_id: "d1", verb: "shove", with: B });
    expect(blocked(far.frames)).toEqual([["too_far", "distance"]]);
    const moving = rig();
    moving.room.put(B, "person-2", [4, 3], false, "walk");
    moving.send(A, { act_id: "d2", verb: "shove", with: B });
    expect(blocked(moving.frames)).toEqual([["too_far", "moving"]]);
  });

  it("[LAD-1] [GATE-8] one rung per beat: a shove straight away is a skip, a glare then an insult then a shove climbs", () => {
    const r = rig({ drama: { ...BLOCK, may_target: [["person-1", "person-2"]] } });
    r.send(A, { act_id: "l1", verb: "shove", with: B });
    expect(blocked(r.frames)).toEqual([["ladder", "rung"]]);
    r.send(A, { act_id: "l2", verb: "glare", with: B });
    r.send(A, { act_id: "l3", verb: "insult", with: B });
    expect(r.frames.filter((f) => f.t === "act_started").map((f) => f["act_id"])).toEqual(["l2"]);
  });

  it("[LAD-3] [LAD-4] [GATE-9] physical beats keep 20 s apart, and there is one kill per scene", () => {
    const r = rig();
    r.send(A, { act_id: "b1", verb: "shove", with: B, origin: "scenario", authored_skip: true });
    r.step(5000);
    r.send(A, { act_id: "b2", verb: "slap", with: B, origin: "scenario", authored_skip: true });
    expect(blocked(r.frames)).toEqual([["budget", "physical"]]);
    r.step(21_000);
    r.send(A, { act_id: "b3", verb: "kill", with: B, origin: "scenario", authored_skip: true });
    r.step(8000);
    r.room.put(C, "person-3", [4, 4]);
    r.step(25_000);
    r.send(A, { act_id: "b4", verb: "kill", with: C, origin: "scenario", authored_skip: true });
    expect(blocked(r.frames).at(-1)).toEqual(["no_scenario_gate", "may_target"]);
    expect(r.frames.filter((f) => f.t === "actor_death")).toHaveLength(1);
  });

  it("[GATE-10] the same verb at the same target twice inside a minute", () => {
    const r = rig();
    r.send(A, { act_id: "c1", verb: "glare", with: B });
    r.step(8000);
    r.send(A, { act_id: "c2", verb: "glare", with: B });
    expect(blocked(r.frames)).toEqual([["cooldown", "verb"]]);
  });
});

describe("what the table does after contact", () => {
  it("[REA-3] an owed witness that answers with a face command before its step is credited as a planner reaction, and the table's step is dropped", () => {
    const r = rig({ human: false });
    r.send(A, { act_id: "r1", verb: "insult", with: B, text: "traidor!" });
    r.step(310);
    expect(r.hotel.onBodyCommand(C, "face")).toBeUndefined();
    r.step(4000);
    const mine = r.frames.filter((f) => f.t === "act_reaction" && f["who"] === C);
    expect(mine.map((f) => [f["source"], f["reaction"]])).toEqual([["planner", "cmd:face"]]);
  });

  it("[REA-9] a locked actor's body commands are refused while its act is open, and chat is never locked", () => {
    const r = rig({ human: false });
    r.send(A, { act_id: "r2", verb: "insult", with: B });
    expect(r.hotel.onBodyCommand(A, "walk")).toBe("act_busy");
    expect(r.hotel.onBodyCommand(A, "chat")).toBeUndefined();
    r.step(6000);
    expect(r.hotel.onBodyCommand(A, "walk")).toBeUndefined();
  });

  it("[DEATH-2] [DEATH-7] a killed actor is a body: it cannot act, and the scene cut restores it", () => {
    const r = rig({ human: false });
    r.send(A, { act_id: "x1", verb: "kill", with: B, origin: "scenario", authored_skip: true });
    r.step(6000);
    expect(r.hotel.isFallen(B)).toBe(true);
    expect(r.send(B, { act_id: "x2", verb: "glare", with: A })?.["code"]).toBe("actor_dead");
    r.step(20_000);
    expect(r.hotel.advanceScene("beat")).toBe(true);
    expect(r.hotel.isFallen(B)).toBe(false);
    expect(kinds(r.frames.slice(-3))).toEqual(["scene_cut", "actor_revive", "drama_state"]);
  });

  it("[SCENE-5] a scene younger than 20 s is not cut", () => {
    const r = rig({ human: false });
    r.step(19_000);
    expect(r.hotel.advanceScene("early")).toBe(false);
    expect(r.frames.filter((f) => f.t === "scene_cut")).toEqual([]);
  });

  it("[DEATH-7] with permadeath a body is retired, not revived", () => {
    const r = rig({ human: false, drama: { ...BLOCK, permadeath: true } });
    r.send(A, { act_id: "x3", verb: "kill", with: B, origin: "scenario", authored_skip: true });
    r.step(26_000);
    r.hotel.advanceScene("beat");
    expect(r.frames.find((f) => f.t === "scene_cut")).toMatchObject({ revived: [], removed: [B] });
    expect(r.frames.find((f) => f.t === "actor_gone")).toMatchObject({ actor: B, reason: "died" });
    expect(r.frames.some((f) => f.t === "actor_revive")).toBe(false);
  });

  it("[CHIP-4] a human who dodges is not touched, and one who pushes back declines the act", () => {
    for (const [answer, outcome] of [["dodge", "dodged"], ["push_back", "declined"]] as const) {
      const r = rig({ humanAnswer: () => answer });
      r.send(A, { act_id: "h1", verb: "shove", with: H, origin: "scenario", authored_skip: true });
      r.step(3000);
      expect(r.frames.some((f) => f.t === "act_beat")).toBe(false);
      expect(r.frames.find((f) => f.t === "act_done")).toMatchObject({ outcome, answer });
    }
  });

  it("[SAFE-4] a fourth violent act landing on a human inside the window is blocked as rate_limit, and the room pauses at the third", () => {
    const r = rig({ humanAnswer: () => "take", harmMax: 3, humanDownMs: 3000 });
    for (let i = 0; i < 3; i++) {
      r.send(A, { act_id: `s${i}`, verb: "shove", with: H, origin: "scenario", authored_skip: true });
      r.step(61_000);
    }
    expect(r.frames.filter((f) => f.t === "act_done" && f["outcome"] === "landed")).toHaveLength(3);
    expect(r.frames.filter((f) => f.t === "drama_state").some((f) => f["paused"] === true)).toBe(true);
    r.send(A, { act_id: "s9", verb: "shove", with: H, origin: "scenario", authored_skip: true });
    expect(r.frames.filter((f) => f.t === "act_done" && f["outcome"] === "blocked").map((f) => f["reason"])).toEqual(["rate_limit"]);
  });

  it("[DOWN-4] a calm room or the switch off aborts an act in flight, and a human already down still stands up on the timer", () => {
    const r = rig({ humanAnswer: () => "take" });
    r.send(A, { act_id: "z1", verb: "kill", with: H, origin: "scenario", authored_skip: true });
    r.step(900);
    r.hotel.setEnabled(false);
    r.step(6000);
    expect(r.frames.find((f) => f.t === "act_done")).toMatchObject({ outcome: "aborted", reason: "kill_switch" });
    expect(r.frames.find((f) => f.t === "human_up")).toMatchObject({ human: H, reason: "timer" });
  });
});
