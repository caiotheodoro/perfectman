import type { ActVerb, AgentState, BodyIntent, BlockedReason, Presence } from "@perfectman/shared";
import { ACT_TARGET_MODE } from "@perfectman/shared";
import { rememberAct, rememberDeath } from "@perfectman/engine";
import type { ActFacts, ActLang } from "@perfectman/engine";
import type { Clock } from "../clock/clock.js";
import type { DramaSession } from "../director/dialect.js";
import type { HotelFrame } from "../director/index.js";
import type { DramaFrameSink } from "../run/drama-frame-sink.js";
import { chebyshev } from "../space/geometry.js";
import type { ActorSpace } from "../space/space-mirror.js";
import { ActLedger } from "./act-ledger.js";
import { ReactionScheduler } from "./reaction-scheduler.js";
import type { ActProposal, DramaDecision, DramaDecisionPort, EmotionReading, RelationReading } from "../director/drama/ports.js";
import { plan } from "./plan.js";
import type { BodyExecutor } from "./body-executor.js";
import type { DramaPlanInput, PlanInput, PlannedCommand } from "./types.js";
import { verbMemory } from "./verb-facts.js";
import { pickTile } from "./tiles.js";

type Frame<T extends HotelFrame["t"]> = Extract<HotelFrame, { t: T }>;

/** The runtime's schedule, as far as the dead are concerned: out of the pulses at death, back at the revive, gone for a permadeath (DEATH-2, DEATH-7). */
export interface ActorPool {
  defer(ref: string): void;
  admit(ref: string): void;
  retire(ref: string): void;
}

/** Where the cast's `AgentState` lives (the run's repository); `upsert` replaces a whole state. */
export interface AgentStateStore {
  get(ref: string): Promise<AgentState | null>;
  upsert(state: AgentState): Promise<void>;
}

export type DramaBodyDeps = {
  run: number;
  clock: Clock;
  mirror: ActorSpace;
  executor: Pick<BodyExecutor, "send">;
  /** The drama director's seam (packet P2), read when needed: the run builds its director after the planner side. Absent: the model's `act` has nobody to approve it and nothing is sent. */
  port?: () => DramaDecisionPort | undefined;
  isOwn(ref: string): boolean;
  names(ref: string): string | undefined;
  lang: ActLang;
  pool: ActorPool;
  store?: AgentStateStore;
  /** DEATH-5: a dead actor keeps its place in the pulses and thinks aloud; only ever as a thought, only in cinematic runs (the caller decides). */
  ghostVoice?: boolean;
  hooks: { blocked(agentId: string, reasons: BlockedReason[]): void };
  /** Test seam: where the planner's own act ids start. */
  idPrefix?: string;
};

/** How long a witness remembers a blow in front of it as something to put right (a rescuer's window), and how long a landed embrace is a held picture. */
const RESCUE_MS = 8000;
const STAGED_MS = 4000;
/** A proposal that was `too_far` waits this long for its walk before it is dropped. */
const RETRY_MS = 20_000;
const VIOLENT: ReadonlySet<ActVerb> = new Set<ActVerb>(["insult", "shove", "slap", "punch", "kill"]);
const PHYSICAL_VIOLENT: ReadonlySet<ActVerb> = new Set<ActVerb>(["shove", "slap", "punch"]);

type Latest = { agentState: AgentState; actionEmotions?: PlanInput["actionEmotions"] };

/**
 * Packet P3's integration object, one per run: the `DramaFrameSink` of the planner side (it keeps the `ActLedger` and acts on
 * what the hotel says), and the one place the drama planner is called from. With drama off (no dialect 2 session, or the
 * hotel's switch off) `planFor` is the planner exactly as it was and nothing here touches the wire.
 *
 * What it does: gives the planner the act lock and the room's state; asks the director's port about the model's `act` and
 * the hug and the kiss (NEG-6); schedules the reactions owed to the hotel's debts; takes the dead out of the pulses and
 * brings them back; and writes the memory an act leaves (REA-8, DEATH-4).
 */
export class DramaBody implements DramaFrameSink {
  readonly ledger: ActLedger;
  private readonly reactions: ReactionScheduler;
  private readonly latest = new Map<string, Latest>();
  private readonly beats = new Map<string, { witnesses: string[] }>();
  private readonly rescue = new Map<string, { aggressor: string; victim: string; until: number }>();
  private readonly staged = new Map<string, number>();
  private readonly retry = new Map<string, { proposal: ActProposal; target: string; until: number }>();
  private readonly writes = new Map<string, Promise<void>>();
  private ids = 0;

  constructor(private readonly d: DramaBodyDeps) {
    this.ledger = new ActLedger({
      refOf: (id) => d.mirror.refOfAvatar(id),
      near: (ref, radius) => this.near(ref, radius),
      now: () => d.clock.now(),
      hooks: {
        beat: (f, owed) => {
          this.beats.set(f.act_id, { witnesses: f.witnesses.map((w) => d.mirror.refOfAvatar(w)) });
          this.reactions.onBeat(f, owed);
        },
        done: (f) => this.onDone(f),
        dead: (ref, f) => this.onDead(ref, f),
        revived: (ref) => d.pool.admit(ref),
        sceneCut: () => this.reactions.dispose(),
      },
    });
    this.reactions = new ReactionScheduler({
      clock: d.clock,
      ledger: this.ledger,
      isOwn: (ref) => d.isOwn(ref),
      state: (ref) => this.latest.get(ref),
      presence: (ref) => this.presence(ref),
      nextActId: () => this.nextActId(),
      send: (cmds) => d.executor.send(cmds),
    });
  }

  // ---- the planner ------------------------------------------------------------------------------------------------

  /** True when the drama planner is in charge: a dialect 2 session whose switch is on. */
  get active(): boolean {
    return this.ledger.dramaOn();
  }

  /** The executor's `isDead`, `lockOf` and the run's `ghostVoice`, in one place. */
  isDead(ref: string): boolean {
    return this.ledger.isDead(ref);
  }

  /**
   * Plans one actor's body. Drama off: today's planner, untouched. Drama on: the model's `act` and the hug or kiss it asked for become
   * proposals to the director (it decides and sends); an approved or initiated act holds the actor, a `too_far` veto walks it closer and
   * asks again once; everything else is the planner with the act lock and the emotion model.
   */
  planFor(ref: string, base: PlanInput): PlannedCommand[] {
    if (!this.active) return plan(base);
    // ACT-11, DEATH-2: the dead plan nothing; the hotel would answer actor_dead to all of it.
    if (this.ledger.isDead(ref)) return [];
    this.latest.set(ref, { agentState: base.agentState, ...(base.actionEmotions ? { actionEmotions: base.actionEmotions } : {}) });
    const wire = this.d.mirror.avatarId(ref);
    const port = this.d.port?.();
    const now = this.d.clock.now();
    if (wire !== undefined && port?.active && port.busyActId(wire) !== undefined) return [];
    if (this.ledger.lockOf(ref)) return [];

    // 1. what the model proposed, and what a pair would be.
    const proposals = this.proposalsOf(base);
    const retry = this.retry.get(ref);
    if (retry && retry.until <= now) this.retry.delete(ref);
    const stripped = stripProposals(base.bodyIntent);
    let hold = false;
    const approach: PlannedCommand[] = [];
    if (wire !== undefined && port?.active) {
      const queue = [...proposals];
      const again = this.retry.get(ref);
      if (again && this.adjacent(ref, again.target)) {
        this.retry.delete(ref);
        queue.push(again.proposal);
      }
      for (const proposal of queue) {
        const out = this.decide(ref, wire, proposal, base);
        hold ||= out.hold;
        approach.push(...out.approach);
      }
      // 2. nothing proposed: the emotion state may drive a beat of the director's own.
      if (queue.length === 0 && !hold && base.actionEmotions) hold = this.passive(ref, wire, base, port);
    }
    if (hold) return [];

    const drama = this.dramaInput(ref, port, wire);
    const input: PlanInput = { ...base, drama };
    if (stripped) input.bodyIntent = stripped;
    else delete input.bodyIntent;
    const cmds = plan(input);
    // 3. a pair the planner would have started is a hug or a kiss the director approves (NEG-6).
    const out: PlannedCommand[] = [...approach];
    for (const c of cmds) {
      if (c.cmd !== "pair") {
        out.push(c);
        continue;
      }
      if (wire === undefined || !port?.active) continue;
      const res = this.decide(ref, wire, { verb: c.kind, with: this.d.mirror.avatarId(c.with) as number, origin: "model" }, base);
      out.push(...res.approach);
    }
    return out;
  }

  // ---- DramaFrameSink ----------------------------------------------------------------------------------------------

  onSession(session: DramaSession | null): void {
    this.ledger.onSession(session);
    for (const ref of this.d.mirror.model().agentRoom.keys()) if (this.ledger.isDead(ref) && !this.d.ghostVoice) this.d.pool.defer(ref);
    if (!session) this.reactions.dispose();
  }
  onActStarted(f: Frame<"act_started">): void {
    this.ledger.onActStarted(f);
  }
  onActBeat(f: Frame<"act_beat">): void {
    this.ledger.onActBeat(f);
  }
  onActReaction(f: Frame<"act_reaction">): void {
    this.ledger.onActReaction(f);
  }
  onActDone(f: Frame<"act_done">): void {
    this.ledger.onActDone(f);
    this.reactions.close(f.act_id);
  }
  onDramaConsent(): void {}
  onActorDeath(f: Frame<"actor_death">): void {
    this.ledger.onActorDeath(f);
  }
  onActorRevive(f: Frame<"actor_revive">): void {
    this.ledger.onActorRevive(f);
  }
  onHumanDown(f: Frame<"human_down">): void {
    this.ledger.onHumanDown(f);
  }
  onHumanUp(f: Frame<"human_up">): void {
    this.ledger.onHumanUp(f);
  }
  onSceneCut(f: Frame<"scene_cut">): void {
    this.ledger.onSceneCut(f);
    this.retry.clear();
    this.rescue.clear();
  }
  onDramaState(f: Frame<"drama_state">): void {
    this.ledger.onDramaState(f);
  }

  /** The hotel retired an actor (`actor_gone`, a permadeath above all): it does not come back (DEATH-7). */
  actorGone(ref: string): void {
    const wasDead = this.ledger.isDead(ref);
    this.ledger.onGone(ref);
    if (wasDead) this.d.pool.retire(ref);
  }

  /** An avatar left its room: it owes nothing any more (REA-10). */
  left(ref: string): void {
    this.ledger.onGone(ref, false);
  }

  /** Resolves when every memory write started so far has finished. */
  async idle(): Promise<void> {
    await Promise.all([...this.writes.values()]);
  }

  dispose(): void {
    this.reactions.dispose();
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  private nextActId(): string {
    return `${this.d.idPrefix ?? "p3"}.${(++this.ids).toString(36)}`;
  }

  private presence(ref: string): Presence | undefined {
    const room = this.d.mirror.roomOfRef(ref);
    return this.d.mirror.presenceOf(ref) ?? (room ? this.d.mirror.presenceIn(room, ref) : undefined);
  }

  private near(ref: string, radius: number): string[] {
    const me = this.presence(ref);
    const room = this.d.mirror.roomOfRef(ref);
    if (!me || !room) return [];
    return this.d.mirror.peopleIn(room, this.d.clock.now()).filter((p) => p.ref !== ref && chebyshev(p.tile, me.tile) <= radius).map((p) => p.ref);
  }

  private adjacent(ref: string, other: string): boolean {
    const a = this.presence(ref);
    const b = this.presence(other);
    return a !== undefined && b !== undefined && chebyshev(a.tile, b.tile) <= 1;
  }

  private dramaInput(ref: string, port: DramaDecisionPort | undefined, wire: number | undefined): DramaPlanInput {
    const now = this.d.clock.now();
    const lock = this.ledger.lockOf(ref);
    const busy = wire !== undefined && port?.active ? port.busyActId(wire) : undefined;
    const rescue = this.rescue.get(ref);
    return {
      noReward: this.ledger.noReward(ref),
      fallen: this.ledger.fallenAll(),
      nextActId: () => this.nextActId(),
      ...(lock ? { lock } : {}),
      ...(busy !== undefined ? { busyActId: busy } : {}),
      ...(rescue && rescue.until > now ? { rescue: { aggressor: rescue.aggressor, victim: rescue.victim } } : {}),
      ...((this.staged.get(ref) ?? 0) > now ? { staged: true } : {}),
    };
  }

  /** The model's `act`, and the kiss it asked for as a gesture, as proposals (NEG-6). Targets resolve through the render's handles. */
  private proposalsOf(base: PlanInput): ActProposal[] {
    const b = base.bodyIntent;
    const out: ActProposal[] = [];
    const wireOf = (handle: string | undefined): number | undefined => {
      const t = handle ? base.handles?.[handle] : undefined;
      return t?.kind === "person" ? this.d.mirror.avatarId(t.ref) : undefined;
    };
    if (b?.act) {
      const needs = ACT_TARGET_MODE[b.act.verb] === "required";
      const w = wireOf(b.act.target);
      if (!needs || w !== undefined) out.push({ verb: b.act.verb, ...(needs && w !== undefined ? { with: w } : {}), ...(b.act.intensity !== undefined ? { intensity: b.act.intensity } : {}), origin: "model" });
    }
    if (b?.gesture?.kind === "kiss") {
      const w = wireOf(b.gesture.toward);
      if (w !== undefined) out.push({ verb: "kiss", with: w, origin: "model" });
    }
    return out;
  }

  private emotionOf(base: PlanInput): EmotionReading | undefined {
    if (!base.actionEmotions) return undefined;
    const relations = new Map<number, RelationReading>();
    for (const [other, r] of base.agentState.relationalStates) {
      const id = this.d.mirror.avatarId(other);
      if (id !== undefined) relations.set(id, { resentment: r.resentment, threat: r.threat, envy: r.envy, suspicion: r.suspicion, lastNegativeAt: r.lastNegativeAt });
    }
    const m = base.agentState.coreMood;
    return { actionEmotions: base.actionEmotions, social: base.agentState.socialEmotions, core: { arousal: m.arousal, momentumArousal: m.momentumArousal }, relations, at: this.d.clock.now() };
  }

  private decide(ref: string, wire: number, proposal: ActProposal, base: PlanInput): { hold: boolean; approach: PlannedCommand[] } {
    const port = this.d.port?.();
    if (!port) return { hold: false, approach: [] };
    const emotion = this.emotionOf(base);
    const res: DramaDecision = port.decide({ actor: wire, proposal, ...(emotion ? { emotion } : {}) });
    switch (res.kind) {
      case "approve":
      case "initiate":
        return { hold: true, approach: [] };
      case "veto": {
        if (res.reason === "too_far" && proposal.with !== undefined) return { hold: false, approach: this.walkCloser(ref, proposal, base) };
        this.d.hooks.blocked(ref, [{ code: res.reason, part: "act", ...(res.detail ? { detail: res.detail } : {}) }]);
        return { hold: false, approach: [] };
      }
      case "pass":
      case "unsent":
        return { hold: false, approach: [] };
      default: {
        const unhandled: never = res;
        return unhandled;
      }
    }
  }

  /** GATE-7: a contact verb needs the two beside each other; walk up, then ask again once (the executor's own arrival releases nothing here, the next plan does). */
  private walkCloser(ref: string, proposal: ActProposal, base: PlanInput): PlannedCommand[] {
    const targetRef = proposal.with === undefined ? undefined : this.d.mirror.refOfAvatar(proposal.with);
    const target = targetRef ? this.presence(targetRef) : undefined;
    const space = base.space.room;
    if (!targetRef || !target || !space) return [];
    this.retry.set(ref, { proposal, target: targetRef, until: this.d.clock.now() + RETRY_MS });
    const to = pickTile({ room: space, self: ref, near: target.tile, radius: 1, awayFrom: { tile: target.tile, ideal: 1 }, rng: base.rng });
    return to ? [{ agentId: ref, cmd: "walk", to, plan: `drama:${ref}:${this.d.clock.now().toString(36)}` }] : [];
  }

  /** No proposal: let the director start a beat from the emotion state, if it has one (it keeps its own pace). */
  private passive(ref: string, wire: number, base: PlanInput, port: DramaDecisionPort): boolean {
    const emotion = this.emotionOf(base);
    if (!emotion) return false;
    const res = port.decide({ actor: wire, emotion });
    return res.kind === "initiate";
  }

  // ---- what an act leaves behind -------------------------------------------------------------------------------------

  private onDead(ref: string, f: Frame<"actor_death"> | undefined): void {
    if (this.d.isOwn(ref) && !this.d.ghostVoice) this.d.pool.defer(ref);
    if (!f) return;
    const witnesses = (this.beats.get(f.act_id)?.witnesses ?? []).filter((w) => w !== ref);
    const killer = f.killer != null ? this.d.mirror.refOfAvatar(f.killer) : undefined;
    const facts = { actId: f.act_id, victim: ref, ...(killer ? { killer } : {}), cause: f.cause, witnesses, names: this.nameMap([ref, ...(killer ? [killer] : []), ...witnesses]), lang: this.d.lang } as const;
    const involved = new Set([ref, ...(killer ? [killer] : []), ...witnesses]);
    for (const who of involved) if (this.d.isOwn(who)) this.write(who, (s, now) => rememberDeath(s, facts, now));
  }

  private onDone(f: Frame<"act_done">): void {
    const beat = this.beats.get(f.act_id);
    this.beats.delete(f.act_id);
    if (f.outcome !== "landed" && f.outcome !== "dodged" && f.outcome !== "declined") return;
    const actor = this.d.mirror.refOfAvatar(f.actor);
    const target = f.with != null ? this.d.mirror.refOfAvatar(f.with) : undefined;
    const witnesses = (beat?.witnesses ?? []).filter((w) => w !== actor && w !== target);
    const memory = verbMemory(f.verb);
    const facts: ActFacts = { actId: f.act_id, verb: f.verb, actor, ...(target ? { target } : {}), witnesses, names: this.nameMap([actor, ...(target ? [target] : []), ...witnesses]), lang: this.d.lang };
    if (f.outcome === "landed") {
      if (this.d.isOwn(actor)) this.write(actor, (s, now) => rememberAct(s, facts, "actor", memory.actor, now));
      if (target && this.d.isOwn(target)) this.write(target, (s, now) => rememberAct(s, facts, "target", memory.target, now));
      for (const w of witnesses) if (this.d.isOwn(w)) this.write(w, (s, now) => rememberAct(s, facts, "witness", memory.witnesses, now));
      this.afterLanded(f.verb, actor, target, witnesses);
    } else if (VIOLENT.has(f.verb) && this.d.isOwn(actor)) {
      // REA-8: a dodged or declined violent act leaves the aggressor an aggressor and the target nothing.
      this.write(actor, (s, now) => rememberAct(s, facts, "actor", memory.actor, now));
    }
  }

  /** Who is moved to step in, and who holds a picture, once a blow or an embrace has landed (bible 3.3). */
  private afterLanded(verb: ActVerb, actor: string, target: string | undefined, witnesses: string[]): void {
    const now = this.d.clock.now();
    if (PHYSICAL_VIOLENT.has(verb) && target) for (const w of witnesses) this.rescue.set(w, { aggressor: actor, victim: target, until: now + RESCUE_MS });
    if (verb === "hug" || verb === "kiss" || verb === "restrain") this.staged.set(actor, now + STAGED_MS);
  }

  private nameMap(refs: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of refs) {
      const n = this.d.names(r);
      if (n) out[r] = n;
    }
    return out;
  }

  /** One read-modify-write per actor at a time, so two frames about the same actor never overwrite each other's memory. */
  private write(ref: string, fn: (s: AgentState, now: number) => AgentState): void {
    const store = this.d.store;
    if (!store) return;
    const prev = this.writes.get(ref) ?? Promise.resolve();
    const next = prev.then(async () => {
      const state = await store.get(ref);
      if (!state) return;
      const out = fn(state, Math.max(state.updatedAt, ...state.memories.map((m) => m.lastReinforcedAt)));
      if (out !== state) await store.upsert(out);
    }).catch(() => undefined);
    this.writes.set(ref, next);
  }
}

/** The body block without the parts the director now owns: the `act`, and a kiss gesture (a hug or kiss is an act, NEG-6). */
function stripProposals(b: BodyIntent | undefined): BodyIntent | undefined {
  if (!b) return undefined;
  const rest = { ...b };
  delete rest.act;
  if (rest.gesture?.kind === "kiss") delete rest.gesture;
  return rest;
}
