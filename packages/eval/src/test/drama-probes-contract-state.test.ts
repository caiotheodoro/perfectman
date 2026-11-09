import { describe, it, expect } from "vitest";
import { DOWN_TOLERANCE_MS, downWindowExact, sceneCutRevive } from "../probes/drama-contract.js";
import { death, humanDown, humanUp, input, revive, sceneCut } from "./drama-probe-fixtures.js";

describe("scene-cut-revive (DEATH-7)", () => {
  it("passes a death, a cut that lists the actor, and its revive after the cut", () => {
    const events = [death("b", 1_000), sceneCut(30_000, "7.3", ["b"]), revive("b", 30_000, { scene: "7.3" })];
    expect(sceneCutRevive(input(events))).toMatchObject({ measured: 0, cuts: 1, revives: 1 });
  });

  it("flags a revive the cut promised and never came, and one that came before its cut", () => {
    expect(sceneCutRevive(input([death("b", 1_000), sceneCut(30_000, "7.3", ["b"])])).offenders).toEqual([{ issue: "revive_missing", actor: "b", scene: "7.3" }]);
    const early = [death("b", 1_000), revive("b", 29_000, { scene: "7.3" }), sceneCut(30_000, "7.3", ["b"])];
    expect(sceneCutRevive(input(early)).offenders.map((o) => o.issue)).toEqual(["revive_missing", "revive_without_cut"]);
  });

  it("flags a revive for a scene that no cut announced, and one for an actor that was never dead", () => {
    expect(sceneCutRevive(input([death("b", 1_000), revive("b", 30_000, { scene: "7.3" })])).offenders.map((o) => o.issue)).toEqual(["revive_without_cut"]);
    const living = [sceneCut(30_000, "7.3", ["c"]), revive("c", 30_000, { scene: "7.3" })];
    expect(sceneCutRevive(input(living)).offenders).toEqual([{ issue: "revive_of_living", actor: "c", scene: "7.3" }]);
  });

  it("flags a body a cut neither revived nor removed, but not a permadeath or one that died too recently to be a body", () => {
    expect(sceneCutRevive(input([death("b", 1_000), sceneCut(30_000, "7.3")])).offenders).toEqual([{ issue: "body_left_standing", actor: "b", scene: "7.3" }]);
    expect(sceneCutRevive(input([death("b", 1_000), sceneCut(30_000, "7.3", [], ["b"])])).measured).toBe(0);
    expect(sceneCutRevive(input([death("b", 28_001), sceneCut(30_000, "7.3")])).measured).toBe(0);
    expect(sceneCutRevive(input([death("b", 28_000), sceneCut(30_000, "7.3")])).measured).toBe(1);
  });

  it("is 0 for a run with no cut and no death, and a cut that revives nobody", () => {
    expect(sceneCutRevive(input([]))).toMatchObject({ measured: 0, cuts: 0, revives: 0 });
    expect(sceneCutRevive(input([sceneCut(30_000, "7.3")])).measured).toBe(0);
  });
});

describe("down-window-exact (DOWN-3)", () => {
  const down = (human = "h:9", at = 1_000, extra = {}) => humanDown(human, at, 5000, extra);

  it("passes a human_up exactly ms after the down, and within the scheduler's tolerance", () => {
    expect(downWindowExact(input([down(), humanUp("h:9", 6_000)]))).toMatchObject({ measured: 0, windows: 1, worstDeviationMs: 0, toleranceMs: DOWN_TOLERANCE_MS });
    expect(downWindowExact(input([down(), humanUp("h:9", 6_000 + DOWN_TOLERANCE_MS)])).measured).toBe(0);
  });

  it("flags a timer stand-up late or early by more than the tolerance, with the actual window", () => {
    expect(downWindowExact(input([down(), humanUp("h:9", 6_101)])).offenders).toEqual([{ human: "h:9", ms: 5000, actualMs: 5_101, issue: "off_window" }]);
    expect(downWindowExact(input([down(), humanUp("h:9", 5_000)])).offenders[0]).toMatchObject({ actualMs: 4_000, issue: "off_window" });
  });

  it("lets a human who left or whose room closed stand up early, never later than the window", () => {
    expect(downWindowExact(input([down(), humanUp("h:9", 2_000, "left")])).measured).toBe(0);
    expect(downWindowExact(input([down(), humanUp("h:9", 3_000, "closed")])).measured).toBe(0);
    expect(downWindowExact(input([down(), humanUp("h:9", 6_200, "left")])).measured).toBe(1);
  });

  it("flags a human never stood up once the run outlasted the window, and leaves one still inside it open", () => {
    expect(downWindowExact(input([down(), death("b", 20_000)])).offenders).toEqual([{ human: "h:9", ms: 5000, issue: "never_up" }]);
    expect(downWindowExact(input([down(), death("b", 3_000)]))).toMatchObject({ measured: 0, openWindows: 1 });
    expect(downWindowExact(input([down()], { durationMs: 30_000 })).measured).toBe(1);
  });

  it("pairs each human's down with that human's own up, in order, by act id when both carry one", () => {
    const events = [down("h:9", 1_000, { actId: "k1" }), down("h:11", 2_000, { actId: "k2" }), humanUp("h:11", 7_000, "timer", { actId: "k2" }), humanUp("h:9", 6_000, "timer", { actId: "k1" })];
    expect(downWindowExact(input(events))).toMatchObject({ measured: 0, windows: 2 });
    const crossed = [down("h:9", 1_000, { actId: "k1" }), humanUp("h:9", 6_000, "timer", { actId: "other" })];
    expect(downWindowExact(input(crossed, { durationMs: 20_000 })).offenders.map((o) => o.issue)).toEqual(["never_up"]);
  });

  it("measures on the hotel's own `at` when both frames carry one", () => {
    const events = [down("h:9", 1_000, { hotelAt: 1_730_000_208_175 }), humanUp("h:9", 9_000, "timer", { hotelAt: 1_730_000_213_175 })];
    expect(downWindowExact(input(events))).toMatchObject({ measured: 0, clock: "hotel_at", worstDeviationMs: 0 });
  });
});
