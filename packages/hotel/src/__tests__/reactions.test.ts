import type { ActionEmotions, ActVerb, Presence } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { ActLedger } from "../embodiment/act-ledger.js";
import type { OwedDebt } from "../embodiment/act-ledger.js";
import { chooseReaction, isReplaceable } from "../embodiment/reactions.js";
import { ReactionScheduler } from "../embodiment/reaction-scheduler.js";
import type { PlannedCommand } from "../embodiment/types.js";
import { feedFrames } from "../testing/drama-feed.js";
import { actFrames } from "../testing/fake-drama.js";
import { agentState, person } from "../testing/fixtures.js";
import { ManualClock } from "../testing/manual-clock.js";

const REFS: Record<number, string> = { [-701]: "duda", [-702]: "rafa", [-703]: "gabi", [-704]: "leo", [-705]: "bia", [-706]: "caro", 9: "h:9" };
const ZERO_ACT: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};
const TILES: Record<string, [number, number]> = { duda: [3, 3], rafa: [4, 3], gabi: [6, 4], leo: [3, 6], bia: [8, 8], caro: [2, 7] };
const present = (ref: string): Presence | undefined => (TILES[ref] ? person(ref, TILES[ref]) : undefined);

const debt = (over: Partial<OwedDebt> = {}): OwedDebt => ({ actId: "a1", verb: "slap", who: "gabi", role: "witness", actor: "duda", target: "rafa", dueInMs: 3000, receivedAt: 1000, at: 5000, ...over });
const choose = (d: OwedDebt, rel: Parameters<typeof agentState>[0] = {}, ae: Partial<ActionEmotions> = {}) => {
  let n = 0;
  return chooseReaction({ debt: d, state: agentState(rel), actionEmotions: { ...ZERO_ACT, ...ae }, presence: present, nextActId: () => `pb${++n}` });
};
const verbOf = (r: ReturnType<typeof choose>): string => (r?.cmd.cmd === "act" ? r.cmd.verb : (r?.cmd.cmd ?? "none"));

describe("reactions the planner may give in place of the table's (REA-3)", () => {
  it("[REA-3] only a replaceable label can be replaced: a witness's, and a glare's or insult's target; never the target of a slap, a punch, a kill, a hug or a restrain", () => {
    const verbs: ActVerb[] = ["glare", "insult", "shove", "slap", "punch", "kill", "hug", "kiss", "restrain"];
    const targets = verbs.filter((v) => isReplaceable(v, "target"));
    expect(targets).toEqual(["glare", "insult"]);
    expect(verbs.every((v) => isReplaceable(v, "witness"))).toBe(true);
    expect(choose(debt({ verb: "punch", role: "target", who: "rafa", actor: "duda", target: "rafa" }))).toBeUndefined();
  });

  it("[REA-3] a witness with no stake does what the table would have: it freezes and gasps", () => {
    const r = choose(debt({ who: "bia" }));
    expect(r?.cmd).toMatchObject({ cmd: "act", actId: "pb1", verb: "freeze_gasp", origin: "director" });
  });

  it("[REA-3] by its own feelings a witness reacts its own way: afraid of the aggressor it recoils, a friend of a dead victim cries, a contemptuous one looks on and smiles", () => {
    expect(verbOf(choose(debt(), { rel: { duda: { threat: 0.9 } } }, { defensiveness: 0.8 }))).toBe("recoil");
    const grief = choose(debt({ verb: "kill" }), { rel: { rafa: { affection: 0.9, comfort: 0.8 } } }, { vulnerableRetreat: 0.8 });
    expect(verbOf(grief)).toBe("cry");
    const sneer = choose(debt(), { social: { contempt: 0.9 } });
    expect(sneer?.cmd).toMatchObject({ cmd: "face" });
  });

  it("[REA-3] the target of a glare gives back what it feels: it steps back when afraid, stands its ground angry when resentful", () => {
    const d = debt({ verb: "glare", role: "target", who: "rafa", actor: "duda", target: "rafa", dueInMs: 1500 });
    expect(verbOf(choose(d, { rel: { duda: { threat: 0.9 } } }, { defensiveness: 0.9 }))).toBe("recoil");
    const ground = choose(d, { rel: { duda: { resentment: 0.9 } }, social: { resentment: 0.9 } });
    expect(ground?.cmd).toMatchObject({ cmd: "expression", face: "angry" });
  });

  it("[REA-3] a person it has never dealt with draws a plain look, not a performance", () => {
    expect(choose(debt({ verb: "insult", who: "bia" }))?.cmd).toMatchObject({ cmd: "face" });
  });

  it("[REA-4] six witnesses who feel exactly the same still do not react in unison: the seeded variety changes what or when", () => {
    const seen = new Set<string>();
    for (const who of ["gabi", "leo", "bia", "caro", "rafa", "duda"]) {
      const r = choose(debt({ who }));
      seen.add(`${verbOf(r)}@${r?.delayMs}`);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(choose(debt({ who: "gabi" }))).toEqual(choose(debt({ who: "gabi" })));
  });

  it("[REA-1] a planner reaction goes out before the table's earliest witness step and well inside the deadline", () => {
    for (const who of ["gabi", "leo", "bia", "caro"]) {
      const w = choose(debt({ who }));
      expect(w?.delayMs).toBeGreaterThanOrEqual(150);
      expect(w?.delayMs).toBeLessThan(600);
    }
    const t = choose(debt({ verb: "insult", role: "target", who: "rafa", actor: "duda", dueInMs: 1500 }));
    expect(t?.delayMs).toBeLessThan(500);
  });
});

function rig(own: string[] = ["duda", "rafa", "gabi", "leo", "bia", "caro"], rels: Record<string, Parameters<typeof agentState>[0]> = {}) {
  const clock = new ManualClock(50_000);
  const sent: Array<{ at: number; cmd: PlannedCommand }> = [];
  const ledger = new ActLedger({ refOf: (id) => REFS[id] ?? `h:${id}`, near: () => [], now: () => clock.now(), hooks: { beat: (f, owed) => sched.onBeat(f, owed) } });
  let n = 0;
  const sched = new ReactionScheduler({
    clock, ledger, isOwn: (ref) => own.includes(ref),
    state: (ref) => ({ agentState: agentState(rels[ref] ?? {}), actionEmotions: ZERO_ACT }),
    presence: present,
    nextActId: () => `pr${++n}`,
    send: (cmds) => cmds.forEach((cmd) => sent.push({ at: clock.now(), cmd })),
  });
  return { clock, ledger, sent, feed: (f: Parameters<typeof feedFrames>[1]) => feedFrames(ledger, f) };
}

const slap = (extra: Partial<Parameters<typeof actFrames>[0]> = {}) =>
  actFrames({ actId: "a1", verb: "slap", with: -702, outcome: "landed", at: 9000, witnesses: [-703, -704], owed: [{ who: -702, role: "target" }, { who: -703, role: "witness" }, { who: -704, role: "witness" }], ...extra });

describe("the reaction scheduler: obligations from act_beat.owed only (REA-1, REA-2, REA-10)", () => {
  it("[REA-1] answers every witness debt of an own actor inside the 3000 ms window, tagged as an answer to a debt so the executor never starves it", async () => {
    const { clock, sent, feed } = rig();
    feed(slap().slice(0, 2));
    await clock.advance(2999);
    const mine = sent.filter((s) => s.cmd.agentId === "gabi" || s.cmd.agentId === "leo");
    expect(mine.map((s) => s.cmd.agentId).sort()).toEqual(["gabi", "leo"]);
    expect(mine.every((s) => s.cmd.owed === true && s.at - 50_000 < 600)).toBe(true);
  });

  it("[REA-3] does not touch the target of a slap: the table's head_snap is not replaceable", async () => {
    const { clock, sent, feed } = rig();
    feed(slap().slice(0, 2));
    await clock.advance(3000);
    expect(sent.some((s) => s.cmd.agentId === "rafa")).toBe(false);
  });

  it("[REA-2] a human target owes nothing, so nothing is sent, and a debt is never inferred from the verb or the witness list", async () => {
    const { clock, sent, feed } = rig();
    feed(actFrames({ actId: "a2", verb: "slap", with: 9, outcome: "landed", chip: true, answer: "take", at: 9000, witnesses: [-703, 9], owed: [] }).slice(0, 4));
    await clock.advance(5000);
    expect(sent).toEqual([]);
  });

  it("[REA-2] only the run's own actors are answered for: a debt of an actor another run owns is none of this planner's", async () => {
    const { clock, sent, feed } = rig(["gabi"]);
    feed(slap().slice(0, 2));
    await clock.advance(3000);
    expect(sent.map((s) => s.cmd.agentId)).toEqual(["gabi"]);
  });

  it("[REA-3] a table reaction that gets there first settles the debt: no second command follows it", async () => {
    const { clock, sent, feed } = rig();
    const frames = slap({ reactions: [{ who: -703, role: "witness", reaction: "freeze_gasp" }] });
    feed(frames.slice(0, 3));
    await clock.advance(3000);
    expect(sent.some((s) => s.cmd.agentId === "gabi")).toBe(false);
    expect(sent.some((s) => s.cmd.agentId === "leo")).toBe(true);
  });

  it("[REA-10] a witness that died or left before its turn is dropped: the planner stops waiting on it", async () => {
    const { clock, sent, feed, ledger } = rig();
    feed(slap().slice(0, 2));
    ledger.onGone("gabi");
    await clock.advance(3000);
    expect(sent.some((s) => s.cmd.agentId === "gabi")).toBe(false);
    expect(sent.some((s) => s.cmd.agentId === "leo")).toBe(true);
  });

  it("[REA-9] a scene cut or an act_done ends the wait: the timers of a closed act fire nothing", async () => {
    const { clock, sent, feed } = rig();
    const frames = slap();
    feed(frames.slice(0, 2));
    feed(frames.slice(-1));
    await clock.advance(3000);
    expect(sent).toEqual([]);
  });

  it("[REA-3] role variety from the relationships: the friend of the victim and the one who fears the aggressor do not do the same thing", async () => {
    const { clock, sent, feed } = rig(undefined, { gabi: { rel: { duda: { threat: 0.9 } } }, leo: { rel: { rafa: { affection: 0.9, comfort: 0.9 } } } });
    feed(slap().slice(0, 2));
    await clock.advance(3000);
    const verbBy = new Map(sent.flatMap((x) => (x.cmd.cmd === "act" ? [[x.cmd.agentId, x.cmd.verb] as const] : [])));
    expect(verbBy.get("gabi")).toBe("recoil");
    expect(verbBy.get("leo")).toBe("freeze_gasp");
  });
});
