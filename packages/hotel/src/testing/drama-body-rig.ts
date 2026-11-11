import type { ActionEmotions, AgentState, BlockedReason, BodyHandleMap, BodyIntent } from "@perfectman/shared";
import { BodyExecutor } from "../embodiment/body-executor.js";
import { DramaBody } from "../embodiment/drama-body.js";
import type { ActorPool, AgentStateStore } from "../embodiment/drama-body.js";
import type { DramaLog } from "../director/drama/decision-log.js";
import type { ActProposal, DecisionTrace, DramaDecision, DramaDecisionPort, DramaTurn } from "../director/drama/ports.js";
import type { PlanInput } from "../embodiment/types.js";
import type { SidecarMsg } from "../director/index.js";
import { HotelSpaceMirror } from "../space/space-mirror.js";
import { avatar, snapshot } from "./fixtures.js";
import { feedFrames } from "./drama-feed.js";
import { dramaStateFrame } from "./fake-drama.js";
import { agentState, space } from "./fixtures.js";
import { ManualClock } from "./manual-clock.js";
import { seededRng } from "../util/stats.js";

/** The rig of the `DramaBody` tests (`drama-body.test.ts`, `drama-body-follow.test.ts`): four own actors and one human in room 12, a fake director's port, a real executor. */
export const ZERO_ACT: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0,
  vulnerableRetreat: 0, contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0, dominanceAssertion: 0, repairImpulse: 0,
};
export const T0 = 1_730_000_123_456;

export class FakePort implements DramaDecisionPort {
  active = true;
  scene = "7.2";
  turns: DramaTurn[] = [];
  next: DramaDecision = { kind: "pass", why: "no_drive" };
  busy = new Map<number, string>();
  /** What the port says it saw in its last `decide` (the decision log, errata P9); absent: the port says nothing. */
  traced: DecisionTrace | undefined;
  trace(): DecisionTrace | undefined {
    return this.traced;
  }
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

export function rig(o: { port?: FakePort | undefined; log?: DramaLog; drama?: boolean; ghost?: boolean; allow?: (observer: string, offender: string) => boolean; note?: (agentId: string, reasons: BlockedReason[]) => void } = {}) {
  const clock = new ManualClock(50_000);
  const mirror = new HotelSpaceMirror();
  const refresh = (): void => mirror.applySnapshot(snapshot(12, 1, [avatar(-701, "Duda", 4, 4), avatar(-702, "Rafa", 6, 4), avatar(-703, "Gabi", 8, 6), avatar(-704, "Leo", 2, 2), avatar(9, "ana", 7, 5)]), clock.now());
  refresh();
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
    ...(o.allow ? { provocation: { allow: o.allow } } : {}),
    ...(o.note ? { note: o.note } : {}),
    ...(o.log ? { log: () => o.log } : {}),
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
  return { clock, mirror, refresh, body, port, sent, cmds, blocked, pool, states, input };
}

export const handles: BodyHandleMap = { p1: { kind: "person", ref: "rafa" } };
export const intent = (b: Partial<BodyIntent>): BodyIntent => ({ order: "move_then_speak", ...b });
export const proposalOf = (p: FakePort | undefined, n = 0): ActProposal | undefined => p?.turns[n]?.proposal;
