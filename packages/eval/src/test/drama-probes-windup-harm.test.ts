import { describe, it, expect } from "vitest";
import type { DramaEvent } from "../drama/index.js";
import { DOWN_TOLERANCE_MS, HARM_MAX_DEFAULT, HARM_WINDOW_MS_DEFAULT, harmWindow, takeContactWindup } from "../probes/drama-contract.js";
import { beat, done, input, started, take } from "./drama-probe-fixtures.js";

describe("take-contact-windup (TBL-3)", () => {
  const chipped = (answerAt: number, contactAt: number, hotel?: { answer: number; contact: number }): DramaEvent[] => [
    started("c", 0, "a", "slap", { with: "h:9", chip: true }),
    { ...take("c", answerAt), ...(hotel ? { hotelAt: hotel.answer } : {}) },
    beat("c", contactAt, [], hotel ? { hotelAt: hotel.contact } : {}),
  ];

  it("passes contact exactly 150 ms after the take on the hotel's clock", () => {
    expect(takeContactWindup(input(chipped(3_000, 3_150, { answer: 1_730_000_123_860, contact: 1_730_000_124_010 })))).toMatchObject({ measured: 0, judged: 1, clock: "hotel_at" });
  });

  it("fails a contact 1 ms off the 150 on the hotel's clock", () => {
    const r = takeContactWindup(input(chipped(3_000, 3_150, { answer: 1_000, contact: 1_151 })));
    expect(r.offenders).toEqual([{ actId: "c", gapMs: 151 }]);
  });

  it("allows the log's own jitter, and no more, when the frames carry no `at`", () => {
    expect(takeContactWindup(input(chipped(3_000, 3_150 + DOWN_TOLERANCE_MS))).measured).toBe(0);
    expect(takeContactWindup(input(chipped(3_000, 3_151 + DOWN_TOLERANCE_MS))).measured).toBe(1);
    expect(takeContactWindup(input(chipped(3_000, 3_150))).clock).toBe("ts_ms");
  });

  it("does not judge a take whose act never reached contact, nor a dodge", () => {
    const aborted = [started("c", 0, "a", "slap", { with: "h:9", chip: true }), take("c", 3_000), done("c", 3_050, "aborted", { reason: "opt_out" })];
    expect(takeContactWindup(input(aborted))).toMatchObject({ measured: 0, judged: 0 });
    const dodge = [...chipped(3_000, 9_999)].map((e) => (e.kind === "consent_chip" && e.phase === "answered" ? { ...e, rawAnswer: "dodge" as const, answer: "decline" as const } : e));
    expect(takeContactWindup(input(dodge)).judged).toBe(0);
  });
});

describe("harm-window (SAFE-4)", () => {
  const S = 1000;
  const landed = (id: string, atMs: number, verb = "slap", target = "h:9", room = "12"): DramaEvent[] => [
    started(id, atMs - 300, "a", verb, { with: target, room }),
    beat(id, atMs, [], { room }),
    done(id, atMs + 3_000, "landed", { room }),
  ];
  const run = (acts: DramaEvent[][], extra: { harmMax?: number; harmWindowMs?: number } = {}) => harmWindow({ ...input(acts.flat()), ...extra });

  it("is the contract's N=3 per 300 s by default", () => {
    expect([HARM_MAX_DEFAULT, HARM_WINDOW_MS_DEFAULT]).toEqual([3, 300_000]);
  });

  it("passes three landed violent acts on humans in a window, and flags the fourth", () => {
    const acts = [landed("v1", 10 * S), landed("v2", 40 * S), landed("v3", 70 * S)];
    expect(run(acts)).toMatchObject({ measured: 0, offenders: [] });
    expect(run([...acts, landed("v4", 100 * S)]).offenders).toEqual([{ actId: "v4", room: "12", inWindow: 4 }]);
  });

  it("lets the window slide: a fourth act 300 s after the first is in a new window", () => {
    const acts = [landed("v1", 10 * S), landed("v2", 40 * S), landed("v3", 70 * S)];
    expect(run([...acts, landed("v4", 10 * S + 299_999)]).measured).toBe(1);
    expect(run([...acts, landed("v4", 10 * S + 300_000)]).measured).toBe(0);
  });

  it("counts an insult and a kill at a human, and nothing else: an actor target, a dodge and a hug do not count", () => {
    const four = [landed("v1", 10 * S, "insult"), landed("v2", 40 * S, "shove"), landed("v3", 70 * S, "kill"), landed("v4", 100 * S, "punch")];
    expect(run(four).measured).toBe(1);
    const notCounted = [landed("a1", 10 * S, "slap", "b"), landed("a2", 20 * S, "hug"), landed("a3", 30 * S, "kiss"), landed("a4", 40 * S, "glare"), landed("a5", 50 * S, "slap", "b")];
    expect(run([...notCounted, landed("v1", 60 * S), landed("v2", 70 * S), landed("v3", 80 * S)]).measured).toBe(0);
    const dodged = [started("d", 0, "a", "slap", { with: "h:9" }), beat("d", 300), done("d", 3_300, "dodged")];
    expect(run([dodged, ...[1, 2, 3].map((i) => landed(`v${i}`, i * 10 * S))]).measured).toBe(0);
  });

  it("counts each room on its own", () => {
    const acts = [landed("v1", 10 * S, "slap", "h:9", "12"), landed("v2", 20 * S, "slap", "h:9", "12"), landed("v3", 30 * S, "slap", "h:9", "12"), landed("w1", 40 * S, "slap", "h:11", "13")];
    expect(run(acts).measured).toBe(0);
  });

  it("follows the configured N and window, and N of 0 flags every one", () => {
    const acts = [landed("v1", 10 * S), landed("v2", 40 * S)];
    expect(run(acts, { harmMax: 1 }).offenders.map((o) => o.actId)).toEqual(["v2"]);
    expect(run(acts, { harmMax: 1, harmWindowMs: 20 * S }).measured).toBe(0);
    expect(run(acts, { harmMax: 0 }).measured).toBe(2);
  });

  it("empties the window when a pause ends, and not when drama_state only repeats an unpaused room", () => {
    const state = (atMs: number, paused: boolean): DramaEvent => ({ kind: "drama_state", atMs, room: "12", paused, optIn: ["h:9"] });
    const before = [landed("v1", 10 * S), landed("v2", 40 * S), landed("v3", 70 * S)];
    const after = landed("v4", 100 * S);
    expect(run([before.flat(), [state(80 * S, true), state(90 * S, false)], after]).measured).toBe(0);
    expect(run([before.flat(), [state(80 * S, false), state(90 * S, false)], after]).measured).toBe(1);
  });
});
