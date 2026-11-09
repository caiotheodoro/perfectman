import { describe, it, expect } from "vitest";
import { ABORT_REASONS, BLOCKED_REASONS, type ConsentChipAnsweredEvent, type DramaEvent } from "../drama/index.js";
import { blockedReasonAudit, chipTimeoutDodge, humanUntouchedWithoutTake, owedMissedEmpty } from "../probes/drama-contract.js";
import { PROBE_BANDS } from "../probes/types.js";
import { beat, done, humanDown, input, started, take } from "./drama-probe-fixtures.js";

describe("owed-missed-empty (REA-10)", () => {
  it("is 0 when every act_done owed nothing missed, or says nothing about it", () => {
    const events = [done("a", 1_000, "landed", { owedMissed: [] }), done("b", 2_000, "blocked", { reason: "ladder" })];
    expect(owedMissedEmpty(input(events))).toMatchObject({ measured: 0, judged: 2, offenders: [] });
  });

  it("counts every reaction still owed at the end of a window and names the act", () => {
    const events = [
      done("a", 1_000, "landed", { owedMissed: [{ who: "b", role: "target" }, { who: "c", role: "witness" }] }),
      done("b", 2_000, "landed", { owedMissed: [{ who: "c", role: "witness" }] }),
      done("c", 3_000, "landed", { owedMissed: [] }),
    ];
    const r = owedMissedEmpty(input(events));
    expect(r.measured).toBe(3);
    expect(r.offenders.map((o) => o.actId)).toEqual(["a", "b"]);
    expect(r.measured).toBeGreaterThan(PROBE_BANDS["owed-missed-empty"]![1]);
  });
});

describe("blocked-reason-audit (FRM-2)", () => {
  const blocked = (id: string, reason: string | undefined): DramaEvent => done(id, 1_000, "blocked", { verb: "slap", actor: "a", with: "b", ...(reason !== undefined ? { reason } : {}) });
  const aborted = (id: string, reason: string | undefined): DramaEvent => done(id, 2_000, "aborted", { ...(reason !== undefined ? { reason } : {}) });

  it("passes every reason of the contract's two enums for the outcome it belongs to", () => {
    const events = [...BLOCKED_REASONS.map((r, i) => blocked(`b${i}`, r)), ...ABORT_REASONS.map((r, i) => aborted(`a${i}`, r))];
    expect(blockedReasonAudit(input(events))).toMatchObject({ measured: 0, blocked: 10, aborted: 10, invalid: [] });
  });

  it("flags a missing reason, an unknown one, and one from the other outcome's enum", () => {
    const events = [blocked("none", undefined), blocked("typo", "calm"), blocked("wrongEnum", "paused"), aborted("noneA", undefined), aborted("wrongEnumA", "ladder"), aborted("ok", "paused")];
    const r = blockedReasonAudit(input(events));
    expect(r.measured).toBe(5);
    expect(r.invalid.map((i) => i.actId)).toEqual(["none", "typo", "wrongEnum", "noneA", "wrongEnumA"]);
  });

  it("tallies the reasons it saw, and reports a blocked act that has a start as informational", () => {
    const events = [blocked("x", "ladder"), blocked("y", "ladder"), blocked("z", "cooldown"), aborted("w", "calm_room"), started("y", 500, "a", "slap", { with: "b" })];
    const r = blockedReasonAudit(input(events));
    expect(r.blockedByReason).toEqual({ ladder: 2, cooldown: 1 });
    expect(r.abortedByReason).toEqual({ calm_room: 1 });
    expect(r.blockedWithStart).toEqual(["y"]);
    expect(r.measured).toBe(0);
  });

  it("does not look at landed, dodged, declined or timed-out acts", () => {
    const events = ["landed", "dodged", "declined", "timeout"].map((o, i) => done(`o${i}`, i * 1_000, o as "landed", { reason: "whatever" }));
    expect(blockedReasonAudit(input(events))).toMatchObject({ measured: 0, blocked: 0, aborted: 0 });
  });
});

describe("chip-timeout-dodge (CHIP-3, CHIP-5)", () => {
  const timedOut = (verb: string, outcome: "dodged" | "timeout" | "landed" | "declined" | "aborted"): DramaEvent[] => [
    started("c", 0, "a", verb, { with: "h:9", chip: true }),
    { ...take("c", 4_000), answer: "timeout", rawAnswer: "timeout" },
    done("c", 4_100, outcome, { answer: "timeout" }),
  ];

  it.each(["shove", "slap", "punch", "kill", "insult", "kiss"])("passes %s that timed out and ended dodged", (verb) => {
    expect(chipTimeoutDodge(input(timedOut(verb, "dodged")))).toMatchObject({ measured: 1, judged: 1, offenders: [] });
  });

  it("passes a hug that timed out and ended timeout: it completed with the initiator's steps", () => {
    expect(chipTimeoutDodge(input(timedOut("hug", "timeout")))).toMatchObject({ measured: 1, offenders: [] });
  });

  it("flags a timeout that landed, a hug that was dodged, and a kiss that completed", () => {
    expect(chipTimeoutDodge(input(timedOut("slap", "landed"))).offenders).toEqual([{ actId: "c", verb: "slap", expected: "dodged", outcome: "landed" }]);
    expect(chipTimeoutDodge(input(timedOut("hug", "dodged"))).offenders).toEqual([{ actId: "c", verb: "hug", expected: "timeout", outcome: "dodged" }]);
    expect(chipTimeoutDodge(input(timedOut("kiss", "timeout"))).offenders).toEqual([{ actId: "c", verb: "kiss", expected: "dodged", outcome: "timeout" }]);
  });

  it("reads a timeout from act_done's own answer when the chip frame is missing, and ignores chips that were answered", () => {
    const fromDone = [started("c", 0, "a", "punch", { with: "h:9" }), done("c", 4_100, "landed", { answer: "timeout" })];
    expect(chipTimeoutDodge(input(fromDone)).offenders.map((o) => o.actId)).toEqual(["c"]);
    const answered = [started("c", 0, "a", "punch", { with: "h:9" }), take("c", 500), done("c", 700, "landed", { answer: "take" })];
    expect(chipTimeoutDodge(input(answered))).toMatchObject({ judged: 0, measured: 1 });
  });

  it("leaves a timed-out chip whose act aborted, or never finished, unresolved rather than judged", () => {
    expect(chipTimeoutDodge(input(timedOut("slap", "aborted")))).toMatchObject({ judged: 0, unresolvedActIds: ["c"] });
    expect(chipTimeoutDodge(input(timedOut("slap", "dodged").slice(0, 2)))).toMatchObject({ judged: 0, unresolvedActIds: ["c"] });
  });

  it("is the share of timed-out chips that ended as the contract says, 1 when none timed out, passing only at 1", () => {
    expect(chipTimeoutDodge(input([]))).toMatchObject({ measured: 1, judged: 0 });
    const mixed = (["dodged", "dodged", "dodged", "landed"] as const).flatMap((o, i) => timedOut("slap", o).map((e) => ({ ...e, ...("actId" in e ? { actId: `c${i}`, pairId: `c${i}` } : {}) }) as DramaEvent));
    const r = chipTimeoutDodge(input(mixed));
    expect(r.measured).toBe(0.75);
    expect(r.measured).toBeLessThan(PROBE_BANDS["chip-timeout-dodge"]![0]);
  });
});

describe("human-untouched-without-take (HUM-1, CHIP-6)", () => {
  const onHuman = (verb: string, outcome: "landed" | "dodged" = "landed"): DramaEvent[] => [started("p", 0, "a", verb, { with: "h:9", chip: true }), beat("p", 4_150), done("p", 7_000, outcome)];
  const answeredAs = (rawAnswer: ConsentChipAnsweredEvent["rawAnswer"], atMs: number, actId = "p"): ConsentChipAnsweredEvent => ({ ...take(actId, atMs), rawAnswer, answer: rawAnswer === "take" ? "take" : "decline" });

  it("passes a physical act on a human who took it before the contact", () => {
    expect(humanUntouchedWithoutTake(input([...onHuman("slap"), take("p", 4_000)]))).toMatchObject({ measured: 0, judged: 1 });
  });

  it("flags contact that came with no take, even when the act did not end landed", () => {
    expect(humanUntouchedWithoutTake(input(onHuman("punch", "dodged"))).offenders).toEqual([{ actId: "p", verb: "punch", human: "h:9", touched: ["contact"] }]);
    expect(humanUntouchedWithoutTake(input(onHuman("punch"))).offenders[0]!.touched).toEqual(["contact", "landed"]);
  });

  it("flags a take that came after the contact, a take for another act, and a dodge or push back", () => {
    expect(humanUntouchedWithoutTake(input([...onHuman("slap"), take("p", 4_151)])).measured).toBe(1);
    expect(humanUntouchedWithoutTake(input([...onHuman("slap"), take("other", 4_000)])).measured).toBe(1);
    expect(humanUntouchedWithoutTake(input([...onHuman("slap"), answeredAs("dodge", 4_000)])).measured).toBe(1);
    expect(humanUntouchedWithoutTake(input([...onHuman("slap"), answeredAs("push_back", 4_000)])).measured).toBe(1);
  });

  it("flags a human put down without a take, and passes one put down after it", () => {
    const killed = [started("p", 0, "a", "kill", { with: "h:9", chip: true }), humanDown("h:9", 4_325, 5000, { actId: "p" })];
    expect(humanUntouchedWithoutTake(input(killed)).offenders).toEqual([{ actId: "p", verb: "kill", human: "h:9", touched: ["down"] }]);
    expect(humanUntouchedWithoutTake(input([...killed, take("p", 4_000)])).measured).toBe(0);
  });

  it("judges only physical acts aimed at a human: an insult, a glare, a hug and an act on an actor are not its business", () => {
    const events = ["insult", "glare", "hug"].flatMap((verb, i) => [started(`v${i}`, i * 10_000, "a", verb, { with: "h:9" }), beat(`v${i}`, i * 10_000 + 300), done(`v${i}`, i * 10_000 + 3_300)]);
    events.push(started("actor", 50_000, "a", "slap", { with: "b" }), beat("actor", 50_300), done("actor", 53_300));
    expect(humanUntouchedWithoutTake(input(events))).toMatchObject({ measured: 0, judged: 0 });
  });

  it("does not flag a physical act on a human that never reached contact: aborted, or dodged at the chip", () => {
    const aborted = [started("p", 0, "a", "slap", { with: "h:9", chip: true }), done("p", 1_000, "aborted", { reason: "calm_room" })];
    expect(humanUntouchedWithoutTake(input(aborted))).toMatchObject({ measured: 0, judged: 1 });
  });
});
