import { describe, it, expect } from "vitest";
import { extractDramaEvents } from "../drama/index.js";
import { runDramaProbes, type DramaProbeResult } from "../probes/drama.js";
import { PROBE_BANDS } from "../probes/types.js";
import { CONTRACT_FIXTURES, contractLines, innerOf, loadLines, mapFrames, without, type ContractFixture } from "./drama-contract-kit.js";

const ACTORS = ["person-1", "person-2", "person-3"];
type Lines = Record<string, unknown>[];

const probes = (lines: Lines, extra: { durationMs?: number } = {}): Map<string, DramaProbeResult> =>
  new Map(runDramaProbes({ events: extractDramaEvents(loadLines(lines)), actorIds: ACTORS, ...extra }).map((r) => [r.probe, r]));
const failing = (lines: Lines, extra: { durationMs?: number } = {}): string[] => [...probes(lines, extra)].filter(([, r]) => !r.passed).map(([name]) => name);
const is = (...t: string[]) => (f: Record<string, unknown>): boolean => t.includes(String(f["t"]));
const where = (t: string, key: string, value: unknown) => (f: Record<string, unknown>): boolean => f["t"] === t && f[key] === value;

describe("the contract's own frames pass every drama probe", () => {
  it.each(CONTRACT_FIXTURES)("%s: no probe fails and no failure code is raised", (name: ContractFixture) => {
    const results = probes(contractLines(name));
    expect([...results].filter(([, r]) => !r.passed).map(([n]) => n)).toEqual([]);
    expect([...results.values()].flatMap((r) => r.codes)).toEqual([]);
    for (const r of results.values()) expect(r.bound).toEqual(PROBE_BANDS[r.probe]);
  });

  it("reads the slap scene's latencies from act_beat on the hotel's clock", () => {
    const r = probes(contractLines("contract-slap-human-take"));
    expect(r.get("reaction-latency-p90-target")!.measured).toBe(700);
    expect(r.get("reaction-latency-p90-witness")).toMatchObject({ measured: 1400, evidence: { clock: "hotel_at" } });
    expect(r.get("witness-coverage")).toMatchObject({ measured: 1, evidence: { judged: 3, covered: 3 } });
  });

  it("keeps blocked and aborted acts out of the act count and the ladder, and audits their reasons", () => {
    const r = probes(contractLines("contract-blocked-aborted"));
    expect(r.get("act-rate")!.evidence).toMatchObject({ perScene: { "7.2": { acts: 1 } } });
    expect(r.get("ladder-compliance")).toMatchObject({ measured: 1, evidence: { judged: 1 } });
    expect(r.get("blocked-reason-audit")!.evidence).toMatchObject({ blocked: 2, aborted: 1, blockedByReason: { consent_off: 1, no_scenario_gate: 1 }, abortedByReason: { paused: 1 } });
  });

  it("lets an authored kill skip the ladder, and a revived actor speak again", () => {
    const r = probes(contractLines("contract-kill-actor-revive"));
    expect(r.get("ladder-compliance")).toMatchObject({ measured: 1, evidence: { judged: 1 } });
    expect(r.get("dead-speech")!.measured).toBe(0);
    expect(r.get("scene-cut-revive")!.evidence).toMatchObject({ cuts: 1, revives: 1 });
  });

  it("does not call a killed human dead for chatting while down, and sees the 5000 ms window close exactly", () => {
    const r = probes(contractLines("contract-kill-human-down"));
    expect(r.get("dead-speech")!.measured).toBe(0);
    expect(r.get("down-window-exact")!.evidence).toMatchObject({ windows: 1, worstDeviationMs: 0, clock: "hotel_at" });
  });
});

describe("adversarial frames in the real wrapper", () => {
  const slap = () => contractLines("contract-slap-human-take");

  it("is not fooled by a log that stamped the reactions seconds late: the hotel's `at` decides", () => {
    const lagged = slap().map((l) => (innerOf(l)["t"] === "act_reaction" ? { ...l, ts_ms: Number(l["ts_ms"]) + 5_000 } : l));
    expect(probes(lagged).get("reaction-latency-p90-witness")!.measured).toBe(1400);
    const noAt = mapFrames(lagged, is("act_beat", "act_reaction"), (f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== "at")));
    expect(probes(noAt).get("reaction-latency-p90-witness")).toMatchObject({ passed: false, evidence: { clock: "ts_ms" } });
  });

  it("judges no reaction for an act with no contact beat, and fails nothing for it", () => {
    const r = probes(without(slap(), is("act_beat", "act_reaction")));
    expect(r.get("reaction-latency-p90-target")).toMatchObject({ measured: 0, evidence: { judged: 0 } });
    expect(failing(without(slap(), is("act_beat", "act_reaction")))).toEqual([]);
  });

  it("fails coverage when an owed witness never reacted, and latency's D1 when nobody did", () => {
    const noWitness = without(slap(), (f) => f["t"] === "act_reaction" && f["act_id"] === "a17" && f["who"] === -703);
    expect(failing(noWitness)).toEqual(["witness-coverage"]);
    const nobody = without(slap(), (f) => f["t"] === "act_reaction" && f["act_id"] === "a15");
    expect(failing(nobody)).toEqual(["reaction-latency-p90-target", "witness-coverage"]);
    expect(probes(nobody).get("reaction-latency-p90-target")!.codes).toEqual(["D1"]);
  });

  it("fails owed-missed-empty when the hotel reports a reaction it never saw", () => {
    const missed = mapFrames(slap(), where("act_done", "act_id", "a17"), (f) => ({ ...f, owed_missed: [{ who: -703, role: "witness" }] }));
    expect(failing(missed)).toEqual(["owed-missed-empty"]);
  });

  it("fails the consent probes when a violent act touched a human who took nothing", () => {
    const noTake = without(slap(), where("drama_consent", "phase", "answered"));
    expect(failing(noTake)).toEqual(["consent-violation", "human-untouched-without-take"]);
    expect(probes(noTake).get("human-untouched-without-take")!.evidence).toMatchObject({ offenders: [{ actId: "a17", touched: ["contact", "landed"] }] });
  });

  it("fails chip-timeout-dodge when a timed-out chip landed", () => {
    const timedOut = mapFrames(
      mapFrames(slap(), where("drama_consent", "phase", "answered"), (f) => ({ ...f, answer: "timeout" })),
      where("act_done", "act_id", "a17"),
      (f) => ({ ...f, answer: "timeout" }),
    );
    const failed = failing(timedOut);
    expect(failed).toContain("chip-timeout-dodge");
    expect(probes(timedOut).get("chip-timeout-dodge")!.evidence).toMatchObject({ offenders: [{ actId: "a17", verb: "slap", expected: "dodged", outcome: "landed" }] });
  });

  it("fails blocked-reason-audit for a reason outside the enum, and keeps the block out of the act count", () => {
    const weird = mapFrames(contractLines("contract-blocked-aborted"), where("act_done", "act_id", "a18"), (f) => ({ ...f, reason: "because" }));
    expect(failing(weird)).toEqual(["blocked-reason-audit"]);
    expect(probes(weird).get("act-rate")!.evidence).toMatchObject({ perScene: { "7.2": { acts: 1 } } });
  });

  it("fails scene-cut-revive when the revive frame is missing, and dead-speech when the dead speaks on", () => {
    const noRevive = without(contractLines("contract-kill-actor-revive"), is("actor_revive"));
    expect(failing(noRevive)).toEqual(["dead-speech", "scene-cut-revive"]);
    expect(probes(noRevive).get("scene-cut-revive")!.evidence).toMatchObject({ offenders: [{ issue: "revive_missing", actor: "person-2", scene: "7.3" }] });
  });

  it("fails scene-cut-revive for a revive no cut announced", () => {
    const noCut = without(contractLines("contract-kill-actor-revive"), is("scene_cut"));
    expect(failing(noCut)).toEqual(["scene-cut-revive"]);
  });

  it("fails down-window-exact when the human stood up early, and when they never did", () => {
    const early = mapFrames(contractLines("contract-kill-human-down"), is("human_up"), (f) => ({ ...f, at: Number(f["at"]) - 1_000 }));
    expect(failing(early)).toEqual(["down-window-exact"]);
    expect(probes(early).get("down-window-exact")!.evidence).toMatchObject({ worstDeviationMs: 1_000, offenders: [{ issue: "off_window", actualMs: 4_000 }] });
    expect(failing(without(contractLines("contract-kill-human-down"), is("human_up")), { durationMs: 200_000 })).toEqual(["down-window-exact"]);
  });

  it("calls a human who died as an actor dead only by an actor_death: a human_down alone never flags their speech", () => {
    const noUp = without(contractLines("contract-kill-human-down"), is("human_up"));
    expect(probes(noUp).get("dead-speech")!.measured).toBe(0);
  });

  it("flags the opening slap of a scene as a skipped rung unless it carries authored_skip", () => {
    const noPrelude = without(slap(), (f) => ["a14", "a15", "a16"].includes(String(f["act_id"])));
    expect(failing(noPrelude)).toEqual(["ladder-compliance"]);
    const authored = mapFrames(noPrelude, where("act_started", "act_id", "a17"), (f) => ({ ...f, authored_skip: true }));
    expect(failing(authored)).toEqual([]);
  });
});
