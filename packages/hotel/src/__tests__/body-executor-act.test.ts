import type { BlockedReason } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { BodyExecutor } from "../embodiment/body-executor.js";
import type { SidecarMsg } from "../director/index.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import { avatar, snapshot } from "../testing/fixtures.js";
import { checkFrame } from "../testing/frame-schema.js";
import { ManualClock } from "../testing/manual-clock.js";

function setup() {
  const clock = new ManualClock(10_000);
  const mirror = new HotelSpaceMirror();
  mirror.applySnapshot(snapshot(12, 1, [avatar(-701, "Duda", 1, 4), avatar(-702, "Rafa", 2, 6), avatar(9, "ana", 7, 4)]), clock.now());
  mirror.registerActor({ ref: "duda", id: -701, run: 7, name: "Duda" }, "12", clock.now());
  mirror.registerActor({ ref: "rafa", id: -702, run: 7, name: "Rafa" }, "12", clock.now());
  const sent: SidecarMsg[] = [];
  const blocked: BlockedReason[][] = [];
  let cid = 0;
  const exec = new BodyExecutor({
    run: 7, clock, rng: () => 0.5, mirror, lease: () => 3, nextCid: () => ++cid,
    send: (m) => (sent.push(m), true),
    hooks: { blocked: (_a, reasons) => blocked.push(reasons), arrived: () => undefined, pairAborted: () => undefined, pairOutcome: () => undefined },
  });
  const cmds = () => sent.flatMap((m) => (m.t === "actor_cmd" ? [m.cmd] : []));
  return { exec, sent, cmds, blocked };
}

describe("BodyExecutor: the act command", () => {
  it("[ACT-1] encodes an act as actor_cmd{k:act} with the run lease, a cid and the avatar ids, and the frame parses under the generated type", () => {
    const { exec, sent } = setup();
    exec.send([{ agentId: "duda", cmd: "act", actId: "a17", verb: "slap", with: "h:9", intensity: 0.6, origin: "director" }]);
    expect(sent).toEqual([{ t: "actor_cmd", cid: 1, run: 7, lease: 3, actor: -701, cmd: { k: "act", act_id: "a17", verb: "slap", with: 9, intensity: 0.6, origin: "director" } }]);
    expect(checkFrame("sidecar_to_hotel", sent[0])).toEqual({ ok: true, errors: [] });
  });

  it("[ACT-4] leaves out what was not given, and carries authored_skip and the insult text when it was", () => {
    const { exec, cmds } = setup();
    exec.send([{ agentId: "duda", cmd: "act", actId: "a1", verb: "glare", with: "rafa" }]);
    exec.send([{ agentId: "rafa", cmd: "act", actId: "a2", verb: "insult", with: "duda", text: "voce de novo", origin: "scenario", authoredSkip: true }]);
    expect(cmds()).toEqual([
      { k: "act", act_id: "a1", verb: "glare", with: -702 },
      { k: "act", act_id: "a2", verb: "insult", with: -701, text: "voce de novo", origin: "scenario", authored_skip: true },
    ]);
  });

  it("[ACT-8] sends a solo verb without a target and drops one that has a target before the socket", () => {
    const { exec, cmds } = setup();
    exec.send([{ agentId: "duda", cmd: "act", actId: "a1", verb: "cry" }]);
    exec.send([{ agentId: "rafa", cmd: "act", actId: "a2", verb: "faint", with: "duda" }]);
    expect(cmds()).toEqual([{ k: "act", act_id: "a1", verb: "cry" }]);
  });

  it("[ACT-7] drops a targeted verb with no target, or with a person the mirror does not know", () => {
    const { exec, cmds } = setup();
    exec.send([{ agentId: "duda", cmd: "act", actId: "a1", verb: "shove" }]);
    exec.send([{ agentId: "duda", cmd: "act", actId: "a2", verb: "shove", with: "ghost" }]);
    expect(cmds()).toEqual([]);
  });

  it("[ACT-9] drops an act on the actor itself", () => {
    const { exec, cmds } = setup();
    exec.send([{ agentId: "duda", cmd: "act", actId: "a1", verb: "glare", with: "duda" }]);
    expect(cmds()).toEqual([]);
  });

  it("[ACT-4] drops an act whose id or intensity the hotel would refuse", () => {
    const { exec, cmds } = setup();
    exec.send([{ agentId: "duda", cmd: "act", actId: "bad id", verb: "glare", with: "rafa" }]);
    exec.send([{ agentId: "duda", cmd: "act", actId: "a2", verb: "glare", with: "rafa", intensity: 1.5 }]);
    expect(cmds()).toEqual([]);
  });

  it("[ACT-3] counts against the actor's body budget of 4 per 5 s, and reports the refusal as a slow_down on the act", () => {
    const { exec, cmds, blocked } = setup();
    for (let i = 0; i < 5; i++) exec.send([{ agentId: "duda", cmd: "act", actId: `a${i}`, verb: "cry" }]);
    expect(cmds()).toHaveLength(4);
    expect(blocked.at(-1)).toEqual([{ code: "slow_down", part: "act" }]);
  });
});
