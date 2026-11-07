import type { BlockedReason } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { BodyExecutor } from "../embodiment/body-executor.js";
import type { PairInfo } from "../embodiment/body-executor.js";
import type { HotelMsg, SidecarMsg } from "../director/index.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import { avatar, delta, snapshot } from "../testing/fixtures.js";

function setup() {
  const clock = new ManualClock(10_000);
  const mirror = new HotelSpaceMirror();
  mirror.applySnapshot(snapshot(12, 1, [avatar(-701, "Duda", 1, 4), avatar(-702, "Rafa", 2, 6), avatar(9, "ana", 7, 4)]), clock.now());
  mirror.registerActor({ ref: "duda", id: -701, run: 7, name: "Duda" }, "12", clock.now());
  mirror.registerActor({ ref: "rafa", id: -702, run: 7, name: "Rafa" }, "12", clock.now());
  const sent: SidecarMsg[] = [];
  const blocked: { agentId: string; reasons: BlockedReason[] }[] = [];
  const aborted: string[] = [];
  const outcomes: string[] = [];
  const arrived: string[] = [];
  let cid = 0;
  const exec = new BodyExecutor({
    run: 7, clock, rng: () => 0.5, mirror, lease: () => 3, nextCid: () => ++cid,
    send: (m) => (sent.push(m), true),
    hooks: {
      blocked: (agentId, reasons) => blocked.push({ agentId, reasons }),
      arrived: (agentId, plan) => arrived.push(`${agentId}:${plan.status}`),
      pairAborted: (i) => aborted.push(i.cause),
      pairOutcome: (i: PairInfo & { outcome: string }) => outcomes.push(i.outcome),
    },
  });
  const cmds = () => sent.flatMap((m) => (m.t === "actor_cmd" ? [m.cmd] : []));
  const frame = (f: HotelMsg): void => exec.handleFrame({ ...f, seq: 0 });
  return { clock, mirror, exec, sent, cmds, blocked, aborted, outcomes, arrived, frame };
}

describe("BodyExecutor", () => {
  it("translates commands to actor_cmd with the run lease, the avatar id and a cid", () => {
    const { exec, sent } = setup();
    exec.send([{ agentId: "duda", cmd: "walk", to: [4, 4], plan: "p1" }, { agentId: "duda", cmd: "gesture", a: "kiss" }, { agentId: "duda", cmd: "chat", mode: "whisper", text: "oi", to: "h:9" }]);
    expect(sent).toMatchObject([
      { t: "actor_cmd", cid: 1, run: 7, lease: 3, actor: -701, cmd: { k: "walk", x: 4, y: 4, plan: "p1" } },
      { t: "actor_cmd", cid: 2, cmd: { k: "action", action: "blow" } },
      { t: "actor_cmd", cid: 3, cmd: { k: "chat", mode: "whisper", text: "oi", to: 9 } },
    ]);
  });

  it("allows 4 commands per 5 s per actor (8 for moves), reports slow_down, and recovers", () => {
    const { clock, exec, cmds, blocked } = setup();
    for (let i = 0; i < 5; i++) exec.send([{ agentId: "duda", cmd: "expression", face: "smile" }]);
    expect(cmds()).toHaveLength(4);
    expect(blocked[0]).toMatchObject({ agentId: "duda", reasons: [{ code: "slow_down", part: "expression" }] });
    for (let i = 0; i < 4; i++) exec.send([{ agentId: "duda", cmd: "walk", to: [i + 3, 4] }]);
    expect(cmds()).toHaveLength(8);
    exec.send([{ agentId: "duda", cmd: "walk", to: [9, 4] }]);
    expect(cmds()).toHaveLength(8);
    void clock;
  });

  it("does not count typing and chat against the body budget, and never sends body commands into a stale room", async () => {
    const { clock, exec, cmds, blocked } = setup();
    for (let i = 0; i < 6; i++) exec.send([{ agentId: "duda", cmd: "typing", on: i % 2 === 0 }]);
    expect(cmds()).toHaveLength(6);
    await clock.advance(5001);
    exec.send([{ agentId: "duda", cmd: "walk", to: [3, 3] }]);
    expect(cmds()).toHaveLength(6);
    expect(blocked.at(-1)?.reasons).toEqual([{ code: "stale_space" }]);
  });

  it("holds a command until the walk it waits for ends, then releases it; a shorter stop blocks it", () => {
    const { exec, cmds, arrived, frame, mirror } = setup();
    exec.send([{ agentId: "duda", cmd: "walk", to: [4, 4], plan: "p9" }, { agentId: "duda", cmd: "move_room", to: "13", afterArrival: "p9" }]);
    expect(cmds().map((c) => c.k)).toEqual(["walk"]);
    mirror.applyDelta(delta(12, 2, { t: "moves", moves: [{ id: -701, x: 4, y: 4, dir: 2, state: "stand" }] }), 10_000);
    frame({ t: "arrived", actor: -701, room: 12, x: 4, y: 4, plan: "p9" });
    expect(arrived).toEqual(["duda:arrived"]);
    expect(cmds().map((c) => c.k)).toEqual(["walk", "move_room"]);
    exec.send([{ agentId: "rafa", cmd: "walk", to: [8, 6], plan: "q1" }, { agentId: "rafa", cmd: "move_room", to: "13", afterArrival: "q1" }]);
    frame({ t: "arrived", actor: -702, room: 12, x: 5, y: 6, plan: "q1" });
    expect(arrived.at(-1)).toBe("rafa:blocked");
    expect(cmds().filter((c) => c.k === "move_room")).toHaveLength(1);
  });

  it("maps hotel errors to blocked reasons for the next prompt", () => {
    const { exec, blocked, frame } = setup();
    exec.send([{ agentId: "duda", cmd: "walk", to: [4, 4] }]);
    frame({ t: "actor_error", cid: 1, actor: -701, code: "no_route" });
    expect(blocked).toEqual([{ agentId: "duda", reasons: [{ code: "no_route" }] }]);
    expect(exec.planOf("duda")).toBeUndefined();
  });
});

describe("BodyExecutor delivery truth", () => {
  it("maps a stale_lease refusal (a command from before the renewed lease) to a stale_space block", () => {
    const { exec, blocked, frame } = setup();
    exec.send([{ agentId: "duda", cmd: "walk", to: [4, 4] }]);
    frame({ t: "actor_error", cid: 1, actor: -701, code: "stale_lease" });
    expect(blocked).toEqual([{ agentId: "duda", reasons: [{ code: "stale_space" }] }]);
  });

  it("sendChat says whether the line reached the hotel: the backstop and a dead link are not deliveries", () => {
    const { exec, sent } = setup();
    const chat = { agentId: "duda", cmd: "chat" as const, mode: "say" as const, text: "oi" };
    expect([1, 2, 3, 4].map(() => exec.sendChat(chat))).toEqual([true, true, true, true]);
    expect(exec.sendChat(chat)).toBe(false);
    expect(sent.filter((m) => m.t === "actor_cmd")).toHaveLength(4);
  });
});

describe("pair choreography (D31)", () => {
  it("allows one in-flight pair per human, whoever starts it, and frees the human when it ends", () => {
    const { exec, cmds, blocked, frame } = setup();
    exec.send([{ agentId: "duda", cmd: "pair", kind: "kiss", with: "h:9", pair: "a1" }]);
    exec.send([{ agentId: "rafa", cmd: "pair", kind: "hug", with: "h:9", pair: "a2" }]);
    // only duda's approach walk went out; rafa was told to wait
    expect(cmds().filter((c) => c.k === "walk")).toHaveLength(1);
    expect(blocked).toEqual([{ agentId: "rafa", reasons: [{ code: "cooldown", part: "gesture" }] }]);
    frame({ t: "pair_reaction", run: 7, pair: "a1", actor: -701, with: 9, outcome: "dodge", at: 0 });
    exec.send([{ agentId: "rafa", cmd: "pair", kind: "hug", with: "h:9", pair: "a3" }]);
    expect(cmds().filter((c) => c.k === "walk")).toHaveLength(2);
  });

  it("approaches, faces, acts, holds and parts; the human's chip outcome reaches the hooks", async () => {
    const { clock, exec, mirror, cmds, frame, outcomes, aborted } = setup();
    exec.send([{ agentId: "duda", cmd: "pair", kind: "kiss", with: "h:9", pair: "k1" }]);
    const walk = cmds()[0];
    expect(walk).toMatchObject({ k: "walk" });
    const plan = walk && walk.k === "walk" ? walk.plan : undefined;
    // She arrives next to him; the sequence moves on to facing.
    mirror.applyDelta(delta(12, 2, { t: "moves", moves: [{ id: -701, x: 6, y: 4, dir: 2, state: "stand" }] }), clock.now());
    frame({ t: "arrived", actor: -701, room: 12, x: 6, y: 4, plan });
    expect(cmds().some((c) => c.k === "face")).toBe(true);
    expect(cmds().some((c) => c.k === "pair")).toBe(false);
    await clock.advance(400);
    const act = cmds().find((c) => c.k === "pair");
    expect(act).toMatchObject({ k: "pair", kind: "kiss", with: 9, pair: "k1" });
    frame({ t: "pair_reaction", run: 7, pair: "k1", actor: -701, with: 9, outcome: "dodge", at: 0 });
    expect(outcomes).toEqual(["dodge"]);
    expect(aborted).toEqual([]);
  });

  it("aborts when either party moves before the act, and when the target leaves", async () => {
    const { clock, exec, mirror, cmds, frame, aborted } = setup();
    mirror.applyDelta(delta(12, 2, { t: "moves", moves: [{ id: 9, x: 2, y: 4, dir: 6, state: "stand" }] }), clock.now());
    exec.send([{ agentId: "duda", cmd: "pair", kind: "kiss", with: "h:9", pair: "k2" }]);
    expect(cmds().some((c) => c.k === "face")).toBe(true);
    exec.onMoved("h:9");
    expect(aborted).toEqual(["movement"]);
    await clock.advance(400);
    expect(cmds().some((c) => c.k === "pair")).toBe(false);
    exec.send([{ agentId: "duda", cmd: "pair", kind: "hug", with: "h:9", pair: "k3" }]);
    exec.onLeft("h:9");
    expect(aborted).toEqual(["movement", "target_lost"]);
    void frame;
  });

  it("an actor target is made to face back, and the act completes", async () => {
    const { clock, exec, mirror, cmds, frame, outcomes } = setup();
    mirror.applyDelta(delta(12, 2, { t: "moves", moves: [{ id: -702, x: 1, y: 5, dir: 0, state: "stand" }] }), clock.now());
    exec.send([{ agentId: "duda", cmd: "pair", kind: "hug", with: "rafa", pair: "k4" }]);
    const faces = cmds().filter((c) => c.k === "face");
    expect(faces).toHaveLength(2);
    await clock.advance(400);
    frame({ t: "pair_reaction", run: 7, pair: "k4", actor: -701, with: -702, outcome: "done", at: 0 });
    expect(outcomes).toEqual(["done"]);
  });
});
