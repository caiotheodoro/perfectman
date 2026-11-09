/**
 * The probe gaps PI-a found by corrupting the hotel's real lifecycles (docs/drama/errata.md PI-13), closed here: a target's reaction
 * that is dropped is not excused by a death some other act caused, a kill's victim must die on screen, a second `act_done` for one
 * act is flagged, and a human who never stands up is flagged whatever else the frames say. Every gap has a mutation that is
 * applied by a fixed rule (no randomness) to a hotel lifecycle and must be caught by the probe that closes it; the clean
 * lifecycles must still pass every probe (`drama-hotel-lifecycles.test.ts`), so none of this is a false alarm.
 */
import { describe, expect, it } from "vitest";
import { innerOf, lifecycleLines, mapFrames, probesOf, without } from "./drama-hotel-kit.js";
import type { Line } from "./drama-hotel-kit.js";

const failures = (lines: readonly Line[], runMs?: number): Record<string, string[]> =>
  Object.fromEntries([...probesOf(lines, runMs)].filter(([, r]) => !r.passed).map(([name, r]) => [name, r.codes]));

const isT = (t: string) => (f: Record<string, unknown>) => f["t"] === t;
const shifted = (f: Record<string, unknown>, by: number): Record<string, unknown> => (typeof f["at"] === "number" ? { ...f, at: f["at"] + by } : f);
const sortByTime = (lines: Line[]): Line[] => [...lines].sort((a, b) => Number(a["ts_ms"]) - Number(b["ts_ms"]));

/** One line of the hotel's frames, stamped with the frame's own `at`. */
const line = (frame: Record<string, unknown>): Line => ({ conn: 4, dir: "out", frame: { seq: 500, run: 7, ...frame }, run: 7, ts_ms: Number(frame["at"]) });

/** A slap by -701 on -702 with -703 watching: contact at 1 000 500, the target owes a reaction in 1500 ms, the witness in 3000. */
function slapOnActor(over: { reactions?: boolean } = {}): Line[] {
  const base = { run: 7, room: 12, act_id: "n1" };
  return [
    line({ t: "act_started", ...base, verb: "slap", actor: -701, with: -702, intensity: 0.5, impact: "M", origin: "scenario", scene: "7.1", rung: 4, skipped_rungs: ["glare", "insult", "shove"], authored_skip: true, chip: false, contact_in_ms: 300, at: 1_000_000 }),
    line({ t: "act_beat", ...base, beat: "contact", at: 1_000_500, witnesses: [-703], owed: [{ who: -702, role: "target", due_at: 1_002_000 }, { who: -703, role: "witness", due_at: 1_003_500 }] }),
    ...(over.reactions === false ? [] : [
      line({ t: "act_reaction", ...base, who: -702, role: "target", reaction: "head_snap", source: "table", at: 1_000_700 }),
      line({ t: "act_reaction", ...base, who: -703, role: "witness", reaction: "freeze_gasp", source: "table", at: 1_001_300 }),
    ]),
    line({ t: "act_done", ...base, verb: "slap", actor: -701, with: -702, outcome: "landed", owed_missed: [], downgraded: [], at: 1_003_600 }),
  ];
}

/** The opening a lifecycle carries (run start, the three spawns), so refs resolve. */
const opening = lifecycleLines("kill-actor-revive").filter((l) => ["run_start", "actor_spawned"].includes(String(innerOf(l)["t"])));

describe("[REA-1] a target's dropped reaction is never excused by a death some other act caused", () => {
  it("a slap whose target reacts passes, and one whose target never reacts fails with D1", () => {
    expect(failures([...opening, ...slapOnActor()])).toEqual({});
    expect(failures([...opening, ...slapOnActor({ reactions: false })])).toMatchObject({ "reaction-latency-p90-target": ["D1"] });
  });

  it("a target that died inside its window of an unrelated kill does not excuse the slap's missing reaction", () => {
    const unrelated = line({ t: "actor_death", run: 7, room: 12, actor: -702, cause: "kill", act_id: "other", killer: -703, scene: "7.1", at: 1_001_000 });
    const lines = sortByTime([...opening, ...slapOnActor({ reactions: false }), unrelated]);
    expect(failures(lines)).toMatchObject({ "reaction-latency-p90-target": ["D1"] });
  });

  it("a target that this very act killed is excused, and a kill whose victim neither dies nor reacts is not", () => {
    const kill = lifecycleLines("kill-actor-revive");
    const noReaction = without(kill, (f) => f["t"] === "act_reaction" && f["who"] === -702);
    expect(failures(noReaction)).not.toHaveProperty("reaction-latency-p90-target");
    expect(failures(without(noReaction, isT("actor_death")))).toMatchObject({ "reaction-latency-p90-target": ["D1"] });
  });
});

describe("[DEATH-1] a kill's victim dies on screen", () => {
  const kill = lifecycleLines("kill-actor-revive");

  it("dropping only the victim's `die` reaction fails with D1, though the death frame is there", () => {
    expect(failures(without(kill, (f) => f["t"] === "act_reaction" && f["who"] === -702))).toEqual({ "kill-victim-die-reaction": ["D1"] });
  });

  it("a `die` that comes before contact does not count", () => {
    expect(failures(mapFrames(kill, (f) => f["t"] === "act_reaction" && f["who"] === -702, (f) => shifted(f, -400)))).toEqual({ "kill-victim-die-reaction": ["D1"] });
  });

  it("a kill on a human has no such reaction owed, and a kill that never landed owes none", () => {
    expect(failures(lifecycleLines("down-human-abort"))).toEqual({});
    expect(failures(mapFrames(without(kill, (f) => f["t"] === "act_reaction" && f["who"] === -702), isT("act_done"), (f) => ({ ...f, outcome: "aborted", reason: "scene_cut" })))).not.toHaveProperty("kill-victim-die-reaction");
  });
});

describe("[FRM-1] exactly one act_done per act", () => {
  it.each(["slap-human-take", "slap-human-timeout", "kill-actor-revive", "down-human-abort"] as const)("a second act_done on %s fails single-act-done", (name) => {
    const lines = lifecycleLines(name);
    const done = lines.find((l) => innerOf(l)["t"] === "act_done")!;
    const twice = sortByTime([...lines, { ...done, ts_ms: Number(done["ts_ms"]) + 200, frame: shifted(innerOf(done), 200) }]);
    expect(failures(twice)).toEqual({ "single-act-done": [] });
  });

  it("a second act_done that disagrees about the outcome is still one failure, and an act with none is not judged by this probe", () => {
    const lines = lifecycleLines("slap-human-take");
    const done = lines.find((l) => innerOf(l)["t"] === "act_done")!;
    const other = { ...done, ts_ms: Number(done["ts_ms"]) + 50, frame: { ...shifted(innerOf(done), 50), outcome: "dodged" } };
    expect(probesOf(sortByTime([...lines, other])).get("single-act-done")).toMatchObject({ measured: 1, passed: false });
    expect(probesOf(without(lines, isT("act_done"))).get("single-act-done")).toMatchObject({ measured: 0, passed: true });
  });
});

describe("[DOWN-3] a human who never stands up is flagged", () => {
  const down = lifecycleLines("down-human-abort");
  /** The hotel recorded this run for 12 s (`given.after_ms` of the fixture), so a window due at 5 s that never closed is a human left lying. */
  const RUN_MS = 12_000;

  it("dropping the human_up of a down human fails down-window-exact when the run lasted past the window", () => {
    expect(failures(down, RUN_MS)).toEqual({});
    expect(failures(without(down, isT("human_up")), RUN_MS)).toEqual({ "down-window-exact": [] });
  });

  it("a human_up that comes for another human, or for another act, does not close the window", () => {
    expect(failures(mapFrames(down, isT("human_up"), (f) => ({ ...f, human: 10 })), RUN_MS)).toEqual({ "down-window-exact": [] });
    expect(failures(mapFrames(down, isT("human_up"), (f) => ({ ...f, act_id: "elsewhere" })), RUN_MS)).toEqual({ "down-window-exact": [] });
  });

  it("the stream alone cannot say a window was missed when it ends before the window is due: that is open, not lost", () => {
    const early = down.filter((l) => Number(l["ts_ms"]) < 1_003_000);
    expect(probesOf(early).get("down-window-exact")).toMatchObject({ passed: true });
    expect(probesOf(without(down, isT("human_up"))).get("down-window-exact")).toMatchObject({ passed: true });
  });
});
