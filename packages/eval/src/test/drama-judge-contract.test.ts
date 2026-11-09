import { describe, it, expect } from "vitest";
import {
  DRAMA_RUBRIC,
  actMarksFromEvents,
  buildDramaJudgePrompt,
  buildDramaJudgeSystem,
  renderRubricPrompt,
  type ContactSheetResult,
  type DramaAxis,
  type DramaEvent,
} from "../drama/index.js";
import { contractEvents } from "./drama-contract-kit.js";

const spec = (id: DramaAxis) => DRAMA_RUBRIC.find((a) => a.id === id)!;
const anchors = (id: DramaAxis): string => Object.values(spec(id).anchors).join("\n");

describe("rubric aligned to the act contract (section 12, judge bullets)", () => {
  it("lists every outcome that puts nothing on anyone in reaction_integrity's not-applicable rule", () => {
    const rule = spec("reaction_integrity").notApplicableWhen;
    for (const outcome of ["declined", "timeout", "dodged", "blocked", "aborted"]) expect(rule).toContain(outcome);
  });

  it("anchors the legibility window and the reaction deadlines on act_beat, not act_started", () => {
    expect(anchors("action_legibility")).toContain("act_beat");
    expect(anchors("action_legibility")).not.toContain("act_started");
    expect(spec("action_legibility").notApplicableWhen).toContain("act_beat");
    expect(spec("reaction_integrity").anchors[1]).toContain("within 1.5 s of its act_beat");
    expect(spec("reaction_integrity").anchors[3]).toContain("3 s after the act_beat");
    expect(spec("reaction_integrity").anchors[5]).toContain("within 1.5 s of act_beat");
  });

  it("owes a reaction only to what act_beat.owed lists: a human target owes none", () => {
    expect(spec("reaction_integrity").anchors[1]).toContain("a human target owes none");
    expect(spec("reaction_integrity").anchors[3]).toContain("act_beat.owed");
    expect(spec("reaction_integrity").anchors[5]).toContain("act_beat.owed");
  });

  it("keeps a dead actor silent only until its actor_revive", () => {
    expect(spec("reaction_integrity").anchors[1]).toContain("before its actor_revive");
    expect(spec("reaction_integrity").anchors[5]).toContain("until its actor_revive");
  });

  it.each([
    ["escalation_arc", 1, "start less than 20 s apart in the same scene"],
    ["escalation_arc", 5, "in the same scene start at least 20 s apart"],
    ["restraint", 1, "in the same scene start less than 20 s apart"],
    ["restraint", 3, "in each scene are at least 20 s apart"],
    ["restraint", 5, "in each scene are at least 20 s apart"],
  ] as const)("reads the 20 s spacing in %s anchor %i per scene", (id, level, phrase) => {
    expect(spec(id).anchors[level]).toContain(phrase);
  });

  it("reads the ladder per target in this scene, and exempts an act marked authored_skip", () => {
    expect(spec("escalation_arc").anchors[1]).toContain("against that target in this scene");
    expect(spec("escalation_arc").anchors[1]).toContain("authored_skip");
  });

  it("renders the changed anchors into the prompt verbatim", () => {
    const text = renderRubricPrompt();
    expect(text).toContain(spec("reaction_integrity").notApplicableWhen);
    expect(text).toContain(spec("action_legibility").anchors[5]);
  });
});

describe("judge prompt on the act contract's frames", () => {
  const sheets: ContactSheetResult = {
    sheets: [],
    frames: [],
    durationS: 200,
    video: { width: 160, height: 120 },
    tile: { width: 160, height: 120 },
  };
  const timeline = (events: DramaEvent[]): string[] => {
    const { user } = buildDramaJudgePrompt({ clipId: "c", contactSheets: sheets, events, transcript: "" });
    return user
      .slice(user.indexOf("Timeline"))
      .split("\n")
      .filter((l) => l.startsWith("["))
      .map((l) => l.replace(/^\[[\d.]+s\] /, ""));
  };

  it("shows the act's scene, the beat with who saw it and who owes, and the chip answer", () => {
    const lines = timeline(contractEvents("contract-slap-human-take").filter((e) => e.atMs >= 40_000 && e.atMs <= 50_000));
    expect(lines).toEqual([
      "act_started a17 slap rung 4 person-1 -> h:9 intensity 0.60 scene 7.2",
      "consent_chip shown a17 person-1 wants slap",
      "consent_chip answered a17 person-1 -> h:9: take",
      "act_beat a17 contact witnesses person-3, person-2, h:11 owed person-2 (witness), person-3 (witness)",
      "act_reaction a17 person-2 (witness): freeze_gasp",
      "act_reaction a17 person-3 (witness): cmd:face",
      "act_done a17 landed (answer take)",
    ]);
  });

  it("shows a blocked act's reason and an abort's reason", () => {
    const lines = timeline(contractEvents("contract-blocked-aborted").filter((e) => e.kind === "act_done"));
    expect(lines).toEqual(["act_done a18 blocked consent_off", "act_done a19 blocked no_scenario_gate", "act_done a23 aborted paused"]);
  });

  it("shows the down state, the death, the scene cut, the revive and an authored skip", () => {
    expect(timeline(contractEvents("contract-kill-human-down").filter((e) => e.kind === "human_down" || e.kind === "human_up"))).toEqual(["human_down h:9 for 5000 ms", "human_up h:9 (timer)"]);
    const killed = contractEvents("contract-kill-actor-revive");
    expect(timeline(killed.filter((e) => e.kind === "scene_cut" || e.kind === "actor_revive" || e.kind === "actor_death"))).toEqual([
      "actor_death person-2 (kill)",
      "scene_cut scene 7.3 after 7.2",
      "actor_revive person-2 scene 7.3",
    ]);
    expect(timeline(killed.filter((e) => e.kind === "act_started"))).toEqual(["act_started a20 kill rung 6 person-1 -> person-2 intensity 1.00 scene 7.2 authored_skip"]);
  });

  it("tells the judge that act_beat is the contact and a scene_cut starts a new scene", () => {
    const system = buildDramaJudgeSystem();
    expect(system).toContain("act_beat is the moment of contact");
    expect(system).toContain("scene_cut starts a new scene");
  });
});

describe("contact sheet marks anchored on contact", () => {
  const started = (actId: string, atMs: number): DramaEvent => ({ kind: "act_started", atMs, actId, verb: "slap", actor: "duda", with: "rafa", intensity: 0.5 });
  const beat = (actId: string, atMs: number): DramaEvent => ({ kind: "act_beat", atMs, actId, beat: "contact", witnesses: [], owed: [] });

  it("marks a chipped act where it made contact, not where it started", () => {
    expect(actMarksFromEvents([started("a1", 12_000), beat("a1", 16_000)], { clipStartMs: 10_000, durationS: 30 })).toEqual([{ actId: "a1", atS: 6 }]);
  });

  it("marks an act that never made contact where it started", () => {
    expect(actMarksFromEvents([started("a1", 12_000), started("a2", 20_000), beat("a2", 20_300)], { clipStartMs: 10_000, durationS: 30 })).toEqual([
      { actId: "a1", atS: 2 },
      { actId: "a2", atS: 10.3 },
    ]);
  });

  it("keeps an act whose contact is in the clip though it started before it, and drops one whose contact is past the end", () => {
    const marks = actMarksFromEvents([started("early", 8000), beat("early", 11_000), started("late", 12_000), beat("late", 40_000)], { clipStartMs: 10_000, durationS: 5 });
    expect(marks).toEqual([{ actId: "early", atS: 1 }]);
  });

  it("makes no mark for a beat whose act_started is missing", () => {
    expect(actMarksFromEvents([beat("ghost", 12_000)], { clipStartMs: 0 })).toEqual([]);
  });
});
