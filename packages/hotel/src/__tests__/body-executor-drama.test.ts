import type { BlockedReason } from "@perfectman/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BodyExecutor } from "../embodiment/body-executor.js";
import type { ActLock } from "../embodiment/act-ledger.js";
import type { PlannedCommand } from "../embodiment/types.js";
import type { SidecarMsg } from "../director/index.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import { avatar, snapshot } from "../testing/fixtures.js";
import { actFrames } from "../testing/fake-drama.js";
import { ManualClock } from "../testing/manual-clock.js";

function setup(over: { dead?: Set<string>; locks?: Map<string, ActLock>; ghost?: boolean } = {}) {
  const clock = new ManualClock(10_000);
  const mirror = new HotelSpaceMirror();
  mirror.applySnapshot(snapshot(12, 1, [avatar(-701, "Duda", 1, 4), avatar(-702, "Rafa", 2, 6), avatar(9, "ana", 7, 4)]), clock.now());
  mirror.registerActor({ ref: "duda", id: -701, run: 7, name: "Duda" }, "12", clock.now());
  mirror.registerActor({ ref: "rafa", id: -702, run: 7, name: "Rafa" }, "12", clock.now());
  const sent: SidecarMsg[] = [];
  const blocked: Array<[string, BlockedReason[]]> = [];
  const ghosts: Array<[string, string]> = [];
  const dead: string[] = [];
  let cid = 0;
  const exec = new BodyExecutor({
    run: 7, clock, rng: () => 0.5, mirror, lease: () => 3, nextCid: () => ++cid,
    send: (m) => (sent.push(m), true),
    isDead: (ref) => over.dead?.has(ref) === true,
    lockOf: (ref) => over.locks?.get(ref),
    ghostVoice: over.ghost === true,
    hooks: {
      blocked: (a, r) => blocked.push([a, r]), arrived: () => undefined, pairAborted: () => undefined, pairOutcome: () => undefined,
      ghost: (a, t) => ghosts.push([a, t]), actorDead: (a) => dead.push(a),
    },
  });
  const cmds = () => sent.flatMap((m) => (m.t === "actor_cmd" ? [m.cmd.k] : []));
  return { exec, sent, cmds, blocked, ghosts, dead, clock, mirror };
}

const say = (agentId: string): PlannedCommand => ({ agentId, cmd: "chat", mode: "say", text: "oi" });
const cry = (agentId: string, actId: string, owed = false): PlannedCommand => ({ agentId, cmd: "act", actId, verb: "cry", ...(owed ? { owed: true } : {}) });

describe("the dead speaker pool (DEATH-2, ACT-11)", () => {
  it("[DEATH-2] a dead actor sends nothing at all, speech or body, and an alive one is not affected", () => {
    const { exec, cmds } = setup({ dead: new Set(["rafa"]) });
    exec.send([say("rafa"), { agentId: "rafa", cmd: "typing", on: true }, { agentId: "rafa", cmd: "face", dir: 2 }, cry("rafa", "a1"), say("duda")]);
    exec.sendThought("rafa", "ainda estou aqui");
    expect(cmds()).toEqual(["chat"]);
  });

  it("[DEATH-2] a dead actor that comes back at the revive speaks again", () => {
    const dead = new Set(["rafa"]);
    const { exec, cmds } = setup({ dead });
    exec.send([say("rafa")]);
    dead.delete("rafa");
    exec.send([say("rafa")]);
    expect(cmds()).toEqual(["chat"]);
  });

  it("[DEATH-2] the optional ghost voice is a thought and only a thought, never on the wire, and only when the flag is on", () => {
    const on = setup({ dead: new Set(["rafa"]), ghost: true });
    on.exec.send([say("rafa")]);
    on.exec.sendThought("rafa", "  frio   aqui ");
    expect(on.cmds()).toEqual([]);
    expect(on.ghosts).toEqual([["rafa", "oi"], ["rafa", "frio aqui"]]);
    const off = setup({ dead: new Set(["rafa"]) });
    off.exec.send([say("rafa")]);
    off.exec.sendThought("rafa", "frio aqui");
    expect(off.ghosts).toEqual([]);
  });

  it("[ACT-11] when the hotel itself answers actor_dead the executor learns it and does not count it as a body problem", () => {
    const { exec, blocked, dead } = setup();
    exec.send([{ agentId: "rafa", cmd: "face", dir: 2 }]);
    exec.handleFrame({ t: "actor_error", seq: 1, cid: 1, actor: -702, code: "actor_dead", detail: "a9" });
    expect(dead).toEqual(["rafa"]);
    expect(blocked).toEqual([]);
  });

  it("[DEATH-2] property: whatever dies and revives in whatever order, a dead actor never puts a chat, a thought or a typing frame on the wire", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom("kill", "revive", "say", "type", "thought", "face"), fc.constantFrom("duda", "rafa")), { minLength: 1, maxLength: 40 }), (ops) => {
        const dead = new Set<string>();
        const { exec, sent } = setup({ dead });
        const speechWhileDead: string[] = [];
        let mark = 0;
        for (const [op, who] of ops) {
          if (op === "kill") dead.add(who);
          else if (op === "revive") dead.delete(who);
          else if (op === "say") exec.send([say(who)]);
          else if (op === "type") exec.send([{ agentId: who, cmd: "typing", on: true }]);
          else if (op === "thought") exec.sendThought(who, "hm");
          else exec.send([{ agentId: who, cmd: "face", dir: 2 }]);
          for (const m of sent.slice(mark)) {
            if (m.t === "actor_cmd" && (m.cmd.k === "chat" || m.cmd.k === "typing") && dead.has(m.actor === -701 ? "duda" : "rafa")) speechWhileDead.push(m.cmd.k);
          }
          mark = sent.length;
        }
        expect(speechWhileDead).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

describe("the executor half of the act lock and the 8 per 5 s budget (ACT-12, ACT-3)", () => {
  it("[ACT-12] a body command from a held actor is dropped before the socket and spends no budget, a spoken line still goes, and a reaction owed to the hotel's own debt does too", () => {
    const locks = new Map<string, ActLock>([["duda", { actId: "a1", why: "owed" }]]);
    const { exec, cmds, blocked } = setup({ locks });
    exec.send([{ agentId: "duda", cmd: "face", dir: 2 }, { agentId: "duda", cmd: "walk", to: [3, 4] }, say("duda"), cry("duda", "a9", true)]);
    expect(cmds()).toEqual(["chat", "act"]);
    expect(blocked.map(([, r]) => r)).toEqual([[{ code: "busy_moving", part: "face", detail: "owed" }], [{ code: "busy_moving", part: "move", detail: "owed" }]]);
  });

  it("[ACT-3] the planner's own acts stop at 4 in 5 s like any command, an owed reaction may use the hotel's 8, and the ninth is a slow_down", () => {
    const { exec, cmds, blocked } = setup();
    for (let i = 0; i < 4; i++) exec.send([cry("duda", `a${i}`)]);
    exec.send([cry("duda", "a4")]);
    expect(cmds()).toHaveLength(4);
    for (let i = 5; i < 9; i++) exec.send([cry("duda", `r${i}`, true)]);
    expect(cmds()).toHaveLength(8);
    exec.send([cry("duda", "r9", true)]);
    expect(cmds()).toHaveLength(8);
    expect(blocked.at(-1)?.[1]).toEqual([{ code: "slow_down", part: "act" }]);
  });

  it("[ACT-3] the budget window rolls: after 5 s the actor can act again", async () => {
    const { exec, cmds, clock, mirror } = setup();
    for (let i = 0; i < 4; i++) exec.send([cry("duda", `a${i}`)]);
    await clock.advance(5001);
    mirror.applySnapshot(snapshot(12, 2, [avatar(-701, "Duda", 1, 4), avatar(-702, "Rafa", 2, 6), avatar(9, "ana", 7, 4)]), clock.now());
    exec.send([cry("duda", "b1")]);
    expect(cmds()).toHaveLength(5);
  });
});

describe("what the hotel says about an act, in the executor's own frame switch (BLOCK_MAP, PAIR-1)", () => {
  it("[ACT-12] act_busy is a body that is busy; bad_target is a target that is not there; neither is dressed up as anything else", () => {
    const { exec, blocked } = setup();
    exec.send([{ agentId: "duda", cmd: "act", actId: "a1", verb: "glare", with: "rafa" }]);
    exec.handleFrame({ t: "actor_error", seq: 1, cid: 1, actor: -701, code: "act_busy", detail: "a7" });
    exec.send([{ agentId: "duda", cmd: "act", actId: "a2", verb: "glare", with: "rafa" }]);
    exec.handleFrame({ t: "actor_error", seq: 2, cid: 2, actor: -701, code: "bad_target", detail: "bot" });
    expect(blocked.map(([, r]) => r.map((x) => x.code))).toEqual([["busy_moving"], ["target_elsewhere"]]);
  });

  it("[PAIR-1] a pair the hotel refused with a reason is a blocked reason for the planner, like a blocked act", () => {
    const { exec, blocked } = setup();
    exec.handleFrame({ t: "pair_reaction", seq: 1, run: 7, pair: "p1", actor: -701, with: 9, outcome: "aborted", reason: "calm_room", at: 1 });
    expect(blocked).toEqual([["duda", [{ code: "calm_room", part: "gesture" }]]]);
  });

  it("[FRM-2] a blocked act is reported to the planner with the hotel's reason; every other drama frame is the sink's, and the executor reads none of it", () => {
    const { exec, blocked } = setup();
    for (const f of actFrames({ actId: "a1", verb: "punch", with: 9, outcome: "blocked", reason: "consent_off" })) exec.handleFrame({ ...f, seq: 1 });
    for (const f of actFrames({ actId: "a2", verb: "slap", with: -702, outcome: "landed", witnesses: [], owed: [] })) exec.handleFrame({ ...f, seq: 1 });
    expect(blocked).toEqual([["duda", [{ code: "consent_off", part: "act" }]]]);
  });
});
