import { describe, expect, it } from "vitest";
import { innerOf, lifecycleLines, mapFrames, probesOf, without } from "./drama-hotel-kit.js";
import type { Line } from "./drama-hotel-kit.js";

/** The probes that fail on a set of lines, with the D-codes they name. A clean lifecycle fails none (drama-hotel-lifecycles.test.ts). */
const failures = (lines: readonly Line[]): Record<string, string[]> =>
  Object.fromEntries([...probesOf(lines)].filter(([, r]) => !r.passed).map(([name, r]) => [name, r.codes]));

const isT = (t: string) => (f: Record<string, unknown>) => f["t"] === t;
const answered = (f: Record<string, unknown>) => f["t"] === "drama_consent" && f["phase"] === "answered";
const sortByTime = (lines: Line[]): Line[] => [...lines].sort((a, b) => Number(a["ts_ms"]) - Number(b["ts_ms"]));
const shifted = (f: Record<string, unknown>, by: number): Record<string, unknown> => (typeof f["at"] === "number" ? { ...f, at: f["at"] + by } : f);

/** A copy of one recorded act, as another act (new id, later by `by` ms): the hotel's own frames, repeated. */
function repeatAct(lines: readonly Line[], actId: string, by: number, id: string): Line[] {
  return lines
    .filter((l) => innerOf(l)["act_id"] === actId || innerOf(l)["cmd"] !== undefined)
    .map((l) => ({ ...l, ts_ms: Number(l["ts_ms"]) + by, frame: { ...shifted(innerOf(l), by), ...(innerOf(l)["act_id"] !== undefined ? { act_id: id } : {}) } }));
}

describe("the probes fail on the hotel's real lifecycles when they are corrupted in a specific way", () => {
  const take = lifecycleLines("slap-human-take");
  const kill = lifecycleLines("kill-actor-revive");
  const down = lifecycleLines("down-human-abort");
  const timeout = lifecycleLines("slap-human-timeout");

  it("[REA-1] [REA-10] a witness the hotel says owes a reaction never gets to react: witness-coverage fails with D1, and with every reaction gone it still does", () => {
    expect(failures(without(take, (f) => f["t"] === "act_reaction" && f["who"] === -702))).toEqual({ "witness-coverage": ["D1"] });
    expect(failures(without(take, isT("act_reaction")))).toEqual({ "witness-coverage": ["D1"] });
  });

  it("[REA-1] the target of a kill never reacts and never dies on screen: the target's reaction latency fails with D1 (the death itself counts as the reaction, so dropping only the `die` reaction passes)", () => {
    expect(failures(without(kill, (f) => f["t"] === "act_reaction" && f["who"] === -702))).toEqual({});
    expect(failures(without(kill, (f) => (f["t"] === "act_reaction" && f["who"] === -702) || f["t"] === "actor_death"))).toMatchObject({ "reaction-latency-p90-target": ["D1"] });
  });

  it("[DEATH-5] the dead actor speaks after its death: dead-speech fails with D4", () => {
    const chat: Line = { conn: 4, dir: "in", frame: { t: "actor_cmd", seq: 999, cid: 77, run: 7, lease: 1, actor: -702, cmd: { k: "chat", mode: "say", text: "estou vivo" } }, run: 7, ts_ms: 1_003_000 };
    expect(failures(sortByTime([...kill, chat]))).toEqual({ "dead-speech": ["D4"] });
    expect(failures(sortByTime([...kill, { ...chat, ts_ms: 1_021_000 }]))).toEqual({});
  });

  it("[DEATH-7] a scene cut that names a revived actor with no actor_revive after it: scene-cut-revive fails with D4", () => {
    expect(failures(without(kill, isT("actor_revive")))).toEqual({ "scene-cut-revive": ["D4"] });
  });

  it("[DOWN-3] a human stands up 1.5 s too early, or 2 s too late: down-window-exact fails (no D-code names it)", () => {
    expect(failures(mapFrames(down, isT("human_up"), (f) => shifted(f, -1500)))).toEqual({ "down-window-exact": [] });
    expect(failures(mapFrames(down, isT("human_up"), (f) => shifted(f, 2000)))).toEqual({ "down-window-exact": [] });
  });

  it("[CHIP-6] [HUM-1] violence lands on a human who never answered, or who dodged: consent-violation and human-untouched-without-take fail with D7", () => {
    const both = { "consent-violation": ["D7"], "human-untouched-without-take": ["D7"] };
    expect(failures(without(take, answered))).toEqual(both);
    expect(failures(mapFrames(take, answered, (f) => ({ ...f, answer: "dodge" })))).toEqual(both);
  });

  it("[CHIP-2] contact is 750 ms before the take is answered instead of 150 ms after: take-contact-windup fails, and the act touched a human before consent", () => {
    expect(failures(mapFrames(take, isT("act_beat"), (f) => ({ ...f, at: 1_000_400 })))).toEqual({ "human-untouched-without-take": ["D7"], "take-contact-windup": [] });
  });

  it("[LAD-1] [LAD-2] a kill with no authored skip and no rung under it: ladder-compliance fails with D3", () => {
    expect(failures(mapFrames(kill, isT("act_started"), (f) => ({ ...f, authored_skip: false, skipped_rungs: [], origin: "model" })))).toEqual({ "ladder-compliance": ["D3"] });
  });

  it("[FRM-2] a blocked act that names no reason: blocked-reason-audit fails", () => {
    expect(Object.keys(failures(mapFrames(kill, isT("act_done"), (f) => ({ ...f, outcome: "blocked" }))))).toContain("blocked-reason-audit");
  });

  it("[CHIP-3] a chip that timed out and ended landed: chip-timeout-dodge fails with D7, and so does consent", () => {
    expect(failures(mapFrames(timeout, isT("act_done"), (f) => ({ ...f, outcome: "landed" })))).toEqual({ "chip-timeout-dodge": ["D7"], "consent-violation": ["D7"], "human-untouched-without-take": ["D7"] });
  });

  it("[REA-10] an act_done that lists a missed reaction: owed-missed-empty fails with D1", () => {
    expect(failures(mapFrames(take, isT("act_done"), (f) => ({ ...f, owed_missed: [{ who: -702, role: "witness" }] })))).toEqual({ "owed-missed-empty": ["D1"] });
  });

  it("[SAFE-4] a fourth landed violent act on a human inside the harm window: harm-window fails with D7 (three pass)", () => {
    const three = [...take, ...repeatAct(take, "s1", 25_000, "s2"), ...repeatAct(take, "s1", 50_000, "s3")];
    expect(failures(sortByTime(three))).toEqual({});
    expect(failures(sortByTime([...three, ...repeatAct(take, "s1", 75_000, "s4")]))).toEqual({ "harm-window": ["D7"] });
  });
});
