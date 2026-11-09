import type { ActionEmotions, AgentState, BlockedReason, BodyHandleMap, BodyIntent } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { BodyExecutor } from "../embodiment/body-executor.js";
import { DramaBody } from "../embodiment/drama-body.js";
import type { ActorPool, AgentStateStore } from "../embodiment/drama-body.js";
import type { ActProposal, DramaDecision, DramaDecisionPort, DramaTurn } from "../director/drama/ports.js";
import type { PlanInput } from "../embodiment/types.js";
import type { SidecarMsg } from "../director/index.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import { avatar, snapshot } from "../testing/fixtures.js";
import { feedFrames } from "../testing/drama-feed.js";
import { actFrames, dramaStateFrame, sceneCutFrames } from "../testing/fake-drama.js";
import { agentState, space } from "../testing/fixtures.js";
import { ManualClock } from "../testing/manual-clock.js";
import { seededRng } from "../util/stats.js";

const ZERO_ACT: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};
const T0 = 1_730_000_123_456;

class FakePort implements DramaDecisionPort {
  active = true;
  scene = "7.2";
  turns: DramaTurn[] = [];
  next: DramaDecision = { kind: "pass", why: "no_drive" };
  busy = new Map<number, string>();
  decide(turn: DramaTurn): DramaDecision {
    this.turns.push(turn);
    return this.next;
  }
  feed(): void {}
  advanceScene(): { kind: "sent" } {
    return { kind: "sent" };
  }
  busyActId(actor: number): string | undefined {
    return this.busy.get(actor);
  }
}

function rig(o: { port?: FakePort | undefined; drama?: boolean; ghost?: boolean } = {}) {
  const clock = new ManualClock(50_000);
  const mirror = new HotelSpaceMirror();
  mirror.applySnapshot(snapshot(12, 1, [avatar(-701, "Duda", 4, 4), avatar(-702, "Rafa", 6, 4), avatar(-703, "Gabi", 8, 6), avatar(-704, "Leo", 2, 2), avatar(9, "ana", 7, 5)]), clock.now());
  for (const [ref, id, name] of [["duda", -701, "Duda"], ["rafa", -702, "Rafa"], ["gabi", -703, "Gabi"], ["leo", -704, "Leo"]] as const) mirror.registerActor({ ref, id, run: 7, name }, "12", clock.now());
  const sent: SidecarMsg[] = [];
  const blocked: Array<[string, BlockedReason[]]> = [];
  const pool: string[] = [];
  const poolApi: ActorPool = { defer: (r) => pool.push(`defer:${r}`), admit: (r) => pool.push(`admit:${r}`), retire: (r) => pool.push(`retire:${r}`) };
  const states = new Map<string, AgentState>(["duda", "rafa", "gabi", "leo"].map((r) => [r, agentState()]).map(([r, s]) => [r as string, { ...(s as AgentState), agentId: r as string }]));
  const store: AgentStateStore = { get: async (r) => states.get(r) ?? null, upsert: async (s) => void states.set(s.agentId, s) };
  const port = "port" in o ? o.port : new FakePort();
  let cid = 0;
  let body!: DramaBody;
  const exec = new BodyExecutor({
    run: 7, clock, rng: seededRng(3), mirror, lease: () => 3, nextCid: () => ++cid, send: (m) => (sent.push(m), true),
    isDead: (r) => body.isDead(r), lockOf: (r) => body.ledger.lockOf(r),
    hooks: { blocked: (a, r) => blocked.push([a, r]), arrived: () => undefined, pairAborted: () => undefined, pairOutcome: () => undefined },
  });
  body = new DramaBody({
    run: 7, clock, mirror, executor: exec, ...(port ? { port: () => port } : {}), isOwn: (r) => ["duda", "rafa", "gabi", "leo"].includes(r),
    names: (r) => ({ duda: "Duda", rafa: "Rafa", gabi: "Gabi", leo: "Leo" })[r], lang: "en", pool: poolApi, store, ghostVoice: o.ghost === true,
    hooks: { blocked: (a, r) => blocked.push([a, r]) },
  });
  if (o.drama !== false) {
    body.onSession({ enabled: true, chipTtlMs: 4000, harmMax: 3, harmWindowS: 300, dead: [] });
    feedFrames(body, [dramaStateFrame({ enabled: true })]);
  }
  const input = (over: Partial<PlanInput> = {}, self = "duda"): PlanInput => {
    const view = mirror.view(self, clock.now());
    return { space: view ?? space(), agentState: agentState(), committedEvents: [], now: clock.now(), rng: seededRng(7), actionEmotions: ZERO_ACT, ...over };
  };
  const cmds = () => sent.flatMap((m) => (m.t === "actor_cmd" ? [m.cmd] : []));
  return { clock, mirror, body, port, sent, cmds, blocked, pool, states, input };
}

const handles: BodyHandleMap = { p1: { kind: "person", ref: "rafa" } };
const intent = (b: Partial<BodyIntent>): BodyIntent => ({ order: "move_then_speak", ...b });
const proposalOf = (p: FakePort | undefined, n = 0): ActProposal | undefined => p?.turns[n]?.proposal;

describe("the drama planner behind the director's port (NEG-2, NEG-6)", () => {
  it("[NEG-2] with drama off the planner is exactly today's: no session, or a hotel switch off, never asks the port anything", () => {
    const off = rig({ drama: false });
    const cmds = off.body.planFor("duda", off.input({ bodyIntent: intent({ gesture: { kind: "kiss", toward: "p1" } }), handles }));
    expect(cmds.some((c) => c.cmd === "pair")).toBe(false);
    expect(off.port?.turns).toEqual([]);
    const killed = rig();
    feedFrames(killed.body, [dramaStateFrame({ enabled: false })]);
    killed.body.planFor("duda", killed.input({ bodyIntent: intent({ act: { verb: "glare", target: "p1" } }), handles }));
    expect(killed.port?.turns).toEqual([]);
  });

  it("[NEG-6] in a dialect 2 session a kiss the model asked for is a proposal for the director, never a pair, and the actor holds while it is approved", () => {
    const r = rig();
    r.port!.next = { kind: "approve", actId: "d1", actor: -701, verb: "kiss", with: -702, origin: "model", skippedRungs: [], authoredSkip: false, cid: 5 };
    const cmds = r.body.planFor("duda", r.input({ bodyIntent: intent({ gesture: { kind: "kiss", toward: "p1" } }), handles }));
    expect(proposalOf(r.port)).toEqual({ verb: "kiss", with: -702, origin: "model" });
    expect(cmds).toEqual([]);
  });

  it("[NEG-6] and with the dialect 1 planner the same kiss stays the pair choreography", () => {
    const r = rig({ drama: false });
    const cmds = r.body.planFor("duda", r.input({ agentState: agentState({ rel: { rafa: { attraction: 0.8, comfort: 0.8 } } }), bodyIntent: intent({ gesture: { kind: "kiss", toward: "p1" } }), handles }));
    expect(cmds.some((c) => c.cmd === "pair" && c.kind === "kiss")).toBe(true);
  });

  it("[ACT-1] the model's body act reaches the director with the target as a wire id, the intensity it gave and origin model, whatever verb it is", () => {
    const r = rig();
    r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "slap", target: "p1", intensity: 0.6 } }), handles }));
    expect(proposalOf(r.port)).toEqual({ verb: "slap", with: -702, intensity: 0.6, origin: "model" });
    r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "cry" } }), handles }));
    expect(proposalOf(r.port, 1)).toEqual({ verb: "cry", origin: "model" });
  });

  it("[ACT-7] an act that needs a target the render does not know is never proposed", () => {
    const r = rig();
    r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "slap", target: "p9" } }), handles }));
    expect(r.port?.turns.filter((t) => t.proposal)).toEqual([]);
  });

  it("[GATE-7] a too_far veto walks the actor beside its target and asks again once it is there, not before", () => {
    const r = rig();
    r.port!.next = { kind: "veto", reason: "too_far", detail: "distance", rule: "GATE-7" };
    const first = r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "shove", target: "p1" } }), handles }));
    expect(first.filter((c) => c.cmd === "walk")).toHaveLength(1);
    r.port!.turns.length = 0;
    r.body.planFor("duda", r.input());
    expect(r.port?.turns.filter((t) => t.proposal)).toEqual([]);
    r.mirror.applySnapshot(snapshot(12, 2, [avatar(-701, "Duda", 5, 4), avatar(-702, "Rafa", 6, 4), avatar(-703, "Gabi", 8, 6), avatar(-704, "Leo", 2, 2), avatar(9, "ana", 7, 5)]), r.clock.now());
    r.body.planFor("duda", r.input());
    expect(r.port?.turns.filter((t) => t.proposal).map((t) => t.proposal?.verb)).toEqual(["shove"]);
  });

  it("[GATE-6] any other veto stops there: no walk, no retry, and the planner learns the reason the way it learns a blocked act", () => {
    const r = rig();
    r.port!.next = { kind: "veto", reason: "consent_off", rule: "GATE-6" };
    const cmds = r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "slap", target: "p1" } }), handles }));
    expect(cmds.some((c) => c.cmd === "walk")).toBe(false);
    expect(r.blocked).toEqual([["duda", [{ code: "consent_off", part: "act" }]]]);
  });

  it("[REA-9] an actor the director says is busy plans nothing, and is not asked about anything", () => {
    const r = rig();
    r.port!.busy.set(-701, "d9");
    expect(r.body.planFor("duda", r.input({ bodyIntent: intent({ act: { verb: "glare", target: "p1" } }), handles }))).toEqual([]);
    expect(r.port?.turns).toEqual([]);
  });

  it("[LAD-6] a passive model leaves the director the chance to start a beat from the emotion state: the reading carries the 15 tendencies and the relations by wire id; an initiated beat holds the actor", () => {
    const r = rig();
    r.port!.next = { kind: "initiate", actId: "d2", actor: -701, verb: "glare", with: -702, origin: "director", skippedRungs: [], authoredSkip: false, cid: 6 };
    const cmds = r.body.planFor("duda", r.input({ agentState: agentState({ rel: { rafa: { resentment: 0.7, lastNegativeAt: 12 } } }), actionEmotions: { ...ZERO_ACT, resentfulColdness: 0.8 } }));
    const turn = r.port?.turns[0];
    expect(turn?.actor).toBe(-701);
    expect(turn?.proposal).toBeUndefined();
    expect(turn?.emotion?.actionEmotions.resentfulColdness).toBe(0.8);
    expect(turn?.emotion?.relations?.get(-702)).toMatchObject({ resentment: 0.7, lastNegativeAt: 12 });
    expect(cmds).toEqual([]);
  });

  it("[LAD-6] a pass falls through to the planner's own rules, and a port that is absent proposes nothing", () => {
    const withPort = rig();
    const cmds = withPort.body.planFor("duda", withPort.input({ actionEmotions: { ...ZERO_ACT, vulnerableRetreat: 0.9 } }));
    expect(cmds.some((c) => c.cmd === "act" && c.verb === "cry")).toBe(true);
    const none = rig({ port: undefined });
    expect(() => none.body.planFor("duda", none.input({ bodyIntent: intent({ act: { verb: "glare", target: "p1" } }), handles }))).not.toThrow();
  });
});

describe("death in the engine and the memory (DEATH-2, DEATH-4, DEATH-7, REA-8, MEM-1)", () => {
  const kill = () => actFrames({ actId: "k1", verb: "kill", with: -702, outcome: "landed", at: T0, witnesses: [-703, -704, 9], owed: [{ who: -703, role: "witness" }, { who: -704, role: "witness" }], death: { victim: -702, killer: -701 } });

  it("[DEATH-2] a killed actor leaves the pulses and stays out until its revive; the executor's speaker pool closes with it", async () => {
    const r = rig();
    feedFrames(r.body, kill());
    expect(r.pool).toContain("defer:rafa");
    expect(r.body.isDead("rafa")).toBe(true);
    expect(r.body.planFor("rafa", r.input({ actionEmotions: { ...ZERO_ACT, vulnerableRetreat: 0.9 } }, "rafa"))).toEqual([]);
    feedFrames(r.body, sceneCutFrames({ scene: "7.3", prev: "7.2", revived: [-702] }));
    expect(r.pool.at(-1)).toBe("admit:rafa");
    expect(r.body.isDead("rafa")).toBe(false);
    await r.body.idle();
  });

  it("[DEATH-7] a permadeath actor is retired for good by actor_gone, and an ordinary departure retires nobody", () => {
    const r = rig();
    feedFrames(r.body, kill());
    r.body.actorGone("rafa");
    expect(r.pool).toContain("retire:rafa");
    const other = rig();
    other.body.actorGone("gabi");
    expect(other.pool).toEqual([]);
  });

  it("[DEATH-5] with the ghost voice on the dead actor keeps its place in the pulses (it may think aloud); with it off it does not", () => {
    const ghost = rig({ ghost: true });
    feedFrames(ghost.body, kill());
    expect(ghost.pool).not.toContain("defer:rafa");
  });

  it("[DEATH-4] the death is written for the victim, the killer and every witness of the cast, never for a human, and by what each felt before", async () => {
    const r = rig();
    r.states.set("gabi", { ...agentState({ rel: { rafa: { affection: 0.9, comfort: 0.8 } } }), agentId: "gabi" });
    feedFrames(r.body, kill());
    await r.body.idle();
    const say = (ref: string) => r.states.get(ref)?.memories.map((m) => [m.summary, m.emotionalTone]);
    expect(say("rafa")).toEqual([["Duda killed me.", "grief"]]);
    expect(say("duda")).toEqual([["I killed Rafa.", "hostile"]]);
    expect(say("gabi")).toEqual([["I saw Rafa die at the hands of Duda.", "grief"]]);
    expect(say("leo")).toEqual([["I saw Rafa die at the hands of Duda.", "fear"]]);
    expect(r.states.get("leo")?.relationalStates.get("duda")?.threat).toBeGreaterThanOrEqual(0.2);
  });

  it("[DEATH-7] the memory outlives the revive and a repeated frame writes nothing twice", async () => {
    const r = rig();
    feedFrames(r.body, kill());
    feedFrames(r.body, sceneCutFrames({ scene: "7.3", prev: "7.2", revived: [-702] }));
    feedFrames(r.body, kill());
    await r.body.idle();
    expect(r.states.get("leo")?.memories.filter((m) => m.unresolved)).toHaveLength(1);
    expect(r.states.get("rafa")?.memories.some((m) => m.summary === "Duda killed me.")).toBe(true);
  });

  it("[REA-8] a landed slap is remembered by the aggressor, the victim and the witnesses of the cast, each from its own side; a blocked or aborted act writes nothing", async () => {
    const r = rig();
    feedFrames(r.body, actFrames({ actId: "s1", verb: "slap", with: -702, outcome: "landed", at: T0, witnesses: [-703, 9], owed: [{ who: -703, role: "witness" }] }));
    feedFrames(r.body, actFrames({ actId: "s2", verb: "slap", with: -702, outcome: "blocked", reason: "no_scenario_gate", detail: "free_play", at: T0 }));
    feedFrames(r.body, actFrames({ actId: "s3", verb: "slap", with: -702, outcome: "aborted", reason: "target_moved", at: T0 }));
    await r.body.idle();
    expect(r.states.get("duda")?.memories.map((m) => m.summary)).toEqual(["I slapped Rafa."]);
    expect(r.states.get("rafa")?.memories.map((m) => m.summary)).toEqual(["Duda slapped me."]);
    expect(r.states.get("gabi")?.memories.map((m) => m.summary)).toEqual(["I saw Duda slap Rafa."]);
    expect(r.states.get("leo")?.memories).toEqual([]);
  });

  it("[REA-8] a dodged violent act leaves the aggressor an aggressor and the target nothing", async () => {
    const r = rig();
    feedFrames(r.body, actFrames({ actId: "s1", verb: "punch", with: -702, outcome: "dodged", at: T0 }));
    await r.body.idle();
    expect(r.states.get("duda")?.memories.map((m) => m.summary)).toEqual(["I punched Rafa."]);
    expect(r.states.get("rafa")?.memories).toEqual([]);
  });

  it("[bible 3.3] a witness who loves the victim is moved, once the blow has landed, to step in: the planner gets the rescue and restrains", () => {
    const r = rig();
    feedFrames(r.body, actFrames({ actId: "s1", verb: "slap", with: -703, outcome: "landed", actor: -702, at: T0, witnesses: [-701, -704], owed: [] }));
    const mine = agentState({ rel: { gabi: { affection: 0.9 } } });
    const cmds = r.body.planFor("duda", r.input({ agentState: mine, actionEmotions: { ...ZERO_ACT, repairImpulse: 0.7 } }));
    expect(cmds.some((c) => c.cmd === "act" && c.verb === "restrain" && c.with === "rafa")).toBe(true);
  });
});
