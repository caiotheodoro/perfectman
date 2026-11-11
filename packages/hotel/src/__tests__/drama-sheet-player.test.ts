/**
 * The beat sheet on the run clock (Contract A, "Runtime"): acts and cuts through the director as scenario acts, blocking/props/faces/camera/pause through the run's
 * hooks, the climax forced by 4:00, a beat that missed its body released once, 40 s late. The director is the real one (`makeRig`); the stage is a recorder.
 */
import { describe, expect, it } from "vitest";
import { mockBeatSheet } from "@perfectman/shared";
import type { BeatSheet, SheetBeat } from "@perfectman/shared";
import { resolveRunDrama } from "../authoring/scenario-drama.js";
import { SheetPlayer, FORCE_UNTIL_MS, LATE_RELEASE_MS } from "../director/drama/sheet-player.js";
import type { SheetReport, SheetStageHooks } from "../director/drama/sheet-player.js";
import { A, WIDE_BLOCK, makeRig } from "../testing/drama-rig.js";

const NAMES = [{ id: "person-1", name: "Heloísa" }, { id: "person-2", name: "Otávio" }, { id: "person-3", name: "Renato" }];
const sheetOf = (o: Parameters<typeof mockBeatSheet>[0]["climax"] = "slap", climaxAtMs = 170_000): BeatSheet => mockBeatSheet({ cast: NAMES, language: "pt-BR", climax: o, climaxAtMs });

type Stage = SheetStageHooks & { log: string[]; blockOk: boolean };
function stage(): Stage {
  const s: Stage = {
    log: [],
    blockOk: true,
    block(b) {
      s.log.push(`block:${b.id}`);
      return s.blockOk;
    },
    prop(b) {
      s.log.push(`prop:${b.id}`);
      return true;
    },
    expression(actor, face) {
      s.log.push(`face:${actor}:${face}`);
      return true;
    },
    camera(_i, b) {
      s.log.push(`camera:${b.id}`);
    },
    pause(ms, b) {
      s.log.push(`pause:${b.id}:${ms}`);
    },
  };
  return s;
}

/** The hotel's half: every act the director sent starts and lands a moment later, as a recorded run's frames say. */
function autoHotel(rig: ReturnType<typeof makeRig>): void {
  const seen = new Set<string>();
  const tick = (): void => {
    for (const a of rig.link.acts) {
      if (seen.has(a.cmd.act_id)) continue;
      seen.add(a.cmd.act_id);
      rig.act({ actId: a.cmd.act_id, verb: a.cmd.verb, actor: a.actor, ...(a.cmd.with !== undefined && a.cmd.with !== null ? { with: a.cmd.with } : {}), origin: (a.cmd.origin ?? "director") as "scenario", outcome: "landed", at: rig.clock.now(), witnesses: [] });
    }
    rig.clock.setTimer(tick, 200);
  };
  rig.clock.setTimer(tick, 200);
}

function setup(sheet: BeatSheet, o: { block?: typeof WIDE_BLOCK | undefined } = {}) {
  const block = "block" in o ? o.block : WIDE_BLOCK;
  const rig = makeRig({ ...(block ? { block } : {}) });
  autoHotel(rig);
  const st = stage();
  const reports: SheetReport[] = [];
  const walks: Array<[string, string]> = [];
  const player = new SheetPlayer({
    clock: rig.clock,
    port: () => rig.dir,
    sheet,
    stage: st,
    drama: resolveRunDrama(block ? { drama: block } : {}),
    wireOf: (ref) => rig.world.idOf(ref),
    walkCloser: (a, t) => (walks.push([a, t]), true),
    onReport: (r) => void reports.push(r),
  });
  return { rig, player, st, reports, walks };
}

const actsOf = (rig: ReturnType<typeof makeRig>): string[] => rig.link.acts.map((a) => `${a.cmd.verb}:${a.cmd.origin}`);
const only = (beats: SheetBeat[], keep: (b: SheetBeat) => boolean): SheetBeat[] => beats.filter(keep);

describe("SheetPlayer: the sheet on the clock", () => {
  it("plays every beat at its second: blocking, props, faces, camera and pause through the hooks, acts through the director as scenario acts", async () => {
    const sheet = sheetOf("slap");
    const { rig, player, st, reports } = setup(sheet);
    player.start();
    await rig.clock.advance(sheet.arc.aftermath_until_ms + 5_000);
    expect(st.log.filter((l) => l.startsWith("block:")).length).toBe(sheet.beats.filter((b) => b.kind === "block").length);
    expect(st.log.some((l) => l.startsWith("camera:"))).toBe(true);
    expect(st.log.some((l) => l.startsWith("pause:") && l.endsWith(":4000"))).toBe(true);
    // faces come back to neutral after their time
    expect(st.log.filter((l) => l === "face:person-1:angry")).toHaveLength(1);
    expect(st.log.filter((l) => l === "face:person-1:neutral")).toHaveLength(1);
    expect(actsOf(rig)).toEqual(["glare:scenario", "insult:scenario", "shove:scenario", "slap:scenario", "freeze_gasp:scenario"]);
    const climax = player.summary().climax;
    expect(climax).toMatchObject({ outcome: "played", planned_ms: 170_000 });
    expect(climax.at_ms).toBeGreaterThanOrEqual(170_000);
    expect(climax.at_ms!).toBeLessThan(171_500);
    expect(reports.every((r) => r.outcome === "played")).toBe(true);
  });

  it("does nothing before its second and nothing after stop", async () => {
    const sheet = sheetOf();
    const { rig, player, st } = setup(sheet);
    player.start();
    await rig.clock.advance(2_000);
    expect(st.log).toEqual([]);
    await rig.clock.advance(2_000);
    expect(st.log).toEqual(["camera:m3"]);
    player.stop();
    await rig.clock.advance(300_000);
    expect(st.log).toEqual(["camera:m3"]);
    expect(rig.link.acts).toHaveLength(0);
  });

  it("[hard] the climax is forced: the rungs the improvised arc skipped are jumped with the authored skip, once, through the director's own gate", async () => {
    const sheet = sheetOf("slap");
    // No glare, insult or shove in the sheet: the improvised arc "never climbed". The slap alone is rung 4 from nothing.
    const bare: BeatSheet = { ...sheet, beats: only(sheet.beats, (b) => !(b.kind === "act" && ["glare", "insult", "shove"].includes(b.verb))) };
    const { rig, player, reports } = setup(bare);
    player.start();
    await rig.clock.advance(171_000);
    expect(rig.link.acts.map((a) => ({ verb: a.cmd.verb, origin: a.cmd.origin, skip: a.cmd.authored_skip }))).toEqual([{ verb: "slap", origin: "scenario", skip: true }]);
    expect(reports.find((r) => r.beat.kind === "act" && r.beat.climax)).toMatchObject({ outcome: "played" });
  });

  it("a beat that is not the climax gets no such help: its rung veto stands and it is dropped", async () => {
    const sheet = sheetOf("slap");
    const noRungs: BeatSheet = { ...sheet, beats: only(sheet.beats, (b) => !(b.kind === "act" && ["glare", "insult"].includes(b.verb))) };
    const { rig, player, reports } = setup(noRungs);
    player.start();
    await rig.clock.advance(sheet.arc.climax_at_ms + 1_000);
    const shove = reports.find((r) => r.beat.kind === "act" && r.beat.verb === "shove");
    expect(shove).toMatchObject({ outcome: "dropped", why: "veto:ladder" });
    expect(actsOf(rig)).toEqual(["slap:scenario"]);
  });

  it("[hard] the climax waits out the 20 s between physical beats and still comes by 4:00", async () => {
    const sheet = sheetOf("slap", 200_000);
    // The shove came 5 s before the slap, which a sheet would never say but an improvised blow may: the slap is vetoed (GATE-9) and asked again each second.
    const crowded: BeatSheet = { ...sheet, beats: sheet.beats.map((b) => (b.kind === "act" && b.verb === "shove" ? { ...b, at_ms: 195_000 } : b)) };
    const { rig, player, reports } = setup(crowded);
    player.start();
    await rig.clock.advance(214_000);
    expect(actsOf(rig).filter((a) => a.startsWith("slap"))).toHaveLength(0);
    await rig.clock.advance(8_000);
    expect(actsOf(rig).filter((a) => a.startsWith("slap"))).toEqual(["slap:scenario"]);
    expect(player.summary().climax.at_ms!).toBeLessThanOrEqual(FORCE_UNTIL_MS);
    expect(player.summary().climax.at_ms!).toBeGreaterThanOrEqual(215_000);
    expect(reports.some((r) => r.beat.kind === "act" && r.beat.climax && r.outcome === "played")).toBe(true);
  });

  it("[hard] a pair that is apart is walked together for as long as the deadline, not only 30 s", async () => {
    const sheet = sheetOf("slap", 200_000);
    const { rig, player, walks } = setup(sheet);
    rig.world.put(-702, { tile: [15, 15] });
    player.start();
    await rig.clock.advance(200_000 + 40_000);
    expect(walks.length).toBeGreaterThan(3);
    expect(player.summary().climax.outcome).toBe("pending");
    rig.world.put(-702, { tile: [6, 5] });
    await rig.clock.advance(3_000);
    expect(player.summary().climax.outcome).toBe("played");
  });

  it("the scene's own refusals are final even for the climax: a victim who may not die is not killed", async () => {
    const sheet = sheetOf("kill");
    const { rig, player } = setup(sheet, { block: { ...WIDE_BLOCK, may_die: [] } });
    player.start();
    await rig.clock.advance(sheet.arc.climax_at_ms + 60_000);
    expect(actsOf(rig).some((a) => a.startsWith("kill"))).toBe(false);
    expect(player.summary().climax).toMatchObject({ outcome: "dropped", why: "may_die" });
  });

  it("a kill takes the authored skip from the sheet and the scene cut after it is sent", async () => {
    const sheet = sheetOf("kill");
    const { rig, player } = setup(sheet);
    player.start();
    await rig.clock.advance(sheet.arc.aftermath_until_ms);
    expect(rig.link.acts.find((a) => a.cmd.verb === "kill")).toMatchObject({ cmd: { origin: "scenario", authored_skip: true } });
    // the fake hotel never answers with a scene_cut, so the player asks again (BeatPlayer's own rule); what matters is that the cut was asked for
    expect(rig.link.advances.length).toBeGreaterThanOrEqual(1);
  });
});

describe("SheetPlayer: a missed beat is released once, 40 s late", () => {
  it("a block with nowhere to go yet is tried again after 40 s, and only once", async () => {
    const sheet = sheetOf();
    const { rig, player, st, reports } = setup(sheet);
    st.blockOk = false;
    player.start();
    await rig.clock.advance(7_000);
    expect(st.log.filter((l) => l === "block:m4")).toHaveLength(1);
    st.blockOk = true;
    await rig.clock.advance(LATE_RELEASE_MS);
    expect(st.log.filter((l) => l === "block:m4")).toHaveLength(2);
    expect(reports.find((r) => r.beat.id === "m4")).toMatchObject({ outcome: "played", late: true, why: "late" });
    await rig.clock.advance(200_000);
    expect(st.log.filter((l) => l === "block:m4")).toHaveLength(2);
  });

  it("a block that never works is dropped after its one late try", async () => {
    const sheet = sheetOf();
    const { rig, player, st, reports } = setup(sheet);
    st.blockOk = false;
    player.start();
    await rig.clock.advance(60_000);
    expect(reports.find((r) => r.beat.id === "m4")).toMatchObject({ outcome: "dropped", why: "unplayable" });
    expect(player.summary().dropped["unplayable"]).toBeGreaterThanOrEqual(1);
  });

  it("an act whose actor was not placed yet is released late; a gate's veto is not", async () => {
    const sheet = sheetOf();
    const { rig, player, reports } = setup(sheet);
    rig.world.remove(A);
    player.start();
    await rig.clock.advance(sheet.beats.find((b) => b.kind === "act" && b.verb === "glare")!.at_ms + 1_000);
    expect(reports.find((r) => r.beat.kind === "act" && r.beat.verb === "glare")).toBeUndefined();
    rig.world.put(A, { ref: "person-1", tile: [5, 5] });
    await rig.clock.advance(LATE_RELEASE_MS + 1_000);
    expect(rig.link.acts.some((a) => a.cmd.verb === "glare")).toBe(true);
    expect(reports.find((r) => r.beat.kind === "act" && r.beat.verb === "glare")).toMatchObject({ outcome: "played", late: true });
  });

  it("a beat whose time passed more than a second before the player started is dropped as past, never played late", async () => {
    const sheet = sheetOf();
    const { rig, player, reports } = setup(sheet);
    await rig.clock.advance(1);
    const late = new SheetPlayer({ clock: rig.clock, port: () => rig.dir, sheet, stage: stage(), drama: resolveRunDrama({ drama: WIDE_BLOCK }), wireOf: (r) => rig.world.idOf(r), startedAt: rig.clock.now() - 60_000, onReport: (r) => void reports.push(r) });
    late.start();
    expect(reports.some((r) => r.why === "past" && r.beat.id === "m1")).toBe(true);
    void player;
  });
});
