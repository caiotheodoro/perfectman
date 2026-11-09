import type { ActVerb } from "@perfectman/shared";
import type { DramaSession } from "../director/dialect.js";
import type { HotelFrame } from "../director/index.js";
import type { DramaFrameSink } from "../run/drama-frame-sink.js";
import { CONTACT_VERBS, HOLDS_THE_ROOM } from "./verb-facts.js";
import { NO_REWARD_MS, REACTION_STEP_MS, TABLEAU_RADIUS_TILES } from "./constants.js";

type Frame<T extends HotelFrame["t"]> = Extract<HotelFrame, { t: T }>;

export type LockWhy = "initiator" | "target" | "owed" | "held";

/** Why an actor's body commands are held (REA-9, TGT-1, TBL-11): the act that holds it and in which role. */
export type ActLock = { actId: string; why: LockWhy };

/** What one actor owes: the hotel's own `act_beat.owed` row, with the clock the planner counts the deadline on. */
export type OwedDebt = {
  actId: string;
  verb: ActVerb;
  who: string;
  role: "target" | "witness";
  actor: string;
  target?: string;
  /** `due_at - at` of the frame: the window the hotel gives, so the clocks of the two sides never have to agree. */
  dueInMs: number;
  /** The sidecar's clock when `act_beat` arrived. */
  receivedAt: number;
  /** The hotel's `Tc`. */
  at: number;
};

export type FallenKind = "dead" | "fainted" | "down";

export type LedgerHooks = {
  started?(frame: Frame<"act_started">): void;
  beat?(frame: Frame<"act_beat">, owed: readonly OwedDebt[]): void;
  reaction?(frame: Frame<"act_reaction">): void;
  done?(frame: Frame<"act_done">): void;
  /** A blocked act: one `act_done` with no `act_started` (FRM-2). */
  blocked?(frame: Frame<"act_done">): void;
  /** A debt still open when the hotel closed the act (`owed_missed`, REA-10). */
  missed?(who: string, actId: string, role: string): void;
  dead?(ref: string, frame: Frame<"actor_death"> | undefined): void;
  revived?(ref: string): void;
  down?(ref: string, frame: Frame<"human_down">): void;
  up?(ref: string): void;
  sceneCut?(frame: Frame<"scene_cut">): void;
};

export type LedgerDeps = {
  /** Wire id to the run's ref (`h:<id>` for people). */
  refOf(id: number): string;
  /** Refs of every avatar standing within `radius` tiles (Chebyshev) of `ref`, humans included. */
  near(ref: string, radius: number): readonly string[];
  now(): number;
  hooks?: LedgerHooks;
};

type Open = {
  frame: Frame<"act_started">;
  actor: string;
  target?: string;
  owed: Map<string, OwedDebt>;
  held: Set<string>;
  /** Reactors whose debt was settled, and until when their own reaction step runs (REA-9): after that they are free, whatever the act goes on to do. */
  reacted: Map<string, number>;
  /** An avatar this act put on the floor and that gets up with it (a fainted actor). */
  fainter?: string;
};

const isHuman = (ref: string): boolean => ref.startsWith("h:");

/**
 * The sidecar's picture of the acts the hotel is running (act-contract.md FRM-1, REA-9, REA-10), built from the hotel's
 * own frames and nothing else: which actors the planner must hold, what each owes and until when, who is dead or on the
 * floor, and whether drama is on. It implements `DramaFrameSink`, so the manager's router feeds it; the planner, the
 * reaction scheduler and the speaker pool read it. It never sends anything and never guesses a debt (REA-10).
 */
export class ActLedger implements DramaFrameSink {
  private session: DramaSession | null = null;
  private enabled = false;
  private readonly calmRooms = new Map<number, boolean>();
  private lastCalm = false;
  private sceneId = "";
  private readonly open = new Map<string, Open>();
  private readonly dead = new Set<string>();
  private readonly gone = new Set<string>();
  private readonly fallen = new Map<string, FallenKind>();
  private readonly noRewardUntil = new Map<string, number>();

  constructor(private readonly deps: LedgerDeps) {}

  // ---- reads ------------------------------------------------------------------------------

  /** Drama is on for the planner: a dialect 2 session whose runtime switch is on (SAFE-2). */
  dramaOn(): boolean {
    return this.session !== null && this.enabled;
  }

  calm(room?: number): boolean {
    return room === undefined ? this.lastCalm : (this.calmRooms.get(room) ?? false);
  }

  scene(): string {
    return this.sceneId;
  }

  /** The act that holds this actor's body commands and why; the initiator before the target before a reactor before a held bystander. */
  lockOf(ref: string): ActLock | undefined {
    let best: ActLock | undefined;
    const rank: Record<LockWhy, number> = { initiator: 0, target: 1, owed: 2, held: 3 };
    for (const [actId, o] of this.open) {
      const why: LockWhy | undefined =
        o.actor === ref ? "initiator" : o.target === ref && this.locksTarget(o) ? "target" : o.owed.has(ref) || this.reacting(o, ref) ? "owed" : o.held.has(ref) ? "held" : undefined;
      if (why && (!best || rank[why] < rank[best.why])) best = { actId, why };
    }
    return best;
  }

  /** The reactor's own table step is still running (REA-9). */
  private reacting(o: Open, ref: string): boolean {
    const until = o.reacted.get(ref);
    return until !== undefined && this.deps.now() < until;
  }

  /** What `ref` owes right now: the open rows of `act_beat.owed` for it, oldest first. */
  owedOf(ref: string): OwedDebt[] {
    const out: OwedDebt[] = [];
    for (const o of this.open.values()) {
      const d = o.owed.get(ref);
      if (d) out.push(d);
    }
    return out.sort((a, b) => a.receivedAt - b.receivedAt);
  }

  /** The killer is locked from the celebration gestures for `no_reward_ms` from contact (LAD-8). */
  noReward(ref: string): boolean {
    const until = this.noRewardUntil.get(ref);
    return until !== undefined && this.deps.now() < until;
  }

  isDead(ref: string): boolean {
    return this.dead.has(ref) && !this.gone.has(ref);
  }

  /** The hotel retired this actor for the run (`actor_gone`): it does not come back, whatever the scene does. */
  isGone(ref: string): boolean {
    return this.gone.has(ref);
  }

  fallenKind(ref: string): FallenKind | undefined {
    return this.fallen.get(ref);
  }

  /** Every avatar on the floor, for the planner's `tend_fallen` and for perception of bodies. */
  fallenAll(): ReadonlyMap<string, FallenKind> {
    return this.fallen;
  }

  /** Acts the hotel has open, for the planner: who started it, who it is aimed at, and its state. */
  openActs(): ReadonlyArray<{ actId: string; verb: ActVerb; actor: string; target?: string; contact: boolean }> {
    return [...this.open].map(([actId, o]) => ({ actId, verb: o.frame.verb, actor: o.actor, ...(o.target ? { target: o.target } : {}), contact: o.owed.size > 0 || o.held.size > 0 }));
  }

  // ---- the manager's own signals ------------------------------------------------------------

  /** An avatar left the room or was retired: it owes nothing any more and nothing holds it (REA-10); `retired` also keeps it from coming back. */
  onGone(ref: string, retired = true): void {
    for (const o of this.open.values()) {
      o.owed.delete(ref);
      o.held.delete(ref);
      o.reacted.delete(ref);
    }
    this.fallen.delete(ref);
    if (retired) this.gone.add(ref);
  }

  // ---- DramaFrameSink -----------------------------------------------------------------------

  onSession(session: DramaSession | null): void {
    this.session = session;
    this.dead.clear();
    if (!session) {
      this.enabled = false;
      this.open.clear();
      this.fallen.clear();
      this.noRewardUntil.clear();
      return;
    }
    this.enabled = session.enabled;
    // NEG-8: a full replacement set, not a delta.
    for (const id of session.dead) this.dead.add(this.deps.refOf(id));
    for (const ref of [...this.fallen.keys()]) if (this.fallen.get(ref) === "dead" && !this.dead.has(ref)) this.fallen.delete(ref);
    for (const ref of this.dead) this.fallen.set(ref, "dead");
  }

  onActStarted(f: Frame<"act_started">): void {
    const o: Open = { frame: f, actor: this.deps.refOf(f.actor), owed: new Map(), held: new Set(), reacted: new Map() };
    if (f.with != null) o.target = this.deps.refOf(f.with);
    this.open.set(f.act_id, o);
    if (f.verb === "tableau") this.hold(o);
    this.deps.hooks?.started?.(f);
  }

  onActBeat(f: Frame<"act_beat">): void {
    const o = this.open.get(f.act_id);
    if (!o) return;
    const owed: OwedDebt[] = [];
    for (const row of f.owed) {
      const who = this.deps.refOf(row.who);
      const debt: OwedDebt = {
        actId: f.act_id, verb: o.frame.verb, who, role: row.role === "target" ? "target" : "witness", actor: o.actor, ...(o.target ? { target: o.target } : {}),
        dueInMs: row.due_at - f.at, receivedAt: this.deps.now(), at: f.at,
      };
      o.owed.set(who, debt);
      owed.push(debt);
    }
    if (HOLDS_THE_ROOM.has(o.frame.verb)) this.hold(o);
    if (o.frame.verb === "kill") this.noRewardUntil.set(o.actor, this.deps.now() + NO_REWARD_MS);
    if (o.frame.verb === "faint") {
      o.fainter = o.actor;
      this.fallen.set(o.actor, "fainted");
    }
    this.deps.hooks?.beat?.(f, owed);
  }

  onActReaction(f: Frame<"act_reaction">): void {
    const o = this.open.get(f.act_id);
    const who = this.deps.refOf(f.who);
    // The table's reaction is a step that runs on; the planner's own command skips the step (REA-3), so nothing of it is left to wait for.
    if (o?.owed.delete(who)) o.reacted.set(who, this.deps.now() + (f.source === "table" ? REACTION_STEP_MS : 0));
    this.deps.hooks?.reaction?.(f);
  }

  onActDone(f: Frame<"act_done">): void {
    const o = this.open.get(f.act_id);
    if (!o) {
      this.deps.hooks?.blocked?.(f);
      return;
    }
    for (const m of f.owed_missed) this.deps.hooks?.missed?.(this.deps.refOf(m.who), f.act_id, m.role);
    this.open.delete(f.act_id);
    if (o.fainter && this.fallen.get(o.fainter) === "fainted") this.fallen.delete(o.fainter);
    this.deps.hooks?.done?.(f);
  }

  onDramaConsent(): void {}

  onActorDeath(f: Frame<"actor_death">): void {
    const ref = this.deps.refOf(f.actor);
    this.dead.add(ref);
    this.fallen.set(ref, "dead");
    for (const o of this.open.values()) {
      o.owed.delete(ref);
      o.reacted.delete(ref);
      o.held.delete(ref);
    }
    this.deps.hooks?.dead?.(ref, f);
  }

  onActorRevive(f: Frame<"actor_revive">): void {
    const ref = this.deps.refOf(f.actor);
    if (!this.dead.delete(ref)) return;
    if (this.fallen.get(ref) === "dead") this.fallen.delete(ref);
    this.deps.hooks?.revived?.(ref);
  }

  onHumanDown(f: Frame<"human_down">): void {
    const ref = this.deps.refOf(f.human);
    this.fallen.set(ref, "down");
    this.deps.hooks?.down?.(ref, f);
  }

  onHumanUp(f: Frame<"human_up">): void {
    const ref = this.deps.refOf(f.human);
    if (this.fallen.get(ref) === "down") this.fallen.delete(ref);
    this.deps.hooks?.up?.(ref);
  }

  onSceneCut(f: Frame<"scene_cut">): void {
    // The acts in flight end with the cut (SCENE-3); their own act_done frames follow, and find nothing open.
    this.open.clear();
    this.sceneId = f.scene;
    this.noRewardUntil.clear();
    for (const [ref, kind] of [...this.fallen]) if (kind === "fainted") this.fallen.delete(ref);
    this.deps.hooks?.sceneCut?.(f);
  }

  onDramaState(f: Frame<"drama_state">): void {
    this.enabled = f.enabled;
    this.calmRooms.set(f.room, f.calm);
    this.lastCalm = f.calm;
    this.sceneId = f.scene;
  }

  // ---- internals ----------------------------------------------------------------------------

  /** TGT-1: a contact verb locks an actor target for the whole act; a human is never locked. */
  private locksTarget(o: Open): boolean {
    return CONTACT_VERBS.has(o.frame.verb) && o.target !== undefined && !isHuman(o.target);
  }

  /** TBL-11: everyone in reach of the actor that is standing, alive and not a human holds until act_done. */
  private hold(o: Open): void {
    for (const ref of this.deps.near(o.actor, TABLEAU_RADIUS_TILES)) {
      if (ref === o.actor || ref === o.target || isHuman(ref) || this.dead.has(ref) || this.fallen.has(ref)) continue;
      if (!o.owed.has(ref)) o.held.add(ref);
    }
  }
}
