import type { ActOrigin, ActVerb } from "@perfectman/shared";
import { PHYSICAL_VERBS, ladderRung } from "@perfectman/shared";
import type { HotelFrame } from "../index.js";
import { HARM_VERBS, LIMITS, VERB_GATES } from "./tuning.js";

type Frame<T extends HotelFrame["t"]> = Extract<HotelFrame, { t: T }>;

/**
 * The director's copy of what the hotel counts for a run (act-contract.md RSV-1, LAD-1 to LAD-4, GATE-3, GATE-10, CHIP-9).
 * It is a ledger of acts, not a set of counters: every number the gates read (the pair's rung, the spacing, the kill count,
 * the cooldowns, the harm window, the open chips) is derived from the records, so a blocked act, which the hotel does not
 * count (FRM-2), is undone by deleting its record, and nothing can drift from the acts it came from.
 *
 * Reserve at send (RSV-1): a record exists from the moment the act is sent, before `act_started`. A scene cut (SCENE-3)
 * resets only what is scene-scoped; the same-verb cooldown, the chip cooldown and the harm window outlive it.
 */

export type ActPhase = "sent" | "started" | "done";

export type ActRecord = {
  actId: string;
  actor: number;
  target: number | undefined;
  room: number | undefined;
  verb: ActVerb;
  rung: number | undefined;
  /** The instant the act counts from: when it was sent, moved to when `act_started` arrived (always after the hotel accepted it). */
  at: number;
  scene: string;
  origin: ActOrigin;
  phase: ActPhase;
  outcome?: Frame<"act_done">["outcome"];
  doneAt?: number;
  /** A chip is shown, or will be: the target is a human and the verb has a consent profile. */
  chip: boolean;
  /** The chip is still open: from the send until the human answers it (CHIP-8) or the act ends. */
  chipOpen: boolean;
  humanTarget: boolean;
  /** Counts toward the harm window: a violent verb at a human (SAFE-4). */
  harm: boolean;
  seq: number;
};

export type NewRecord = Pick<ActRecord, "actId" | "actor" | "target" | "room" | "verb" | "origin" | "scene" | "humanTarget"> & { at: number; /** The scene lets a human who did not opt in be the target: no chip will be shown for this act. */ chipless?: boolean };

/** What a resumed director could not read back from the hotel and assumes (act-contract.md NEG-9 carries only the scene id). */
export type Assumed = { physicalAt?: number; killUsed?: boolean };

type Cap = { scene: string; actor: number; target: number | undefined; to: number; seq: number };

/** The verbs that lock an actor target (TGT-1). */
const CONTACT = new Set<ActVerb>(["shove", "slap", "punch", "kill", "hug", "kiss", "restrain"]);
const HAS_CHIP = (verb: ActVerb): boolean => VERB_GATES[verb].consent !== null;

export class ActLedger {
  private readonly records = new Map<string, ActRecord>();
  private readonly caps: Cap[] = [];
  private readonly chipUntil = new Map<number, number>();
  private seq = 0;
  private assumed: Assumed = {};
  sceneId: string;
  /** When this scene began, as the director saw it (a resume assumes `now`, the safe reading: the floor is measured from there). */
  sceneSince: number;

  constructor(scene: string, now: number) {
    this.sceneId = scene;
    this.sceneSince = now;
  }

  // ---- writes ----------------------------------------------------------------------------------------------

  /** RSV-1: the act was sent, so it counts now, whatever comes of it. */
  reserve(n: NewRecord): ActRecord {
    const rung = ladderRung(n.verb);
    const { chipless, ...rest } = n;
    const rec: ActRecord = {
      ...rest,
      rung,
      phase: "sent",
      chip: n.humanTarget && HAS_CHIP(n.verb) && chipless !== true,
      chipOpen: n.humanTarget && HAS_CHIP(n.verb) && chipless !== true,
      harm: n.humanTarget && HARM_VERBS.has(n.verb),
      seq: ++this.seq,
    };
    this.records.set(n.actId, rec);
    return rec;
  }

  /** The hotel accepted it. An act this ledger did not send (another path) is recorded from the frame, so the ledger follows the hotel. */
  started(f: Frame<"act_started">, now: number, room: number | undefined): void {
    const target = f.with ?? undefined;
    const known = this.records.get(f.act_id);
    if (known && known.phase !== "sent") return;
    const rec =
      known ??
      this.reserve({ actId: f.act_id, actor: f.actor, target, room: room ?? f.room, verb: f.verb, origin: f.origin, scene: f.scene, humanTarget: target !== undefined && target > 0, at: now });
    rec.phase = "started";
    rec.at = Math.max(rec.at, now);
    rec.scene = f.scene;
    rec.rung = f.rung ?? rec.rung;
    rec.chip = f.chip;
    rec.chipOpen = f.chip;
  }

  /** `drama_consent{answered}`: the chip is closed, though the act goes on to contact. */
  chipAnswered(actId: string): void {
    const rec = this.records.get(actId);
    if (rec) rec.chipOpen = false;
  }

  /** `act_done`. A blocked act never counted (FRM-2): its record is deleted, which undoes every reservation it made. */
  done(f: Frame<"act_done">, now: number): void {
    const rec = this.records.get(f.act_id);
    if (f.outcome === "blocked") {
      this.records.delete(f.act_id);
      return;
    }
    if (!rec || rec.phase === "done") return;
    rec.phase = "done";
    rec.chipOpen = false;
    rec.outcome = f.outcome;
    rec.doneAt = now;
    // CHIP-9: a dodge, a push back or a violent timeout (an unanswered kiss reads as a dodge) leaves the human alone for a minute.
    if (rec.humanTarget && rec.chip && rec.target !== undefined && (f.outcome === "dodged" || f.outcome === "declined")) {
      this.chipUntil.set(rec.target, now + LIMITS.chipCooldownMs);
    }
    if (f.outcome === "landed") this.deescalate(rec);
    this.prune(now);
  }

  /** LAD-7: a `restrain` that lands on an aggressor, or an aggressor's `turn_back` at its target, drops the rung to at most 2. */
  private deescalate(rec: ActRecord): void {
    if (rec.verb === "restrain" && rec.target !== undefined) {
      this.caps.push({ scene: rec.scene, actor: rec.target, target: undefined, to: LIMITS.deescalateToRung, seq: ++this.seq });
    } else if (rec.verb === "turn_back" && rec.target !== undefined) {
      this.caps.push({ scene: rec.scene, actor: rec.actor, target: rec.target, to: LIMITS.deescalateToRung, seq: ++this.seq });
    }
  }

  /** SCENE-3: a scene begins. The rung, the spacing and the kill count start over; cooldowns, the chip cooldown and the harm window stay. */
  cut(scene: string, now: number): void {
    this.sceneId = scene;
    this.sceneSince = now;
    this.assumed = {};
    this.caps.length = 0;
  }

  /** NEG-9: the scene of a resumed run, with the counters the director could not read back assumed at their worst. */
  adopt(scene: string, now: number, assumed: Assumed): void {
    this.cut(scene, now);
    this.assumed = assumed;
  }

  private prune(now: number): void {
    // The rung of a pair is the highest used in the scene (LAD-1), however long ago: only an act of a scene already cut ages out with the windows.
    for (const [id, r] of this.records) if (r.phase === "done" && r.doneAt !== undefined && r.scene !== this.sceneId && now - r.doneAt > this.keepMs) this.records.delete(id);
    for (const [h, until] of this.chipUntil) if (until <= now) this.chipUntil.delete(h);
  }

  /** How long a finished act is kept: the longest window that still reads it (the harm window), set by the director from the session. */
  keepMs = 3_600_000;

  // ---- reads (the ladder view the gates use) ----------------------------------------------------------------

  private inScene(): ActRecord[] {
    return [...this.records.values()].filter((r) => r.scene === this.sceneId).sort((a, b) => a.seq - b.seq);
  }

  /** `rung_cur(actor to target)`: the highest rung used in this scene, brought down by any de-escalation since (LAD-1, LAD-7). */
  rungCur(actor: number, target: number): number {
    return this.fold((r) => r.actor === actor && r.target === target, (c) => c.actor === actor && (c.target === undefined || c.target === target));
  }

  /** The highest rung any pair holds in this scene. */
  highestRung(): number {
    return this.fold(() => true, () => true);
  }

  /** The rung of an actor toward anyone: for the contagion cap (LAD-10). */
  rungOfActor(actor: number): number {
    return this.fold((r) => r.actor === actor, (c) => c.actor === actor);
  }

  private fold(takes: (r: ActRecord) => boolean, capped: (c: Cap) => boolean): number {
    const events: Array<{ seq: number; rec?: ActRecord; cap?: Cap }> = [
      ...this.inScene().filter((r) => r.rung !== undefined && takes(r)).map((rec) => ({ seq: rec.seq, rec })),
      ...this.caps.filter((c) => c.scene === this.sceneId && capped(c)).map((cap) => ({ seq: cap.seq, cap })),
    ].sort((a, b) => a.seq - b.seq);
    let cur = 0;
    for (const e of events) {
      if (e.rec?.rung !== undefined) cur = Math.max(cur, e.rec.rung);
      if (e.cap) cur = Math.min(cur, e.cap.to);
    }
    return cur;
  }

  /** The actors holding a rung of `min` or more in this scene (LAD-10); with `since`, only a rung started at or after it counts, so an old blow ages out of the cap. */
  actorsAtOrAbove(min: number, actors: Iterable<number>, since?: number): number[] {
    const rung = (a: number): number => (since === undefined ? this.rungOfActor(a) : this.fold((r) => r.actor === a && r.at >= since, (c) => c.actor === a));
    return [...new Set(actors)].filter((a) => rung(a) >= min);
  }

  /** LAD-3: when the last physical beat of this scene started (a resume assumes one just did). */
  lastPhysicalAt(): number | undefined {
    const at = this.inScene().filter((r) => (PHYSICAL_VERBS as readonly string[]).includes(r.verb)).map((r) => r.at);
    if (this.assumed.physicalAt !== undefined) at.push(this.assumed.physicalAt);
    return at.length === 0 ? undefined : Math.max(...at);
  }

  /** LAD-4: kills started in this scene, whatever their outcome. */
  kills(): number {
    return this.inScene().filter((r) => r.verb === "kill").length + (this.assumed.killUsed ? LIMITS.killsPerScene : 0);
  }

  /** GATE-10: when the same actor last used this verb on this target (any scene: a cut does not reset the cooldown). */
  lastSameVerbAt(actor: number, verb: ActVerb, target: number | undefined): number | undefined {
    let at: number | undefined;
    for (const r of this.records.values()) if (r.actor === actor && r.verb === verb && r.target === target) at = Math.max(at ?? r.at, r.at);
    return at;
  }

  /** CHIP-9: a chip is open for this human (or about to be: an act with a consent profile was sent and not yet started). */
  chipBusy(human: number): boolean {
    for (const r of this.records.values()) if (r.humanTarget && r.target === human && r.phase !== "done" && r.chipOpen) return true;
    return false;
  }

  /** CHIP-9: until when this human is left alone after turning a chip down. */
  chipCooldownUntil(human: number): number | undefined {
    return this.chipUntil.get(human);
  }

  /** SAFE-4: violent acts at humans in this room that landed inside the window, plus the reserved ones still open (RSV-1). */
  harmCount(room: number | undefined, now: number, windowMs: number): number {
    let n = 0;
    for (const r of this.records.values()) {
      if (!r.harm || r.room !== room) continue;
      if (r.phase !== "done") n++;
      else if (r.outcome === "landed" && r.doneAt !== undefined && now - r.doneAt <= windowMs) n++;
    }
    return n;
  }

  /** ACT-12 and TGT-1: the act that keeps this avatar busy (it started an open act, or is the locked actor target of a contact verb). */
  busyActId(avatar: number): string | undefined {
    for (const r of this.records.values()) {
      if (r.phase === "done") continue;
      if (r.actor === avatar) return r.actId;
      if (avatar < 0 && r.target === avatar && CONTACT.has(r.verb)) return r.actId;
    }
    return undefined;
  }

  get(actId: string): ActRecord | undefined {
    return this.records.get(actId);
  }

  all(): ActRecord[] {
    return [...this.records.values()];
  }
}
