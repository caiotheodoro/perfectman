import { describe, expect, it } from "vitest";
import type { BlockedReason } from "@perfectman/shared";
import { CinematicDirector } from "../director/cine/cinematic-director.js";
import { FakeWorld } from "../director/cine/__tests__/cine-helpers.js";
import { Narrator } from "../director/cine/narrator.js";
import type { ActorCmd, HotelMsg, SidecarMsg } from "../director/index.js";
import { BodyExecutor } from "../embodiment/body-executor.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import { avatar, delta, snapshot } from "../testing/fixtures.js";
import { ManualClock } from "../testing/manual-clock.js";
import { silentLogger } from "../util/log.js";

/** A real body executor behind a real cinematic director, on a manual clock: duda (5,4) next to rafa (6,4). */
function rig(opts: { cinematic: boolean }) {
  const clock = new ManualClock(10_000);
  const mirror = new HotelSpaceMirror();
  mirror.applySnapshot(snapshot(12, 1, [avatar(-701, "Duda", 5, 4), avatar(-702, "Rafa", 6, 4)]), clock.now());
  mirror.registerActor({ ref: "duda", id: -701, run: 7, name: "Duda" }, "12", clock.now());
  mirror.registerActor({ ref: "rafa", id: -702, run: 7, name: "Rafa" }, "12", clock.now());
  const sent: SidecarMsg[] = [];
  const blocked: Array<{ agentId: string; reasons: BlockedReason[] }> = [];
  const aborted: string[] = [];
  let cid = 0;
  let rev = 1;
  const exec = new BodyExecutor({
    run: 7, clock, rng: () => 0.5, mirror, lease: () => 1, nextCid: () => ++cid,
    send: (m) => (sent.push(m), true),
    hooks: {
      blocked: (agentId, reasons) => blocked.push({ agentId, reasons }),
      arrived: () => undefined,
      pairAborted: (i) => aborted.push(i.cause),
      pairOutcome: () => undefined,
    },
  });
  const cmds = (): ActorCmd[] => sent.flatMap((m) => (m.t === "actor_cmd" ? [m.cmd] : []));
  const cmdsOf = (actor: number): ActorCmd[] => sent.flatMap((m) => (m.t === "actor_cmd" && m.actor === actor ? [m.cmd] : []));
  const frame = (f: HotelMsg): void => exec.handleFrame({ ...f, seq: 0 });
  /** What the hotel does when a walk ends: the avatar is there, then `arrived`. */
  const arrive = (actor: number, x: number, y: number, plan: string): void => {
    mirror.applyDelta(delta(12, ++rev, { t: "moves", moves: [{ id: actor, x, y, dir: 2, state: "stand" }] }), clock.now());
    frame({ t: "arrived", actor, room: 12, x, y, plan });
  };
  /** Time passes; the hotel keeps the room fresh. */
  const wait = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 250) {
      mirror.applyPing({ t: "room_ping", room: 12, rev }, clock.now());
      await clock.advance(250);
    }
  };
  const world = new FakeWorld();
  const director = new CinematicDirector({
    run: 7, home: 12, clock, world, narrator: new Narrator({ clock, language: "pt-BR" }), send: (m) => (sent.push(m), true), logger: silentLogger,
    config: { minShotMs: 100, introMs: 400, cueLeadMs: 10, typingLeadMs: 20, beatGapMs: 20, narratorWaitMs: 10, easeMs: { establishing: 20, two_shot: 20, close_up: 20, tracking: 20, reaction: 20 } },
  });
  if (opts.cinematic) director.start();
  const out = opts.cinematic ? director.wrapExecutor(exec) : exec;
  return { clock, mirror, exec, out, sent, cmds, cmdsOf, blocked, aborted, frame, arrive, wait, director };
}

describe("a pair act and a walk that is still under way", () => {
  it("cinematic: the partner's walk is held in the buffer; the kiss waits for it to arrive, then approaches (no not_adjacent)", async () => {
    const r = rig({ cinematic: true });
    await r.wait(2000);
    // rafa walks away (held for its shot) and duda asks to kiss rafa, who is still next to her on the mirror
    r.out.send([{ agentId: "rafa", cmd: "walk", to: [9, 4], plan: "r1" }]);
    r.out.send([{ agentId: "duda", cmd: "pair", kind: "kiss", with: "rafa", pair: "k1" }]);
    await r.wait(8000);

    // the walk went out first and was ordered before the kiss; the kiss did not start
    expect(r.cmdsOf(-702)).toEqual([expect.objectContaining({ k: "walk", x: 9, y: 4, plan: "r1" })]);
    expect(r.cmdsOf(-701).filter((c) => c.k === "face" || c.k === "action" || c.k === "pair")).toEqual([]);
    expect(r.cmdsOf(-701).filter((c) => c.k === "walk")).toEqual([]);

    // rafa arrives at (9,4): only now does duda act, and she walks to him first
    r.arrive(-702, 9, 4, "r1");
    expect(r.cmdsOf(-701)).toEqual([expect.objectContaining({ k: "walk", plan: "k1:walk" })]);
    const approach = r.cmdsOf(-701)[0] as Extract<ActorCmd, { k: "walk" }>;
    r.arrive(-701, approach.x, approach.y, "k1:walk");
    await r.wait(1000);
    expect(r.cmdsOf(-701).map((c) => c.k)).toEqual(["walk", "face", "pair"]);
    expect(r.aborted).toEqual([]);
    expect(r.blocked).toEqual([]);
  });

  it("default mode: a pair asked while the actor's own walk is under way waits for it, too", async () => {
    const r = rig({ cinematic: false });
    r.exec.send([{ agentId: "duda", cmd: "walk", to: [3, 4], plan: "d1" }]);
    r.exec.send([{ agentId: "duda", cmd: "pair", kind: "hug", with: "rafa", pair: "k2" }]);
    expect(r.cmdsOf(-701).map((c) => c.k)).toEqual(["walk"]);
    r.arrive(-701, 3, 4, "d1");
    // duda is now 3 tiles from rafa: she approaches, she does not hug from afar
    expect(r.cmdsOf(-701).map((c) => c.k)).toEqual(["walk", "walk"]);
  });

  it("a walk the hotel refuses does not hold the act forever", async () => {
    const r = rig({ cinematic: false });
    r.exec.send([{ agentId: "rafa", cmd: "walk", to: [9, 4], plan: "r2" }]);
    r.exec.send([{ agentId: "duda", cmd: "pair", kind: "kiss", with: "rafa", pair: "k3" }]);
    expect(r.cmdsOf(-701)).toEqual([]);
    // The hotel finds no route to the tile asked for or to the two nearest ones the body tries instead (errata P7): then the act stops waiting.
    for (let i = 0; i < 3; i++) {
      const cid = r.sent.flatMap((m) => (m.t === "actor_cmd" && m.actor === -702 && m.cmd.k === "walk" ? [m.cid] : [])).at(-1);
      r.frame({ t: "actor_error", cid, actor: -702, code: "no_route" });
      if (i < 2) expect(r.cmdsOf(-701)).toEqual([]);
    }
    await r.wait(1000);
    expect(r.cmdsOf(-701).map((c) => c.k)).toEqual(["face", "pair"]);
  });

  it("an act whose walk never ends times out as an aborted pair, not a stuck one", async () => {
    const r = rig({ cinematic: false });
    r.exec.send([{ agentId: "rafa", cmd: "walk", to: [9, 4], plan: "r3" }]);
    r.exec.send([{ agentId: "duda", cmd: "pair", kind: "kiss", with: "rafa", pair: "k4" }]);
    await r.wait(16_000);
    expect(r.aborted).toEqual(["timeout"]);
  });
});
