import { describe, it, expect } from "vitest";
import { HIDDEN_OBJECTIVE_RUBRIC, NARRATIVE_RUBRIC } from "@perfectman/shared";
import { gradeRun, gradeScene, gradeRound, medianGrade, worstGrade, type RunGradeInput, type RunGrade } from "../grade/grade.js";

const axisIds = HIDDEN_OBJECTIVE_RUBRIC.axes.map((a) => a.id);
const all = (score: number): Record<string, number> => Object.fromEntries(axisIds.map((id) => [id, score]));
// The hoc scenes evaluate one forbidden_phrase_absent per agent plus the
// three thesis kinds: seven thesis signals, so one miss is 86%.
const signals = (passed = true) => [
  { kind: "forbidden_phrase_absent", passed },
  { kind: "forbidden_phrase_absent", passed },
  { kind: "forbidden_phrase_absent", passed },
  { kind: "forbidden_phrase_absent", passed },
  { kind: "private_channel_used", passed },
  { kind: "memory_referenced", passed },
  { kind: "chosen_silence_present", passed },
  { kind: "event_committed", passed: true },
];
const probes = (passed = true) => [
  { probe: "fallback-rate", passed },
  { probe: "act-share-max", passed },
  { probe: "memory-write", passed: false },
];
const base = (over: Partial<RunGradeInput> = {}): RunGradeInput => ({
  axes: all(4),
  rubric: HIDDEN_OBJECTIVE_RUBRIC,
  signals: signals(),
  probes: probes(),
  juryVoterCount: 3,
  ...over,
});

describe("gradeRun", () => {
  it("A+ requires every transcript axis at 4.5 or better and 100% thesis signals", () => {
    expect(gradeRun(base({ axes: all(5) })).grade).toBe("A+");
    expect(gradeRun(base({ axes: { ...all(5), voice_match: 4 } })).grade).toBe("A");
    expect(gradeRun(base({ axes: all(5), signals: [...signals(), { kind: "chosen_silence_present", passed: false }] })).grade).toBe("A-");
  });

  it("A requires 4.0 everywhere; one axis at 3.5 with strong signals is A-", () => {
    expect(gradeRun(base()).grade).toBe("A");
    const r = gradeRun(base({ axes: { ...all(4), creativity_unhinged: 3.5 } }));
    expect(r.grade).toBe("A-");
    expect(r.axesBelow4).toEqual(["creativity_unhinged"]);
    expect(r.reasons).toContain("creativity_unhinged 3.5 < 4");
  });

  it("A- tolerates one axis down to 3.0 and signals at 83%, not two axes, 2.5, or 75%", () => {
    const sixOfSeven = signals().map((s) => (s.kind === "chosen_silence_present" ? { ...s, passed: false } : s));
    expect(gradeRun(base({ axes: { ...all(4), creativity_unhinged: 3 }, signals: sixOfSeven })).grade).toBe("A-");
    expect(gradeRun(base({ axes: { ...all(4), creativity_unhinged: 3, voice_match: 3.5 } })).grade).toBe("B");
    expect(gradeRun(base({ axes: { ...all(4.2), creativity_unhinged: 2.5 } })).grade).toBe("B");
    const threeOfFour = [
      { kind: "private_channel_used", passed: false },
      { kind: "memory_referenced", passed: true },
      { kind: "memory_referenced", passed: true },
      { kind: "chosen_silence_present", passed: true },
    ];
    expect(gradeRun(base({ axes: all(4.2), signals: threeOfFour })).grade).toBe("B");
  });

  it("B, C and D follow the weighted mean", () => {
    expect(gradeRun(base({ axes: all(3.6) })).grade).toBe("B");
    expect(gradeRun(base({ axes: all(3.1) })).grade).toBe("C");
    expect(gradeRun(base({ axes: all(2.6) })).grade).toBe("D");
    expect(gradeRun(base({ axes: all(2.2) })).grade).toBe("F");
  });

  it("weights the mean by the rubric axis weight and halves narration axes", () => {
    const only = { in_character: 5, memory_continuity: 1 }; // weights 1.0 and 0.6
    const r = gradeRun(base({ axes: only }));
    expect(r.weightedMean).toBeCloseTo((5 * 1 + 1 * 0.6) / 1.6, 3);
    const withNarration = gradeRun(base({ axes: { in_character: 5 }, narrativeAxes: { concreteness: 1 } }));
    // concreteness weight 1.0 halved to 0.5 → (5 + 0.5) / 1.5
    expect(NARRATIVE_RUBRIC.axes.find((a) => a.id === "concreteness")?.weight).toBe(1);
    expect(withNarration.weightedMean).toBeCloseTo(5.5 / 1.5, 3);
  });

  it("F on a hygiene probe failure or a spoken forbidden phrase, whatever the scores", () => {
    const gate = gradeRun(base({ axes: all(5), probes: probes(false) }));
    expect(gate.grade).toBe("F");
    expect(gate.hygieneFailures).toEqual(["probe fallback-rate", "probe act-share-max"]);
    // act-share over the probe band but under the monopoly gate is advisory:
    // two agents choosing silence must not fail the talker's room.
    const shared = gradeRun(base({ axes: all(5), probes: [{ probe: "fallback-rate", passed: true }, { probe: "act-share-max", passed: false, measured: 0.57 }] }));
    expect(shared.grade).toBe("A+");
    expect(shared.hygieneFailures).toEqual([]);
    expect(shared.reasons.some((r) => r.startsWith("act-share-max 0.57"))).toBe(true);
    const monopoly = gradeRun(base({ axes: all(5), probes: [{ probe: "act-share-max", passed: false, measured: 0.8 }] }));
    expect(monopoly.grade).toBe("F");
    const spoken = gradeRun(base({ axes: all(5), signals: signals().map((s) => (s.kind === "forbidden_phrase_absent" ? { ...s, passed: false } : s)) }));
    expect(spoken.grade).toBe("F");
    expect(spoken.hygieneFailures).toEqual(["forbidden phrase spoken in public"]);
  });

  it("excludes an imputed axis from the mean, blocks A and A+, and spends the A- slot", () => {
    const r = gradeRun(base({ axes: { ...all(5), voice_match: 3 }, imputedAxes: ["voice_match"] }));
    expect(r.excludedAxes).toEqual(["voice_match"]);
    expect(r.weightedMean).toBe(5);
    expect(r.grade).toBe("A-");
    expect(gradeRun(base({ axes: { ...all(5), voice_match: 3, creativity_unhinged: 3.5 }, imputedAxes: ["voice_match"] })).grade).toBe("B");
    expect(r.reasons).toContain("unscored axes: voice_match");
  });

  it("skipped signals are not evaluated and cannot block A", () => {
    const r = gradeRun(base({ signals: [{ kind: "forbidden_phrase_absent", passed: true }, { kind: "chosen_silence_present", passed: false, skipped: true }] }));
    expect(r.signalPassRate).toBe(1);
    expect(r.grade).toBe("A");
  });

  it("provisional on fewer than two jurors, a salvaged judge, or a single-juror axis", () => {
    expect(gradeRun(base({ juryVoterCount: 1 })).provisional).toBe(true);
    expect(gradeRun(base({ juryVoterCount: undefined })).provisional).toBe(true);
    expect(gradeRun(base({ judgeSalvaged: true })).provisional).toBe(true);
    const thin = gradeRun(base({ juryAxisVoterCounts: { ...Object.fromEntries(axisIds.map((id) => [id, 3])), voice_match: 1 } }));
    expect(thin.provisional).toBe(true);
    expect(thin.reasons).toContain("single-juror axes: voice_match");
    expect(gradeRun(base({ juryAxisVoterCounts: Object.fromEntries(axisIds.map((id) => [id, 2])) })).provisional).toBe(false);
  });

  it("empty inputs grade F-provisional without throwing", () => {
    const r = gradeRun({ axes: {}, rubric: HIDDEN_OBJECTIVE_RUBRIC, signals: [], probes: [] });
    expect(r.grade).toBe("F");
    expect(r.weightedMean).toBeNull();
    expect(r.signalPassRate).toBeNull();
    expect(r.provisional).toBe(true);
  });
});

describe("scene and round folding", () => {
  const run = (grade: RunGrade["grade"], provisional = false): RunGrade & { runId: string } => ({
    grade, weightedMean: 4, signalPassRate: 1, hygieneFailures: [], minAxis: null, axesBelow4: [], excludedAxes: [], provisional, reasons: [], runId: "r",
  });

  it("scene grade is the median over seeds, rounding toward the worse grade", () => {
    expect(medianGrade(["A", "A-", "B"])).toBe("A-");
    expect(medianGrade(["A", "B"])).toBe("B");
    expect(medianGrade(["A+"])).toBe("A+");
    expect(gradeScene("s", [run("A"), run("B"), run("A+")]).grade).toBe("A");
  });

  it("round grade is the worst scene and inherits provisional", () => {
    expect(worstGrade(["A", "C", "A+"])).toBe("C");
    const round = gradeRound([gradeScene("a", [run("A")]), gradeScene("b", [run("B", true)])]);
    expect(round.grade).toBe("B");
    expect(round.provisional).toBe(true);
    expect(gradeRound([]).grade).toBe("F");
  });
});
