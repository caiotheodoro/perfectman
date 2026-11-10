/**
 * What the scene spine may open of the ladder (errata P8): what a rung it opened reads as to the director (`unlocked` on the relation reading: the volition of every ladder verb
 * up to it, never the punch or the kill, and their grievance), what the grievance ledger keeps (`unlock`, `consume`, the hold) and who `pickEscalation` opens it for. What
 * `DramaBody` and `SpineEscalation` do with it is `drama-spine-escalation.test.ts`; the end-to-end climb is `drama-sim-spine-escalation.test.ts` in the eval package.
 */
import { describe, expect, it } from "vitest";
import { pickEscalation } from "../director/drama/escalation.js";
import { motive, volition } from "../director/drama/pressure.js";
import { ProvocationLedger } from "../director/drama/provocation.js";
import type { Listener, SpokenLine } from "../director/drama/provocation.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";
import { B, emotion } from "../testing/drama-rig.js";

const T = DEFAULT_DRAMA_TUNING;

describe("what an opened rung reads as to the director (RelationReading.unlocked)", () => {
  const read = (unlocked: number | undefined) => {
    const e = emotion({}, { relation: { resentment: 0, lastNegativeAt: null, ...(unlocked !== undefined ? { unlocked } : {}) } });
    return { e, r: e.relations!.get(B) };
  };
  const m = (verb: "glare" | "insult" | "shove" | "slap" | "punch" | "kill", unlocked: number | undefined) => {
    const { e, r } = read(unlocked);
    return motive(verb, e, r, 0, T);
  };

  it("nothing opened, nothing changes: a cold pair is refused for want of a motive, a slap has no driver the talk reaches", () => {
    for (const verb of ["glare", "insult", "shove", "slap"] as const) expect(m(verb, undefined), verb).toMatchObject({ ok: false, why: "volition" });
  });

  it("the shove opened: every rung up to it passes volition and grievance, the slap still does not", () => {
    for (const verb of ["glare", "insult", "shove"] as const) expect(m(verb, 3).ok, verb).toBe(true);
    expect(m("slap", 3)).toMatchObject({ ok: false, why: "volition" });
  });

  it("the slap opened: it passes with no resentment and no negative event, which is the gate a slap always kept", () => {
    expect(m("slap", 4).ok).toBe(true);
    const { e, r } = read(4);
    expect(volition("slap", e, r, T)).toBe(T.provocation.unlock.volition);
  });

  it("never the punch or the kill, whatever number is read, and the reading cannot be pushed past the slap", () => {
    for (const unlocked of [4, 5, 6, 99]) {
      expect(m("punch", unlocked).ok, `punch at ${unlocked}`).toBe(false);
      expect(m("kill", unlocked).ok, `kill at ${unlocked}`).toBe(false);
    }
    expect(volition("punch", read(6).e, read(6).r, T)).toBe(0);
  });

  it("clears every theta the tuning can make: the volition it reads is at least the highest slap threshold, patience and falling arousal included", () => {
    expect(T.provocation.unlock.volition).toBeGreaterThanOrEqual(T.theta[4] + T.patienceBoost + T.momentumGain);
    const calm = emotion({ strategicPatience: 1 }, { relation: { resentment: 0, lastNegativeAt: null, unlocked: 4 }, core: { arousal: 0.1, momentumArousal: -1 } });
    expect(motive("slap", calm, calm.relations!.get(B), 0, T).ok).toBe(true);
  });
});

/** A ledger on a clock the test moves, with the pair rule open for `allowed` (default: every ordered pair). */
function ledger(allowed: (a: string, b: string) => boolean = () => true) {
  let t = 1_000_000;
  const l = new ProvocationLedger(() => T.provocation, () => t, allowed);
  return { l, advance: (ms: number) => void (t += ms), now: () => t };
}
const line = (speaker: string, content: string, over: Partial<SpokenLine> = {}): SpokenLine => ({ speaker, content, addressees: [], mentioned: [], ...over });
const heard = (...refs: string[]): Listener[] => refs.map((ref) => ({ ref, heard: true }));
const at = (speaker: string, target: string, content: string): [SpokenLine, Listener[]] => [line(speaker, content, { addressees: [target], mentioned: [target] }), heard(target)];

describe("ProvocationLedger.unlock", () => {
  it("opens the shove for an allowed pair: writes the grievance at the unlock level and lasts the hold, then lapses", () => {
    const { l, advance } = ledger();
    expect(l.unlock("p1", "p3", "shove")).toBe("granted");
    expect(l.unlockedRung("p1", "p3")).toBe(3);
    expect(l.levelOf("p1", "p3")).toBeCloseTo(T.provocation.unlock.provocation, 2);
    expect(l.offenders("p1")).toEqual(["p3"]);
    expect(l.unlockOf("p1")).toEqual({ offender: "p3", rung: 3 });
    advance(T.provocation.unlock.holdMs - 1);
    expect(l.unlockedRung("p1", "p3")).toBe(3);
    advance(2);
    expect(l.unlockedRung("p1", "p3")).toBeUndefined();
    expect(l.unlockOf("p1")).toBeUndefined();
  });

  it("the slap is the top: a later call renews and raises, never lowers; asking again is a refresh, not a second grant", () => {
    const { l, advance } = ledger();
    expect(l.unlock("p1", "p3", "shove")).toBe("granted");
    advance(30_000);
    expect(l.unlock("p1", "p3", "shove")).toBe("refreshed");
    expect(l.unlock("p1", "p3", "slap")).toBe("granted");
    expect(l.unlockedRung("p1", "p3")).toBe(4);
    expect(l.unlock("p1", "p3", "shove")).toBe("refreshed");
    expect(l.unlockedRung("p1", "p3")).toBe(4);
  });

  it("only for a pair the scenario lets, never oneself, nothing for a human or a stranger", () => {
    const { l } = ledger((o, s) => o === "p1" && s === "p3");
    expect(l.unlock("p3", "p1", "shove")).toBe("skipped");
    expect(l.unlock("p1", "p1", "shove")).toBe("skipped");
    expect(l.unlock("p1", "h:9", "slap")).toBe("skipped");
    expect(l.unlockedRung("p3", "p1")).toBeUndefined();
    expect(l.levelOf("p3", "p1")).toBe(0);
    expect(l.unlock("p1", "p3", "shove")).toBe("granted");
  });

  it("ends with the blow it opened: a shove thrown ends a shove unlock, a slap thrown ends a slap unlock, a shove does not end a slap unlock", () => {
    const { l } = ledger();
    l.unlock("p1", "p3", "slap");
    l.consume("p1", "p3", 3);
    expect(l.unlockedRung("p1", "p3")).toBe(4);
    l.consume("p1", "p3", 4);
    expect(l.unlockedRung("p1", "p3")).toBeUndefined();
    l.unlock("p1", "p3", "shove");
    l.consume("p1", "p3", 3);
    expect(l.unlockedRung("p1", "p3")).toBeUndefined();
  });

  it("a scene cut starts the cast fresh: the unlock and the evidence are gone", () => {
    const { l } = ledger();
    l.note(...at("p3", "p1", "Cofre hoje, senão eu conto pra mesa."));
    l.unlock("p1", "p3", "shove");
    l.clear();
    expect(l.unlockedRung("p1", "p3")).toBeUndefined();
    expect(l.events).toEqual([]);
  });
});

describe("pickEscalation: who the spine opens the ladder for", () => {
  const query = (l: ProvocationLedger, now: number, over: Partial<Parameters<typeof pickEscalation>[0]> = {}) =>
    pickEscalation({ ledger: l, tuning: T.provocation, level: "shove", holders: [], rungOf: () => 0, now, ...over });

  it("no hostile line, no pick: a friendly scene opens nothing", () => {
    const { l, now } = ledger();
    l.note(...at("p3", "p1", "Você pode passar o vinho?"));
    expect(query(l, now())).toBeUndefined();
  });

  it("one charge is a remark, two lines between the pair (one of them a charge or a demand) are a fight: the one the lines were about may hit back, at who said them", () => {
    const { l, advance, now } = ledger();
    l.note(...at("p3", "p1", "Heloísa, cofre hoje, senão eu conto pra mesa."));
    expect(query(l, now())).toBeUndefined();
    advance(20_000);
    l.note(...at("p3", "p1", "A caneta era do Henrique, mas a mão que apertou era sua."));
    expect(query(l, now())).toMatchObject({ observer: "p1", offender: "p3", level: "shove" });
  });

  it("two bets and laughs are not a charge: they never open anything, however many", () => {
    const { l, advance, now } = ledger();
    for (const text of ["Aposto vinte que você perde, kkkk", "Duvido, hahaha", "Quero ver, rsrs"]) {
      l.note(...at("p3", "p1", text));
      advance(10_000);
    }
    expect(query(l, now())).toBeUndefined();
  });

  it("the evidence is the last 90 s: lines older than that are history", () => {
    const { l, advance, now } = ledger();
    l.note(...at("p3", "p1", "Cofre hoje, senão eu conto pra mesa."));
    advance(10_000);
    l.note(...at("p3", "p1", "Você mentiu pra todo mundo."));
    expect(query(l, now())).toBeDefined();
    advance(T.provocation.unlock.windowMs);
    expect(query(l, now())).toBeUndefined();
  });

  it("the slap needs a third line or a shove already thrown by the pair", () => {
    const { l, advance, now } = ledger();
    l.note(...at("p3", "p1", "Cofre hoje, senão eu conto pra mesa."));
    advance(20_000);
    l.note(...at("p3", "p1", "Você mentiu pra todo mundo."));
    expect(query(l, now(), { level: "slap" })).toBeUndefined();
    expect(query(l, now(), { level: "slap", rungOf: (o, s) => (o === "p1" && s === "p3" ? 3 : 0) })).toMatchObject({ observer: "p1", offender: "p3", level: "slap" });
    advance(20_000);
    l.note(...at("p3", "p1", "Foi você que forjou a assinatura."));
    expect(query(l, now(), { level: "slap" })).toMatchObject({ observer: "p1", offender: "p3" });
  });

  it("the holder of the spine is the aggressor when the lines went both ways; without a holder it is the one the last charge was about", () => {
    const { l, advance, now } = ledger();
    l.note(...at("p3", "p1", "Cofre hoje, senão eu conto pra mesa."));
    advance(10_000);
    l.note(...at("p1", "p3", "Você mentiu e falsificou tudo."));
    // p3's charge came first, p1's last: with no holder the last charge's target (p3) is the aggressor; with p1 as the holder it is p1.
    expect(query(l, now())).toMatchObject({ observer: "p3", offender: "p1" });
    expect(query(l, now(), { holders: ["p1"] })).toMatchObject({ observer: "p1", offender: "p3" });
  });

  it("a pair that has thrown the blow is spent, in either direction: 'already', not a miss, and not the blow back for the one who was hit", () => {
    const { l, advance, now } = ledger();
    l.note(...at("p3", "p1", "Cofre hoje, senão eu conto pra mesa."));
    advance(10_000);
    l.note(...at("p1", "p3", "Você mentiu e falsificou tudo."));
    expect(query(l, now(), { rungOf: (o, s) => (o === "p1" && s === "p3" ? 3 : 0) })).toBe("already");
    expect(query(l, now(), { level: "slap", rungOf: (o, s) => (o === "p1" && s === "p3" ? 4 : 0) })).toBe("already");
  });

  it("only pairs the ledger counted (the scenario's may_target pairs of the run's actors): a pair it never counted has no evidence", () => {
    const { l, advance, now } = ledger((o, s) => o === "p1" && s === "p3");
    l.note(...at("p3", "p1", "Cofre hoje, senão eu conto pra mesa."));
    advance(10_000);
    l.note(...at("p3", "p1", "Você mentiu."));
    // The lines were counted for (p1 at p3) only: p3 may not target p1, so that direction is no evidence.
    expect(query(l, now())).toMatchObject({ observer: "p1", offender: "p3" });
    const closed = ledger(() => false);
    closed.l.note(...at("p3", "p1", "Cofre hoje, senão eu conto pra mesa."));
    expect(closed.l.events).toEqual([]);
  });
});
