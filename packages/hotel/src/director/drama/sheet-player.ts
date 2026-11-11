import { CLIMAX_MAX_MS } from "@perfectman/shared";
import type { BeatSheet, CameraIntent, Face, SheetBeat } from "@perfectman/shared";
import { sheetScenarioBeats } from "../../authoring/beat-sheet.js";
import type { ScenarioBeat } from "../../authoring/scenario-beats.js";
import type { TimerHandle } from "../../clock/clock.js";
import { BeatPlayer } from "./beat-player.js";
import type { BeatPlayerDeps, BeatReport } from "./beat-player.js";

/**
 * The beat sheet on the run clock (Contract A, "Runtime"). The sheet's acts and cuts are the existing `BeatPlayer`'s: scenario-origin acts through every gate of the
 * director, scene cuts through `advanceScene`. The rest of the sheet (blocking, props, faces, camera intent, authored silence) is played here, at its second, by the run's
 * own hooks; `reveal` and `note` beats are not played at all but read: `SheetNotes` hands each actor the note that is live for it, the way the spine's notes were.
 *
 * Two rules the generic spine had no use for:
 *  - The climax is forced. It is asked of the director as every act is, but a gate that only delays it does not drop it (`BeatPlayerDeps.force`): the rung below it that the
 *    improvised arc skipped is jumped with the authored skip, a spacing veto and a busy actor are asked again until {@link FORCE_UNTIL_MS} (4:00 plus a grace), a pair that is
 *    apart is walked together for as long. Only the scene's own refusals (`may_target`, `may_die`, a calm room, a dead actor) are final.
 *  - A beat that could not happen when it was due for want of a body (the actor was not placed yet, was busy with an act of its own, the hook found nowhere to go) is released
 *    once, {@link LATE_RELEASE_MS} later, if the scene has not moved past it. A gate's veto is never released late: that is the gate answering, not a body missing.
 */

/** The deadline the climax is forced to: the contract's 4:00, and a grace for an actor that was busy at the last moment. */
export const FORCE_UNTIL_MS = CLIMAX_MAX_MS + 30_000;
export const LATE_RELEASE_MS = 40_000;
/** Why a beat was dropped for want of a body, not by a gate. */
const LATE_WHY: ReadonlySet<string> = new Set(["not_placed", "target_gone", "actor_busy", "inert", "unplayable"]);

export type SheetStageHooks = {
  /** Walk the actor (a `block` beat). False: nowhere to go yet. */
  block(beat: Extract<SheetBeat, { kind: "block" }>): boolean;
  /** Handle the prop (a `prop` beat). False: the actor could not be placed. */
  prop(beat: Extract<SheetBeat, { kind: "prop" }>): boolean;
  /** Put a face on (an `expression` beat, and the neutral one after its `ms`). */
  expression(actor: string, face: Face): boolean;
  /** The camera intent of the beat, for the cinematic director (B4). */
  camera(intent: CameraIntent, beat: Extract<SheetBeat, { kind: "camera" }>): void;
  /** Nobody speaks for `ms` (a `pause` beat). */
  pause(ms: number, beat: Extract<SheetBeat, { kind: "pause" }>): void;
};

export type SheetReport = {
  beat: SheetBeat;
  /** The run clock when it was settled. */
  at: number;
  outcome: "played" | "dropped";
  why: string;
  /** True when this was the one late release of a beat that could not happen on time. */
  late?: boolean;
  /** Only for an act or a cut: what the `BeatPlayer` reported. */
  report?: BeatReport;
};

export type SheetPlayerDeps = Omit<BeatPlayerDeps, "beats" | "force" | "onReport" | "played"> & {
  sheet: BeatSheet;
  stage: SheetStageHooks;
  /** Beat ids already played, for a player rebuilt over the same sheet (a resume). */
  played?: Iterable<string>;
  lateMs?: number;
  forceUntilMs?: number;
  onReport?: (report: SheetReport) => void;
};

export type SheetSummary = {
  beats: number;
  played: number;
  late: number;
  dropped: Record<string, number>;
  /** `organic`: the sheet's climax was refused only because the improvised arc had already thrown that same blow at that same person within the minute (GATE-10): the scene has its physical climax, from another origin. */
  climax: { id: string; planned_ms: number; outcome: "pending" | "played" | "dropped" | "organic"; at_ms?: number; why?: string };
};

/** `face` held `ms` before it returns to neutral: long enough to read, short enough not to stick. */
const FACE_HOLD_MS = 6_000;

export class SheetPlayer {
  private readonly startedAt: number;
  private readonly lateMs: number;
  private readonly acts: BeatPlayer;
  private readonly lates: BeatPlayer[] = [];
  private readonly timers = new Set<TimerHandle>();
  private readonly done = new Set<string>();
  private readonly lateDone = new Set<string>();
  private readonly faceToken = new Map<string, number>();
  private readonly dropped = new Map<string, number>();
  private played = 0;
  private lateCount = 0;
  private stopped = false;
  private readonly climax: Extract<SheetBeat, { kind: "act" }> | undefined;
  private climaxOutcome: SheetSummary["climax"];
  private readonly byId = new Map<string, SheetBeat>();

  constructor(private readonly d: SheetPlayerDeps) {
    this.startedAt = d.startedAt ?? d.clock.now();
    this.lateMs = d.lateMs ?? LATE_RELEASE_MS;
    for (const b of d.sheet.beats) this.byId.set(b.id, b);
    for (const id of d.played ?? []) this.done.add(id);
    this.climax = d.sheet.beats.find((b): b is Extract<SheetBeat, { kind: "act" }> => b.kind === "act" && b.climax === true);
    this.climaxOutcome = { id: this.climax?.id ?? "", planned_ms: this.climax?.at_ms ?? d.sheet.arc.climax_at_ms, outcome: "pending" };
    // A storm out is a `block` in the sheet and an act in the director: `storm_off` is off the ladder and goes through the same gates as any act.
    const storms: ScenarioBeat[] = d.sheet.beats
      .filter((b): b is Extract<SheetBeat, { kind: "block" }> => b.kind === "block" && b.how === "storm")
      .map((b) => ({ id: b.id, at_ms: b.at_ms, kind: "act" as const, actor: b.actor, verb: "storm_off" as const }));
    const beats = [...sheetScenarioBeats(d.sheet), ...storms].sort((a, b) => a.at_ms - b.at_ms);
    this.acts = new BeatPlayer({
      clock: d.clock,
      port: d.port,
      beats,
      drama: d.drama,
      wireOf: d.wireOf,
      ...(d.walkCloser ? { walkCloser: d.walkCloser } : {}),
      startedAt: this.startedAt,
      ...(d.played ? { played: d.played } : {}),
      ...(d.tuning ? { tuning: d.tuning } : {}),
      ...(d.logger ? { logger: d.logger } : {}),
      ...(this.climax ? { force: { id: this.climax.id, untilMs: d.forceUntilMs ?? FORCE_UNTIL_MS } } : {}),
      onReport: (r) => this.onActReport(r),
    });
  }

  /** The ids settled so far (played or dropped), what a rebuilt player is told. */
  playedIds(): string[] {
    return [...new Set([...this.acts.playedIds(), ...this.done])];
  }

  summary(): SheetSummary {
    return { beats: this.d.sheet.beats.length, played: this.played, late: this.lateCount, dropped: Object.fromEntries(this.dropped), climax: { ...this.climaxOutcome } };
  }

  start(): void {
    this.stopped = false;
    this.acts.start();
    const now = this.d.clock.now();
    const past = this.d.tuning?.pastToleranceMs ?? 1000;
    for (const beat of this.d.sheet.beats) {
      if (beat.kind === "act" || beat.kind === "cut" || this.done.has(beat.id)) continue;
      if (beat.kind === "block" && beat.how === "storm") continue;
      const wait = this.startedAt + beat.at_ms - now;
      if (wait < -past) {
        this.settle(beat, "dropped", "past");
        continue;
      }
      this.after(Math.max(0, wait), () => this.play(beat, false));
    }
  }

  stop(): void {
    this.stopped = true;
    this.acts.stop();
    for (const p of this.lates) p.stop();
    for (const t of this.timers) t.cancel();
    this.timers.clear();
  }

  private after(ms: number, fn: () => void): void {
    const handle = this.d.clock.setTimer(() => {
      this.timers.delete(handle);
      if (!this.stopped) fn();
    }, ms);
    this.timers.add(handle);
  }

  private play(beat: SheetBeat, late: boolean): void {
    let ok = true;
    switch (beat.kind) {
      case "block":
        ok = this.d.stage.block(beat);
        break;
      case "prop":
        ok = this.d.stage.prop(beat);
        break;
      case "expression": {
        ok = this.d.stage.expression(beat.actor, beat.face);
        const token = (this.faceToken.get(beat.actor) ?? 0) + 1;
        this.faceToken.set(beat.actor, token);
        // The face goes back to neutral after its time, unless a later face took its place.
        if (ok && beat.face !== "neutral") this.after(beat.ms ?? FACE_HOLD_MS, () => void (this.faceToken.get(beat.actor) === token && this.d.stage.expression(beat.actor, "neutral")));
        break;
      }
      case "camera":
        this.d.stage.camera(beat.intent, beat);
        break;
      case "pause":
        this.d.stage.pause(beat.ms, beat);
        break;
      case "note":
      case "reveal":
        // Read by `SheetNotes` by the clock; here it only counts as delivered.
        break;
      default:
        return;
    }
    if (ok) return this.settle(beat, "played", late ? "late" : "ok", late);
    if (!late && !this.lateDone.has(beat.id) && this.releasable(beat)) {
      this.lateDone.add(beat.id);
      this.after(this.lateMs, () => this.play(beat, true));
      return;
    }
    this.settle(beat, "dropped", "unplayable", late);
  }

  /** A beat is released late only while the scene is still on: before the aftermath ends, and not into the next beat's moment of the same actor. */
  private releasable(beat: SheetBeat): boolean {
    return this.d.clock.now() - this.startedAt + this.lateMs <= this.d.sheet.arc.aftermath_until_ms;
  }

  private onActReport(r: BeatReport): void {
    const beat = this.byId.get(r.beat.id.replace(/~late$/, ""));
    if (!beat) return;
    const late = r.beat.id.endsWith("~late");
    if (r.outcome === "dropped" && !late && !this.lateDone.has(beat.id) && LATE_WHY.has(r.why) && beat.kind === "act" && beat.climax !== true && this.releasable(beat)) {
      this.lateDone.add(beat.id);
      this.releaseLate(r.beat);
      return;
    }
    if (beat.id === this.climax?.id) {
      const organic = r.outcome === "dropped" && r.why === "veto:cooldown";
      this.climaxOutcome = { ...this.climaxOutcome, outcome: organic ? "organic" : r.outcome, at_ms: r.at - this.startedAt, why: r.why };
    }
    this.settle(beat, r.outcome, r.why, late, r);
  }

  /** The one late release of an act beat: the same act, `lateMs` later, by a second player on the same clock (its id carries `~late`, so the first never confuses the two). */
  private releaseLate(original: ScenarioBeat): void {
    const nowRel = this.d.clock.now() - this.startedAt;
    const copy: ScenarioBeat = { ...original, id: `${original.id}~late`, at_ms: nowRel + this.lateMs };
    const player = new BeatPlayer({
      clock: this.d.clock,
      port: this.d.port,
      beats: [copy],
      drama: this.d.drama,
      wireOf: this.d.wireOf,
      ...(this.d.walkCloser ? { walkCloser: this.d.walkCloser } : {}),
      startedAt: this.startedAt,
      ...(this.d.tuning ? { tuning: this.d.tuning } : {}),
      ...(this.d.logger ? { logger: this.d.logger } : {}),
      onReport: (r) => this.onActReport(r),
    });
    this.lates.push(player);
    player.start();
  }

  private settle(beat: SheetBeat, outcome: "played" | "dropped", why: string, late = false, report?: BeatReport): void {
    this.done.add(beat.id);
    if (outcome === "played") {
      this.played += 1;
      if (late) this.lateCount += 1;
    } else this.dropped.set(why, (this.dropped.get(why) ?? 0) + 1);
    this.d.logger?.info("beat sheet beat", { beat: beat.id, kind: beat.kind, phase: beat.phase, outcome, why, ...(late ? { late: true } : {}) });
    this.d.onReport?.({ beat, at: this.d.clock.now(), outcome, why, ...(late ? { late: true } : {}), ...(report ? { report } : {}) });
  }
}
