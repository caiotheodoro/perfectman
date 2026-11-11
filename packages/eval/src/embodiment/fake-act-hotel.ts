import { impactClassOf, ladderRung } from "@perfectman/shared";
import type { ActOrigin, ActVerb, AvatarState, Tile } from "@perfectman/shared";
import { VOCAB_CONSTANTS, verbTable } from "@perfectman/hotel/drama";
import type { ScenarioDrama, VerbEntry } from "@perfectman/hotel/drama";

/**
 * Deterministic stand-in for the hotel's act sequencer (docs/drama/act-contract.md sections 2 to 8), the half of the fake grid
 * hotel that plays `act`. A command goes in; the lifecycle frames of section 3 come out, in the order of FRM-1, on the clock the
 * caller drives: `act_started`, the consent chip of a human target, `act_beat` with its witnesses and what is owed, the
 * reactions, a death or a human going down, `act_done`; a blocked command is one `act_done` and nothing else (FRM-2). Gates are
 * GATE-1 to GATE-10 in order and the reservations RSV-1, the scene is SCENE-1 to SCENE-5, death is DEATH-1 to DEATH-7, the
 * down state is DOWN-1 to DOWN-4. The numbers come from the vendored verb table, which the hotel publishes; frame shapes are
 * pinned against the hotel's own recorded lifecycles (`fake-act-hotel.test.ts`). It decides nothing the real hotel would not,
 * and a human's answer to a chip is a policy the caller supplies.
 */

export type ChipAnswer = "take" | "dodge" | "push_back" | "timeout";

/** One hotel-to-sidecar frame, without `seq` (the log wrapper adds it). `at` is the hotel's epoch ms. */
export type ActFrame = { t: string; at?: number } & Record<string, unknown>;

/** The wire `act` command of act-contract.md 2.1, as the Director client sends it. */
export type ActWire = { act_id: string; verb: ActVerb; with?: number | null; intensity?: number | null; origin?: ActOrigin | null; authored_skip?: boolean | null; text?: string | null };

export type WorldAvatar = { id: number; ref: string; human: boolean; tile: Tile; state: AvatarState };

/** What the sequencer reads of the room and writes back: where everyone is, and who is on the floor. */
export interface ActWorld {
  avatars(): WorldAvatar[];
  /** The avatar is lying, fainted or down (the view marks them for perception of bodies). `undefined` stands them up. */
  markFallen(id: number, kind: "dead" | "fainted" | "down" | undefined): void;
}

export type ChipQuestion = { actId: string; verb: ActVerb; actor: number; human: number; family: "violent" | "affection" };

export type FakeActOptions = {
  run: number;
  room: number;
  now: () => number;
  emit: (frame: ActFrame) => void;
  world: ActWorld;
  /** The scenario's `drama` block (refs are the actors' refs); absent is free play (SCN-1). */
  drama?: ScenarioDrama;
  /** A human's answer to a chip. Default: `take` an embrace, `dodge` anything violent. */
  humanAnswer?: (q: ChipQuestion) => ChipAnswer;
  /** How long a human takes to answer, ms (a number, or per chip). Default 400. */
  answerDelayMs?: number | ((q: ChipQuestion) => number);
  humanDownMs?: number;
  /** Humans whose drama opt-in is on. */
  optIn?: readonly number[];
  /** The scene lets a human be the target of an act without the consent chip (`may_target_humans`): a human who did not opt in is struck, or not, with no question asked. Default: the chip (GATE-6). */
  chiplessHumans?: boolean;
  harmMax?: number;
  harmWindowMs?: number;
  pauseMs?: number;
};

type Gate = { reason: string; detail?: string };
type Open = {
  id: string;
  verb: ActVerb;
  actor: number;
  target: number | undefined;
  intensity: number;
  origin: ActOrigin;
  entry: VerbEntry;
  scene: string;
  t0: number;
  tc?: number;
  chip: boolean;
  human: boolean;
  /** The ids of every step scheduled for this act, so an abort can drop what has not happened. */
  steps: Set<number>;
  reactors: Map<number, { due: number; label: string; replaceable: boolean; done: boolean }>;
  harm: boolean;
  doneAt?: number;
  /** The chip answer, once given: `act_done` carries it from then on, aborted or not. */
  answer?: ChipAnswer;
};

const K = VOCAB_CONSTANTS;
const REPLACEABLE = new Set(["look_back", "watch", "freeze_gasp", "surprised"]);
/** REA-3: the commands that count as a reaction. */
const QUALIFYING = new Set(["face", "expression", "action", "sit", "walk", "move_room", "appearance", "act"]);
const FALL_MS = 2000;
const BODY_HOLD_MS = 3000;
const FAINT_END_MS = 7600;
/** A dodged, declined or timed-out chip ends this long after the answer. */
const CHIP_END_MS = 1000;
const NARRATOR_OF = (run: number): number => -(run * 100);

const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class FakeActHotel {
  private readonly table = verbTable().verbs;
  private seq = 0;
  private readonly queue: Array<{ at: number; seq: number; id: number; run: () => void }> = [];
  private readonly acts = new Map<string, Open>();
  private readonly consumed = new Set<string>();
  private scene = 1;
  private sceneSince: number;
  private enabled = true;
  private calm = false;
  private paused = false;
  private pausedUntil = 0;
  private readonly optIn: Set<number>;
  /** rung_cur per `actor>target` pair, this scene (LAD-1). */
  private readonly rung = new Map<string, number>();
  private lastPhysical: number | undefined;
  private kills = 0;
  private readonly cooldown = new Map<string, number>();
  private readonly chipCooldown = new Map<number, number>();
  private readonly chipOpen = new Set<number>();
  /** Landed or reserved violent acts on humans, with the time they were reserved. */
  private readonly harm: Array<{ actId: string; at: number; landed: boolean }> = [];
  private readonly dead = new Map<number, { at: number; actId: string; scene: string }>();
  private readonly fainted = new Set<number>();
  private readonly down = new Set<number>();
  /** Each actor's lock: the open act that holds its body commands (REA-9, TGT-1). */
  private readonly locks = new Map<number, { actId: string; until: number | "done" }>();
  private readonly gone = new Set<number>();
  private stepId = 0;
  /** The instant being played: a step's own time while `advanceTo` runs it, else the caller's time. Every frame is stamped with it. */
  private clock: number;
  readonly stats = { started: 0, blocked: 0, aborted: 0, done: 0 };

  constructor(private readonly o: FakeActOptions) {
    this.clock = o.now();
    this.sceneSince = o.now();
    this.optIn = new Set(o.optIn ?? []);
  }

  /** A caller (the sim, a test) is acting at the grid's time: the sequencer's own instant never runs backwards. */
  private sync(): number {
    this.clock = Math.max(this.clock, this.o.now());
    return this.clock;
  }

  // ---- state a test or the sim switches ------------------------------------------------------------------

  /** The first `drama_state` of the room (3.10); call once the run is up. */
  announce(): void {
    this.sync();
    this.emitState();
  }

  setCalm(on: boolean): void {
    this.sync();
    if (this.calm === on) return;
    this.calm = on;
    this.emitState();
    if (on) this.abortOpen((a) => a.entry.gates.calm_blocks, "calm_room");
  }

  setEnabled(on: boolean): void {
    this.sync();
    if (this.enabled === on) return;
    this.enabled = on;
    this.emitState();
    if (!on) this.abortOpen(() => true, "kill_switch");
  }

  setOptIn(human: number, on: boolean): void {
    this.sync();
    if (on) this.optIn.add(human);
    else this.optIn.delete(human);
    this.emitState();
    if (!on) this.abortOpen((a) => a.target === human && a.entry.gates.consent !== null && a.entry.gates.consent.startsWith("violent"), "opt_out");
  }

  get sceneId(): string {
    return `${this.o.run}.${this.scene}`;
  }

  isFallen(id: number): boolean {
    return this.dead.has(id) || this.fainted.has(id) || this.down.has(id);
  }

  /** Avatars gone from the room (left, or retired): they owe nothing any more (REA-10). */
  remove(id: number): void {
    this.gone.add(id);
    for (const a of this.acts.values()) a.reactors.delete(id);
  }

  // ---- the clock -------------------------------------------------------------------------------------------

  /** Runs every step due at or before `to`, in time order. Frames carry the step's own instant. */
  advanceTo(to: number): void {
    for (;;) {
      const next = this.queue.filter((q) => q.at <= to).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) break;
      this.queue.splice(this.queue.indexOf(next), 1);
      this.clock = Math.max(this.clock, next.at);
      next.run();
    }
    this.clock = Math.max(this.clock, to);
  }

  private at(ms: number, fn: () => void, act?: Open): number {
    const id = ++this.stepId;
    act?.steps.add(id);
    this.queue.push({ at: ms, seq: ++this.seq, id, run: () => (act === undefined || act.steps.delete(id) ? fn() : undefined) });
    return id;
  }

  private emit(frame: ActFrame, at: number): void {
    this.o.emit({ ...frame, run: this.o.run, at });
  }

  private emitState(): void {
    this.emit({ t: "drama_state", room: this.o.room, scene: this.sceneId, enabled: this.enabled, calm: this.calm, paused: this.paused, ...(this.paused ? { paused_until: this.pausedUntil } : {}), opt_in: [...this.optIn].sort((a, b) => a - b) }, this.clock);
  }

  // ---- the command -----------------------------------------------------------------------------------------

  /** ACT-1 to ACT-13, then the gates. Returns the `actor_error` frame the hotel would send, or undefined when the command was accepted or blocked. */
  receive(actor: number, wire: ActWire, cid = 0): ActFrame | undefined {
    const now = this.sync();
    const verb = wire.verb;
    const entry = this.table[verb];
    const target = wire.with ?? undefined;
    const error = (code: string, detail?: string): ActFrame => {
      const frame: ActFrame = { t: "actor_error", cid, actor, code, ...(detail !== undefined ? { detail } : {}) };
      this.o.emit(frame);
      return frame;
    };
    if (this.consumed.has(wire.act_id)) return error("bad_message", "act_id_reused");
    this.consumed.add(wire.act_id);
    if (target !== undefined) {
      if (target === actor) return error("bad_target", "self");
      if (target === NARRATOR_OF(this.o.run)) return error("bad_target", "narrator");
      const av = this.avatar(target);
      if (!av) return error("target_gone", String(target));
      if (entry.target_kinds.length > 0 && !entry.target_kinds.includes(av.human ? "human" : "actor")) return error("bad_target", "kind");
      if (verb === "tend_fallen" && !this.isFallen(target)) return error("bad_target", "not_fallen");
    }
    if (this.dead.has(actor)) return error("actor_dead", this.dead.get(actor)?.actId);
    const lock = this.locks.get(actor);
    if (lock && !this.finishedLock(lock)) return error("act_busy", lock.actId);
    const me = this.avatar(actor);
    if (!me) return error("unknown_actor", String(actor));
    if (!entry.gates.actor_posture.includes(me.state === "walk" ? "stand" : me.state)) return error("action_not_here", me.state);

    const blocked = this.gate(me, target, wire, entry, now);
    if (blocked) {
      this.stats.blocked += 1;
      this.emit({ t: "act_done", room: this.o.room, act_id: wire.act_id, verb, actor, ...(target !== undefined && entry.target === "required" ? { with: target } : {}), outcome: "blocked", reason: blocked.reason, ...(blocked.detail !== undefined ? { detail: blocked.detail } : {}), owed_missed: [], downgraded: [] }, now);
      return undefined;
    }
    this.start(me, target, wire, entry, now);
    return undefined;
  }

  // ---- the gates (2.4) -------------------------------------------------------------------------------------

  private gate(me: WorldAvatar, targetId: number | undefined, wire: ActWire, entry: VerbEntry, now: number): Gate | undefined {
    const g = entry.gates;
    const target = targetId === undefined ? undefined : this.avatar(targetId);
    const humanTarget = target?.human === true;
    this.expireHarm(now);
    if (!this.enabled) return { reason: "kill_switch" };
    if (this.calm && g.calm_blocks) return { reason: "calm_room" };
    if (entry.violent && humanTarget && (this.harm.length >= (this.o.harmMax ?? K.harm_max_default) || this.paused)) return { reason: "rate_limit" };
    if (target && wire.verb !== "tend_fallen" && this.isFallen(target.id)) return { reason: "dead_target" };
    const scenario = this.scenarioGate(me, target, wire, entry);
    if (scenario) return scenario;
    if (humanTarget && g.consent !== null && g.consent.startsWith("violent") && !this.optIn.has(target.id) && this.o.chiplessHumans !== true) return { reason: "consent_off" };
    if (target && g.max_dist !== null) {
      const d = cheb(me.tile, target.tile);
      if (d > g.max_dist) return { reason: "too_far", detail: "distance" };
      if (g.still && (me.state === "walk" || target.state === "walk")) return { reason: "too_far", detail: "moving" };
      if (g.still && (me.state === "lay" || target.state === "lay")) return { reason: "too_far", detail: "posture" };
    }
    const rung = ladderRung(wire.verb);
    if (rung !== undefined) {
      const key = target ? `${me.id}>${target.id}` : "";
      const cur = target ? (this.rung.get(key) ?? 0) : 0;
      const skip = wire.authored_skip === true && (wire.origin ?? "director") === "scenario";
      if (!skip && rung > Math.max(cur, 1) + 1) return { reason: "ladder", detail: "rung" };
      if (rung >= K.zero_witness_cap_rung + 1 && (wire.origin ?? "director") !== "scenario" && this.witnessesOf(me, target).length === 0) return { reason: "ladder", detail: "zero_witness" };
    }
    if (g.budget === "physical" || g.budget === "kill") {
      if (this.lastPhysical !== undefined && now - this.lastPhysical < K.physical_spacing_ms) return { reason: "budget", detail: "physical" };
      if (wire.verb === "kill" && this.kills >= K.kills_per_scene) return { reason: "budget", detail: "kill" };
    }
    if (g.cooldown && target) {
      const at = this.cooldown.get(`${me.id}:${wire.verb}:${target.id}`);
      if (at !== undefined && now - at < K.same_verb_target_cooldown_ms) return { reason: "cooldown", detail: "verb" };
      if (humanTarget && g.consent !== null) {
        if (this.chipOpen.has(target.id)) return { reason: "cooldown", detail: "chip_busy" };
        const cd = this.chipCooldown.get(target.id);
        if (cd !== undefined && now - cd < K.chip_cooldown_ms) return { reason: "cooldown", detail: "chip_cooldown" };
      }
    }
    return undefined;
  }

  /** GATE-5 and section 7. */
  private scenarioGate(me: WorldAvatar, target: WorldAvatar | undefined, wire: ActWire, entry: VerbEntry): Gate | undefined {
    const block = this.o.drama;
    const eff = block ?? { max_rung: 3, may_target: [], may_die: [], permadeath: false };
    const rung = ladderRung(wire.verb);
    const origin = wire.origin ?? "director";
    if (wire.authored_skip === true && (origin !== "scenario" || block === undefined || (rung !== undefined && block.max_rung < rung))) return { reason: "no_scenario_gate", detail: "skip" };
    if (rung !== undefined && rung >= 4 && block === undefined) return { reason: "no_scenario_gate", detail: "free_play" };
    if (rung !== undefined && rung > eff.max_rung) return { reason: "no_scenario_gate", detail: "max_rung" };
    if (rung !== undefined && rung >= 4) {
      const victim = target?.human ? "@human" : target?.ref;
      if (!eff.may_target.some(([a, v]) => a === me.ref && v === victim)) return { reason: "no_scenario_gate", detail: "may_target" };
      if (wire.verb === "kill" && !eff.may_die.includes(victim ?? "")) return { reason: "no_scenario_gate", detail: "may_die" };
    }
    if (entry.gates.scenario === "needs_may_die" && !eff.may_die.includes(me.ref)) return { reason: "no_scenario_gate", detail: block === undefined ? "free_play" : "may_die" };
    return undefined;
  }

  // ---- an accepted act -----------------------------------------------------------------------------------

  private start(me: WorldAvatar, targetId: number | undefined, wire: ActWire, entry: VerbEntry, now: number): void {
    const target = targetId === undefined ? undefined : this.avatar(targetId);
    const verb = wire.verb;
    const intensity = wire.intensity ?? entry.intensity.default;
    const origin = wire.origin ?? "director";
    const humanTarget = target?.human === true;
    const chip = humanTarget && entry.gates.consent !== null && (this.o.chiplessHumans !== true || this.optIn.has(target.id));
    const act: Open = { id: wire.act_id, verb, actor: me.id, target: target?.id, intensity, origin, entry, scene: this.sceneId, t0: now, chip, human: humanTarget, steps: new Set(), reactors: new Map(), harm: entry.violent && humanTarget };
    this.acts.set(act.id, act);
    this.stats.started += 1;

    // RSV-1: everything the gates counted is reserved now and never released, except the harm reservation.
    const rung = ladderRung(verb);
    const skipped = rung !== undefined && wire.authored_skip === true && target ? skippedRungs(this.rung.get(`${me.id}>${target.id}`) ?? 0, rung) : [];
    if (rung !== undefined && target) this.rung.set(`${me.id}>${target.id}`, Math.max(this.rung.get(`${me.id}>${target.id}`) ?? 0, rung));
    if (entry.gates.budget !== null) this.lastPhysical = now;
    if (verb === "kill") this.kills += 1;
    if (entry.gates.cooldown && target) this.cooldown.set(`${me.id}:${verb}:${target.id}`, now);
    if (chip && target) this.chipOpen.add(target.id);
    if (act.harm) this.harm.push({ actId: act.id, at: now, landed: false });
    this.locks.set(me.id, { actId: act.id, until: "done" });
    if (target && !target.human && entry.contact) this.locks.set(target.id, { actId: act.id, until: "done" });

    const impact = impactClassOf(verb, intensity);
    this.emit(
      {
        t: "act_started", room: this.o.room, act_id: act.id, verb, actor: me.id, ...(target && entry.target === "required" ? { with: target.id } : {}), intensity,
        ...(impact ? { impact } : {}), origin, scene: act.scene, ...(rung !== undefined ? { rung } : {}), skipped_rungs: skipped, authored_skip: wire.authored_skip === true,
        ...(humanTarget ? { target_opt_in: this.optIn.has(target.id) } : {}), chip, contact_in_ms: chip ? null : entry.timeline.contact_at_ms,
      },
      now,
    );

    if (!chip) {
      this.at(now + entry.timeline.contact_at_ms, () => this.contact(act), act);
      return;
    }
    const family = entry.gates.consent?.startsWith("affection") ? "affection" : "violent";
    this.emit({ t: "drama_consent", room: this.o.room, act_id: act.id, phase: "shown", actor: me.id, with: target!.id, verb, family, ttl_ms: K.chip_ttl_ms }, now);
    const answer = this.o.humanAnswer?.({ actId: act.id, verb, actor: me.id, human: target!.id, family }) ?? (family === "affection" ? "take" : "dodge");
    const q: ChipQuestion = { actId: act.id, verb, actor: me.id, human: target!.id, family };
    const delay = typeof this.o.answerDelayMs === "function" ? this.o.answerDelayMs(q) : (this.o.answerDelayMs ?? 400);
    const answeredAt = answer === "timeout" ? now + K.chip_ttl_ms : now + Math.min(delay, K.chip_ttl_ms - 1);
    this.at(answeredAt, () => this.answered(act, answer, answeredAt), act);
  }

  private answered(act: Open, answer: ChipAnswer, at: number): void {
    const human = act.target!;
    act.answer = answer;
    this.chipOpen.delete(human);
    const family = act.entry.gates.consent?.startsWith("affection") ? "affection" : "violent";
    this.emit({ t: "drama_consent", room: this.o.room, act_id: act.id, phase: "answered", actor: act.actor, with: human, verb: act.verb, family, answer }, at);
    if (answer === "take") {
      this.at(at + K.chip_windup_ms, () => this.contact(act, answer), act);
      return;
    }
    const hugTimeout = answer === "timeout" && act.verb === "hug";
    if (!hugTimeout) this.chipCooldown.set(human, at);
    const outcome = hugTimeout ? "timeout" : answer === "push_back" ? "declined" : "dodged";
    this.release(act.harm ? act.id : undefined, false);
    this.at(at + (hugTimeout ? 300 : CHIP_END_MS), () => this.finish(act, outcome, answer), act);
  }

  /** `Tc`: re-check (RSV-2), the beat, the reactions, the death. */
  private contact(act: Open, answer?: ChipAnswer): void {
    const at = this.clock;
    const actor = this.avatar(act.actor);
    const target = act.target === undefined ? undefined : this.avatar(act.target);
    const abort = this.recheck(act, actor, target);
    if (abort) {
      this.stats.aborted += 1;
      this.release(act.harm ? act.id : undefined, false);
      this.finish(act, "aborted", answer, abort);
      return;
    }
    act.tc = at;
    const witnesses = actor ? this.witnessesOf(actor, target) : [];
    const owed = this.owedOf(act, witnesses, target);
    this.emit({ t: "act_beat", room: this.o.room, act_id: act.id, beat: "contact", witnesses: witnesses.map((w) => w.id).sort((a, b) => a - b), owed: owed.map((d) => ({ who: d.who, role: d.role, due_at: at + (d.role === "target" ? K.target_deadline_ms : K.witness_deadline_ms) })) }, at);

    if (act.harm) this.land(act, at);
    const hit = act.entry.violent ? (K.hit_stop_ms as Record<string, number>)[impactClassOf(act.verb, act.intensity) ?? "M"] ?? 100 : 0;
    this.deaths(act, at, hit, target);
    for (const d of owed) this.scheduleReaction(act, d, at, hit);

    const table = this.tableEnd(act, hit);
    const lethalActor = act.verb === "kill" && target !== undefined && !target.human;
    const end = lethalActor ? at + hit + FALL_MS + BODY_HOLD_MS : at + Math.max(table, owed.length > 0 ? K.witness_deadline_ms : 0);
    const outcome = answer === "timeout" && act.verb === "hug" ? "timeout" : "landed";
    this.at(end, () => this.finish(act, outcome, answer), act);
  }

  private recheck(act: Open, actor: WorldAvatar | undefined, target: WorldAvatar | undefined): string | undefined {
    if (!actor || this.gone.has(act.actor)) return "actor_gone";
    if (this.dead.has(act.actor)) return "actor_dead";
    if (!this.enabled) return "kill_switch";
    if (this.calm && act.entry.gates.calm_blocks) return "calm_room";
    if (this.paused && act.human && act.entry.violent) return "paused";
    if (target) {
      if (this.gone.has(target.id)) return "target_gone";
      if (target.human && act.entry.gates.consent?.startsWith("violent") && !this.optIn.has(target.id) && this.o.chiplessHumans !== true) return "opt_out";
      if (act.entry.contact && act.entry.gates.max_dist !== null && (cheb(actor.tile, target.tile) > act.entry.gates.max_dist || target.state === "walk")) return "target_moved";
    }
    return undefined;
  }

  /** REA-2: everyone but the principals within 6 tiles of either, alive, standing or sitting, not locked by another act. */
  private witnessesOf(actor: WorldAvatar, target: WorldAvatar | undefined): WorldAvatar[] {
    return this.o.world
      .avatars()
      .filter((a) => a.id !== actor.id && a.id !== target?.id && !this.gone.has(a.id) && !this.isFallen(a.id) && (a.state === "stand" || a.state === "sit" || a.state === "walk") && (cheb(a.tile, actor.tile) <= K.earshot_tiles || (target !== undefined && cheb(a.tile, target.tile) <= K.earshot_tiles)) && !this.lockedByOther(a.id, actor.id))
      .sort((x, y) => x.id - y.id);
  }

  private lockedByOther(id: number, principal: number): boolean {
    const lock = this.locks.get(id);
    return lock !== undefined && !this.finishedLock(lock) && this.acts.get(lock.actId)?.actor !== principal;
  }

  private finishedLock(lock: { actId: string; until: number | "done" }): boolean {
    return lock.until !== "done" && lock.until <= this.clock;
  }

  private owedOf(act: Open, witnesses: WorldAvatar[], target: WorldAvatar | undefined): Array<{ who: number; role: "target" | "witness" }> {
    const owed: Array<{ who: number; role: "target" | "witness" }> = [];
    if (target && !target.human && act.entry.owed.target_ms !== null) owed.push({ who: target.id, role: "target" });
    const when = act.entry.owed.witness_when;
    const rungCur = target ? (this.rung.get(`${act.actor}>${target.id}`) ?? 0) : 0;
    const on = when === "always" || when === "standalone_only" || (when === "scene_rung_ge_2" && rungCur >= 2);
    if (on && act.entry.owed.witness_ms !== null) for (const w of witnesses) if (!w.human) owed.push({ who: w.id, role: "witness" });
    return owed;
  }

  private scheduleReaction(act: Open, debt: { who: number; role: "target" | "witness" }, tc: number, hit: number): void {
    const steps = debt.role === "target" ? act.entry.roles.target : act.entry.roles.witnesses;
    const step = steps?.find((s) => s.reaction !== undefined);
    const label = step?.reaction ?? (debt.role === "target" ? "surprised" : "freeze_gasp");
    const me = this.avatar(debt.who);
    const anchor = this.avatar(act.actor);
    let when: number;
    if (debt.role === "target") when = tc + (step?.t.ms ?? 0) + (step?.t.hs ? hit : 0);
    else {
      const dist = me && anchor ? cheb(me.tile, anchor.tile) : 0;
      const w = K.witness_stagger;
      when = tc + Math.min(w.cap_ms, w.base_ms + w.per_tile_ms * dist + (hash(`${this.o.run}:${act.id}:${debt.who}`) % (w.jitter_ms + 1)));
    }
    if (label === "die") when = tc + hit;
    act.reactors.set(debt.who, { due: when, label, replaceable: REPLACEABLE.has(label), done: false });
    this.locks.set(debt.who, { actId: act.id, until: when + 400 });
    const lethal = label === "die";
    this.at(when, () => {
      const r = act.reactors.get(debt.who);
      if (!r || r.done || this.gone.has(debt.who) || (this.dead.has(debt.who) && !lethal)) return;
      r.done = true;
      this.emit({ t: "act_reaction", room: this.o.room, act_id: act.id, who: debt.who, role: debt.role, reaction: label, source: "table" }, when);
    }, act);
  }

  /** A body command of an actor, before the hotel executes it: `act_busy` (REA-9) unless it is the reaction an owed actor may give (REA-3). */
  onBodyCommand(actor: number, k: string): "act_busy" | undefined {
    const now = this.sync();
    for (const act of this.acts.values()) {
      const r = act.reactors.get(actor);
      if (r && !r.done && act.tc !== undefined && now >= act.tc && now < r.due && r.replaceable && QUALIFYING.has(k)) {
        r.done = true;
        this.emit({ t: "act_reaction", room: this.o.room, act_id: act.id, who: actor, role: actor === act.target ? "target" : "witness", reaction: `cmd:${k}`, source: "planner" }, now);
        return undefined;
      }
    }
    if (k === "chat" || k === "typing") return undefined;
    const lock = this.locks.get(actor);
    if (lock && !this.finishedLock(lock) && this.acts.has(lock.actId) && this.acts.get(lock.actId)?.doneAt === undefined) return "act_busy";
    return undefined;
  }

  // ---- what an act does ----------------------------------------------------------------------------------

  private land(act: Open, at: number): void {
    const h = this.harm.find((x) => x.actId === act.id);
    if (h) h.landed = true;
    if (this.harm.filter((x) => x.landed).length >= (this.o.harmMax ?? K.harm_max_default)) {
      this.paused = true;
      this.pausedUntil = at + (this.o.pauseMs ?? K.pause_s_default * 1000);
      this.emitState();
      this.at(this.pausedUntil, () => {
        this.paused = false;
        this.harm.length = 0;
        this.emitState();
      });
    }
  }

  private deaths(act: Open, tc: number, hit: number, target: WorldAvatar | undefined): void {
    const verb = act.verb;
    if (verb === "kill" && target) {
      if (target.human) {
        const ms = this.o.humanDownMs ?? K.human_down_ms_default;
        this.at(tc + hit, () => {
          this.down.add(target.id);
          this.o.world.markFallen(target.id, "down");
          this.emit({ t: "human_down", room: this.o.room, human: target.id, act_id: act.id, ms, scene: act.scene }, tc + hit);
          this.at(tc + hit + ms, () => {
            this.down.delete(target.id);
            this.o.world.markFallen(target.id, undefined);
            this.emit({ t: "human_up", room: this.o.room, human: target.id, act_id: act.id, reason: "timer" }, tc + hit + ms);
          });
        }, act);
      } else {
        this.die(act, target.id, tc + hit, "kill", act.actor);
      }
    }
    if (verb === "die") this.die(act, act.actor, tc, "die", undefined);
    if (verb === "faint") {
      this.at(tc, () => {
        this.fainted.add(act.actor);
        this.o.world.markFallen(act.actor, "fainted");
      }, act);
      this.at(tc + FAINT_END_MS - 800, () => {
        this.fainted.delete(act.actor);
        this.o.world.markFallen(act.actor, undefined);
      });
    }
  }

  private die(act: Open, victim: number, at: number, cause: "kill" | "die", killer: number | undefined): void {
    this.at(at, () => {
      this.dead.set(victim, { at, actId: act.id, scene: act.scene });
      this.o.world.markFallen(victim, "dead");
      this.emit({ t: "actor_death", room: this.o.room, actor: victim, cause, act_id: act.id, ...(killer !== undefined ? { killer } : {}), scene: act.scene }, at);
    }, act);
  }

  private tableEnd(act: Open, hit: number): number {
    let end = 0;
    for (const steps of Object.values(act.entry.roles)) for (const s of steps ?? []) end = Math.max(end, s.t.ms + (s.t.hs ? hit : 0));
    return end;
  }

  /** `act_done`: the last frame of an act, and the lock's end. */
  private finish(act: Open, outcome: "landed" | "dodged" | "declined" | "timeout" | "aborted", answer?: ChipAnswer, reason?: string): void {
    if (act.doneAt !== undefined) return;
    const at = this.clock;
    act.doneAt = at;
    this.stats.done += 1;
    this.release(undefined, outcome === "landed");
    for (const [who, lock] of [...this.locks]) if (lock.actId === act.id) this.locks.delete(who);
    act.steps.clear();
    this.emit(
      {
        t: "act_done", room: this.o.room, act_id: act.id, verb: act.verb, actor: act.actor, ...(act.target !== undefined && act.entry.target === "required" ? { with: act.target } : {}),
        outcome, ...(act.answer !== undefined ? { answer: act.answer } : {}), ...(reason ? { reason } : {}), owed_missed: [], downgraded: [],
      },
      at,
    );
  }

  /** Harm reservations: kept for a landed act, released for any other end (RSV-1). */
  private release(actId: string | undefined, landed: boolean): void {
    if (actId === undefined || landed) return;
    const i = this.harm.findIndex((h) => h.actId === actId && !h.landed);
    if (i >= 0) this.harm.splice(i, 1);
  }

  private expireHarm(now: number): void {
    const w = this.o.harmWindowMs ?? K.harm_window_s_default * 1000;
    for (let i = this.harm.length - 1; i >= 0; i--) if (now - this.harm[i]!.at >= w) this.harm.splice(i, 1);
  }

  private abortOpen(match: (a: Open) => boolean, reason: string): void {
    const now = this.clock;
    for (const act of this.acts.values()) {
      if (act.doneAt !== undefined || !match(act)) continue;
      if (act.chip && act.target !== undefined) this.chipOpen.delete(act.target);
      this.release(act.id, false);
      this.stats.aborted += 1;
      // The scheduler runs a step at most 100 ms late (TBL-9): an abort is seen at the next step.
      act.steps.clear();
      this.at(now + 50, () => this.finish(act, "aborted", undefined, reason));
    }
  }

  // ---- scenes (8.2) -----------------------------------------------------------------------------------------

  /** SCENE-2 and SCENE-5. Returns whether the cut happened; a cut younger than the floor is dropped silently (no `cid`). */
  advanceScene(_reason: string): boolean {
    const now = this.sync();
    if (now - this.sceneSince < K.scene_min_age_ms) return false;
    const prev = this.sceneId;
    this.scene += 1;
    this.sceneSince = now;
    // SCENE-3: acts in flight are aborted, chips closed, the ladder, the spacing and the kill count start over; cooldowns, harm, calm, pause, opt-in and a human's down state do not.
    for (const act of this.acts.values()) {
      if (act.doneAt !== undefined) continue;
      if (act.chip && act.target !== undefined) this.chipOpen.delete(act.target);
      this.release(act.id, false);
      act.steps.clear();
      this.stats.aborted += 1;
      this.finish(act, "aborted", undefined, "scene_cut");
    }
    this.rung.clear();
    this.lastPhysical = undefined;
    this.kills = 0;
    const bodies = [...this.dead].filter(([, d]) => now - d.at >= FALL_MS).map(([id]) => id).sort((a, b) => a - b);
    const permadeath = this.o.drama?.permadeath === true;
    this.emit({ t: "scene_cut", scene: this.sceneId, prev, reason: "sidecar", revived: permadeath ? [] : bodies, removed: permadeath ? bodies : [] }, now);
    for (const id of bodies) {
      this.dead.delete(id);
      this.o.world.markFallen(id, undefined);
      if (permadeath) {
        this.gone.add(id);
        this.o.emit({ t: "actor_gone", run: this.o.run, actor: id, reason: "died" });
      } else {
        const av = this.avatar(id);
        this.emit({ t: "actor_revive", room: this.o.room, actor: id, scene: this.sceneId, prev, x: av?.tile[0] ?? 0, y: av?.tile[1] ?? 0, effect: "" }, now);
      }
    }
    this.emitState();
    return true;
  }

  private avatar(id: number): WorldAvatar | undefined {
    return this.o.world.avatars().find((a) => a.id === id);
  }
}

function skippedRungs(from: number, to: number): string[] {
  const ladder = ["glare", "insult", "shove", "slap", "punch", "kill"];
  return ladder.slice(Math.max(from, 0), to - 1);
}

