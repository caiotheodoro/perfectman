/**
 * The authored script played by the production path (errata P4-01, SCN-3, SCN-4, SCN-6, SCENE-5): a `BeatPlayer` on the run clock hands each act
 * beat to the real `DramaDirector` as `origin:"scenario"` and each cut to `advanceScene`. Every gate still applies; a beat a gate vetoes is
 * logged and dropped, never retried into a violation.
 */
import { describe, expect, it } from "vitest";
import { resolveRunDrama } from "../authoring/scenario-drama.js";
import type { ScenarioDrama } from "../authoring/scenario-drama.js";
import type { ScenarioBeat } from "../authoring/scenario-beats.js";
import { BeatPlayer } from "../director/drama/beat-player.js";
import type { BeatReport } from "../director/drama/beat-player.js";
import { buildReplayPlan } from "../run/replay-plan.js";
import { actFrames } from "../testing/fake-drama.js";
import { A, B, C, WIDE_BLOCK, makeRig } from "../testing/drama-rig.js";
import type { Rig } from "../testing/drama-rig.js";

const kill = (id: string, at_s: number, actor = "person-1", victim = "person-2"): ScenarioBeat => ({ id, at_ms: at_s * 1000, kind: "act", actor, verb: "kill", with: victim, authored_skip: true });
const cut = (id: string, at_s: number): ScenarioBeat => ({ id, at_ms: at_s * 1000, kind: "cut", reason: "fim da festa" });

type Setup = { rig: Rig; player: BeatPlayer; reports: BeatReport[] };

function setup(beats: readonly ScenarioBeat[], o: { block?: ScenarioDrama | undefined; session?: null; played?: string[]; startedAt?: number } = {}): Setup {
  const block = "block" in o ? o.block : WIDE_BLOCK;
  const rig = makeRig({ ...(block ? { block } : {}), ...(o.session === null ? { session: null } : {}) });
  const reports: BeatReport[] = [];
  const player = new BeatPlayer({
    clock: rig.clock,
    port: () => rig.dir,
    beats,
    drama: resolveRunDrama(block ? { drama: block } : {}),
    wireOf: (ref) => rig.world.idOf(ref),
    ...(o.played ? { played: o.played } : {}),
    ...(o.startedAt !== undefined ? { startedAt: o.startedAt } : {}),
    onReport: (r) => void reports.push(r),
  });
  return { rig, player, reports };
}

const outcomes = (reports: readonly BeatReport[]): string[] => reports.map((r) => `${r.beat.id}:${r.outcome}:${r.why}`);

describe("BeatPlayer: an authored act", () => {
  it("[SCN-4] plays a kill at its second as a scenario act with the authored skip, through the director's own gates", async () => {
    const { rig, player, reports } = setup([kill("b1", 90)]);
    player.start();
    await rig.clock.advance(89_900);
    expect(rig.link.acts).toHaveLength(0);
    await rig.clock.advance(200);
    expect(rig.link.acts).toHaveLength(1);
    expect(rig.link.acts[0]).toMatchObject({ actor: A, cmd: { verb: "kill", with: B, origin: "scenario", authored_skip: true } });
    expect(outcomes(reports)).toEqual(["b1:played:approve"]);
    expect(rig.dir.snapshot().kills).toBe(1);
  });

  it("[SCN-3] a kill is asked only for a victim the block lets die, and never in free play", async () => {
    const strangers = setup([kill("b1", 5, "person-1", "person-3")]);
    strangers.player.start();
    await strangers.rig.clock.advance(6000);
    expect(strangers.rig.link.acts).toHaveLength(0);
    expect(outcomes(strangers.reports)).toEqual(["b1:dropped:may_die"]);

    const free = setup([kill("b1", 5)], { block: undefined });
    free.player.start();
    await free.rig.clock.advance(6000);
    expect(free.rig.link.acts).toHaveLength(0);
    expect(outcomes(free.reports)).toEqual(["b1:dropped:free_play"]);
  });

  it("[LAD-4] never kills twice in one scene, and kills again once the scene was cut", async () => {
    const { rig, player, reports } = setup([kill("b1", 25), kill("b2", 50), cut("b3", 60), kill("b4", 110, "person-3")]);
    player.start();
    await rig.clock.advance(55_000);
    expect(rig.link.acts).toHaveLength(1);
    expect(outcomes(reports)).toEqual(["b1:played:approve", "b2:dropped:kill_budget"]);
    await rig.clock.advance(6_000);
    expect(rig.link.advances).toHaveLength(1);
    rig.cut({ scene: "7.2", prev: "7.1" });
    await rig.clock.advance(60_000);
    expect(rig.link.acts.map((a) => `${a.actor}:${a.cmd.verb}`)).toEqual([`${A}:kill`, `${C}:kill`]);
  });

  it("[GATE-7] a beat the gates veto is logged and dropped: no retry later, when the same ask would pass", async () => {
    const { rig, player, reports } = setup([kill("b1", 30)]);
    rig.world.put(B, { tile: [15, 15] });
    player.start();
    await rig.clock.advance(31_000);
    expect(outcomes(reports)).toEqual(["b1:dropped:veto:too_far"]);
    rig.world.put(B, { tile: [6, 5] });
    await rig.clock.advance(120_000);
    expect(rig.link.acts).toHaveLength(0);
    expect(reports).toHaveLength(1);
  });

  it("[GATE-5] an authored skip with no block to honour it is vetoed, not sent", async () => {
    const { rig, player, reports } = setup([{ id: "b1", at_ms: 5000, kind: "act", actor: "person-1", verb: "slap", with: "person-2", authored_skip: true }], { block: undefined });
    player.start();
    await rig.clock.advance(6000);
    expect(rig.link.acts).toHaveLength(0);
    expect(outcomes(reports)).toEqual(["b1:dropped:veto:no_scenario_gate"]);
  });

  it("[ACT-12] waits a little for a busy actor and then plays once; an actor still busy after the window loses the beat", async () => {
    const open = () => actFrames({ actId: "x1", verb: "glare", actor: A, with: B, scene: "7.1", outcome: "landed" });
    const soon = setup([kill("b1", 30)]);
    soon.rig.hotel([open()[0]!]);
    soon.player.start();
    await soon.rig.clock.advance(31_000);
    expect(soon.rig.link.acts).toHaveLength(0);
    soon.rig.hotel(open().slice(1));
    await soon.rig.clock.advance(2_000);
    expect(soon.rig.link.acts).toHaveLength(1);
    expect(outcomes(soon.reports)).toEqual(["b1:played:approve"]);

    const never = setup([kill("b1", 30)]);
    never.rig.hotel([open()[0]!]);
    never.player.start();
    await never.rig.clock.advance(120_000);
    expect(never.rig.link.acts).toHaveLength(0);
    expect(outcomes(never.reports)).toEqual(["b1:dropped:actor_busy"]);
  });

  it("does nothing when drama is not negotiated: a dialect 1 link, no session, an unplaced actor", async () => {
    const dialect1 = setup([kill("b1", 5), cut("b2", 30)]);
    dialect1.rig.link.dialect = 1;
    dialect1.player.start();
    await dialect1.rig.clock.advance(60_000);
    expect(dialect1.rig.link.acts).toHaveLength(0);
    expect(dialect1.rig.link.advances).toHaveLength(0);
    expect(outcomes(dialect1.reports)).toEqual(["b1:dropped:inert", "b2:dropped:inert"]);

    const noSession = setup([kill("b1", 5)], { session: null });
    noSession.player.start();
    await noSession.rig.clock.advance(60_000);
    expect(noSession.rig.link.acts).toHaveLength(0);

    const nobody = setup([kill("b1", 5, "person-9")]);
    nobody.player.start();
    await nobody.rig.clock.advance(6_000);
    expect(outcomes(nobody.reports)).toEqual(["b1:dropped:not_placed"]);
  });
});

describe("BeatPlayer: an authored cut", () => {
  it("[SCENE-5] a cut before the scene is 20 s old waits for it and is sent once, with the author's reason", async () => {
    const { rig, player, reports } = setup([cut("b1", 5)]);
    player.start();
    await rig.clock.advance(19_000);
    expect(rig.link.advances).toHaveLength(0);
    await rig.clock.advance(1_500);
    expect(rig.link.advances).toEqual([{ run: 7, reason: "fim da festa" }]);
    rig.cut({ scene: "7.2", prev: "7.1" });
    await rig.clock.advance(60_000);
    expect(rig.link.advances).toHaveLength(1);
    expect(outcomes(reports)).toEqual(["b1:played:sent"]);
  });

  it("[SCENE-4] a cut the hotel dropped without a scene_cut is asked again after the pending window, and not forever", async () => {
    const { rig, player } = setup([cut("b1", 30)]);
    player.start();
    await rig.clock.advance(31_000);
    expect(rig.link.advances).toHaveLength(1);
    await rig.clock.advance(30_000);
    expect(rig.link.advances.length).toBeGreaterThan(1);
    await rig.clock.advance(600_000);
    expect(rig.link.advances.length).toBeLessThanOrEqual(6);
  });
});

describe("BeatPlayer: once per beat", () => {
  it("never plays a beat id twice: a player rebuilt with the played ids, or started after the beat's time, sends nothing", async () => {
    const first = setup([kill("b1", 30), cut("b2", 60)]);
    first.player.start();
    await first.rig.clock.advance(31_000);
    expect(first.player.playedIds()).toEqual(["b1"]);

    // A resume: a new director (NEG-9) and a new player over the same body, told what was played.
    const resumed = setup([kill("b1", 30), cut("b2", 60)], { played: first.player.playedIds(), startedAt: first.rig.clock.now() - 31_000 });
    resumed.player.start();
    await resumed.rig.clock.advance(1_000);
    expect(resumed.rig.link.acts).toHaveLength(0);

    // A resume that lost the list: the beat's time is past, so it is not played late.
    const late = setup([kill("b1", 30)]);
    await late.rig.clock.advance(40_000);
    late.player.start();
    await late.rig.clock.advance(1_000);
    expect(late.rig.link.acts).toHaveLength(0);
    expect(outcomes(late.reports)).toEqual(["b1:dropped:past"]);
  });

  it("stop() cancels what has not come yet", async () => {
    const { rig, player } = setup([kill("b1", 30)]);
    player.start();
    player.stop();
    await rig.clock.advance(60_000);
    expect(rig.link.acts).toHaveLength(0);
    expect(rig.clock.pending()).toBe(0);
  });
});

describe("REPLAY-1 for the beats", () => {
  it("what a played script leaves in the run's frame log is dropped by the replay plan, so a replay never re-sends a beat", async () => {
    const { rig, player } = setup([kill("b1", 30), cut("b2", 60)]);
    player.start();
    await rig.clock.advance(61_000);
    expect(rig.recorded.map((r) => r.kind)).toEqual(["actor_cmd", "scene_advance"]);
    const chat = { atMs: 500, dir: "out", room: "12", kind: "actor_cmd", data: { actor: "person-2", cmd: { k: "chat", mode: "say", text: "oi" } } };
    const frames = [chat, ...rig.recorded.map((r, i) => ({ atMs: 1000 + i * 1000, ...r }))] as never;
    const manifest = { run: 7, scenarioVersion: 1, startedAt: 500, home: 12, actors: { "person-1": A, "person-2": B } } as never;
    const plan = buildReplayPlan({ manifest, frames, track: [{ t: 0, k: "start", run: 7, room: 12, lang: "en" }] as never, events: [] }, { cinematic: true });
    expect(plan.steps.filter((s) => s.k === "cmd" && s.cmd.k === "act")).toEqual([]);
    expect(plan.warnings).toContain("2 recorded act and scene_advance commands were not replayed");
  });
});
