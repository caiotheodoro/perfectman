import type { RunDrama } from "../../authoring/scenario-drama.js";
import type { ScenarioBeat } from "../../authoring/scenario-beats.js";
import type { Clock, TimerHandle } from "../../clock/clock.js";
import type { Logger } from "../../util/log.js";
import { silentLogger } from "../../util/log.js";
import type { DramaDecision, DramaDecisionPort, SceneAdvance } from "./ports.js";
import { DEFAULT_DRAMA_TUNING } from "./tuning.js";
import type { DramaTuning } from "./tuning.js";

/** What became of one beat: `played` (the director sent it, or the cut was sent) or `dropped` with the reason in one word. */
export type BeatReport = {
  beat: ScenarioBeat;
  /** The run clock when it was settled. */
  at: number;
  outcome: "played" | "dropped";
  /** `approve` or `sent`; or `inert`, `past`, `not_placed`, `target_gone`, `free_play`, `may_die`, `kill_budget`, `veto:<reason>`, `unsent:<cause>`, or the director's own pass (`actor_busy`, `actor_dead`, `posture`). */
  why: string;
  /** Why a distance veto is final: `retry_window_expired` (the pair never came adjacent) or `scene_cut` (the scene ended while they walked). Absent otherwise. */
  detail?: "retry_window_expired" | "scene_cut";
  decision?: DramaDecision;
  advance?: SceneAdvance;
};

export type BeatPlayerDeps = {
  clock: Clock;
  /** The run's director, read each time: a rebuilt one (NEG-9) is picked up without the player knowing. Absent or inactive: drama is not negotiated and a beat does nothing. */
  port: () => DramaDecisionPort | undefined;
  beats: readonly ScenarioBeat[];
  /** The run's `drama` block, for the kill rules (SCN-1, SCN-3, LAD-4) a beat is held to before the director is even asked. */
  drama: RunDrama;
  /** The wire id of a cast member (the avatar the run spawned for that agent id), or undefined while it has none. */
  wireOf(ref: string): number | undefined;
  /**
   * Walks the actor beside the target (the planner's own `walkCloser`: a free tile next to the target, a `walk` command to it). True when a walk was
   * ordered, false when there was nowhere to go. Absent: a beat that is `too_far` cannot be helped and is dropped at once.
   */
  walkCloser?(actor: string, target: string): boolean;
  /** The run clock's zero: the second a beat's `at_ms` counts from. Default: the clock when the player is built. */
  startedAt?: number;
  /** Beat ids already played, for a player rebuilt over the same body (a resume). They are never played again. */
  played?: Iterable<string>;
  tuning?: DramaTuning["beats"];
  /**
   * A beat the scene must not lose: a beat sheet's climax (Contract A, "physical climax by 4:00"). It is played as every beat is (a scenario-origin act, every gate
   * the director's), and where a gate would only keep it from coming it is asked again instead of dropped: a `ladder` veto (the improvised arc did not climb the rungs
   * below it) is asked again with the authored skip, which the scene's `drama` block must cover (SCN-4); a physical-spacing `budget` veto (an improvised shove a few seconds ago)
   * and a busy actor are asked again every `retryMs` until `untilMs` after the run began. Any other veto (`may_target`, `may_die`, `calm_room`, `consent_off`, ...) is final, as for any beat.
   */
  force?: { id: string; untilMs: number; retryMs?: number };
  logger?: Logger;
  onReport?: (report: BeatReport) => void;
};

type Pending = { timer: TimerHandle | undefined };

/** A contact beat that was `too_far` and is being walked into reach: when it started waiting, in which scene, and when the walk was last ordered. */
type Walking = { since: number; scene: string; walkedAt: number };

/**
 * The scenario's script, played by the production path (errata P4-01). The contract has the director veto a model's `kill` by design (LAD-5:
 * mortality is authored), so in a run a kill happens only here: a beat of `body.beats` is scheduled on the run's clock and handed to the
 * `DramaDirector` as a scenario-origin act (`origin:"scenario"`, `authored_skip` where the author wrote `skip`). It is still subject to
 * `may_target`, `may_die`, `max_rung` and every hotel gate (SCN-3, SCN-4, GATE-1 to GATE-10); the director runs them. A beat they veto is
 * logged and dropped, never retried: the waits are for an actor that is busy with an act of its own, which is not a gate, and for a pair that is
 * too far apart (GATE-7, habbo#41): that beat walks the pair together (`walkCloser`) and is asked again for `walkWindowMs`, then dropped with
 * `retry_window_expired`, or dropped at once with `scene_cut` if the scene ended meanwhile (a kill is never carried into the next scene). A cut goes to
 * `advanceScene`, which keeps the scene's 20 s floor (SCENE-5) and the pending window (SCENE-4); a cut the floor or the window refuses waits
 * and is asked again, and one the hotel dropped silently is asked again a bounded number of times.
 *
 * Each beat is played at most once, by id: a rebuilt player told the played ids skips them, and one started after a beat's time does not
 * play it late. The player lives in a live run only. A replay (REPLAY-1) builds none and drops the recorded commands.
 */
export class BeatPlayer {
  private readonly tuning: DramaTuning["beats"];
  private readonly log: Logger;
  private readonly startedAt: number;
  private readonly done = new Set<string>();
  private readonly timers = new Map<string, Pending>();
  private readonly killedIn = new Set<string>();
  private readonly walking = new Map<string, Walking>();
  /** Cuts that were sent and whose scene_cut has not been seen yet. */
  private readonly confirming = new Set<string>();
  /** Forced beats whose `ladder` veto was answered by asking again with the authored skip. */
  private readonly skipped = new Set<string>();
  private stopped = false;

  constructor(private readonly d: BeatPlayerDeps) {
    this.tuning = d.tuning ?? DEFAULT_DRAMA_TUNING.beats;
    this.log = d.logger ?? silentLogger;
    this.startedAt = d.startedAt ?? d.clock.now();
    for (const id of d.played ?? []) this.done.add(id);
  }

  /** The ids settled so far (played or dropped), in the order the script lists them: what a rebuilt player is told. */
  playedIds(): string[] {
    return this.d.beats.filter((b) => this.done.has(b.id)).map((b) => b.id);
  }

  start(): void {
    this.stopped = false;
    const now = this.d.clock.now();
    for (const beat of this.d.beats) {
      if (this.done.has(beat.id) || this.timers.has(beat.id)) continue;
      const wait = this.startedAt + beat.at_ms - now;
      if (wait < -this.tuning.pastToleranceMs) {
        this.settle(beat, "dropped", "past");
        continue;
      }
      this.schedule(beat, Math.max(0, wait), () => this.play(beat, 0));
    }
  }

  stop(): void {
    this.stopped = true;
    for (const p of this.timers.values()) p.timer?.cancel();
    this.timers.clear();
    this.walking.clear();
  }

  // ---- one beat -----------------------------------------------------------------------------------------------

  private schedule(beat: ScenarioBeat, ms: number, fn: () => void): void {
    const pending: Pending = { timer: undefined };
    pending.timer = this.d.clock.setTimer(() => {
      if (this.timers.get(beat.id) === pending) this.timers.delete(beat.id);
      if (!this.stopped) fn();
    }, ms);
    this.timers.set(beat.id, pending);
  }

  private play(beat: ScenarioBeat, attempt: number): void {
    if (this.done.has(beat.id) && !this.confirming.has(beat.id)) return;
    const port = this.d.port();
    if (!port?.active) return this.settle(beat, "dropped", "inert");
    switch (beat.kind) {
      case "cut":
        return this.playCut(beat, port, attempt);
      case "act":
        return this.playAct(beat, port, attempt);
      default: {
        const unhandled: never = beat;
        return unhandled;
      }
    }
  }

  private playAct(beat: Extract<ScenarioBeat, { kind: "act" }>, port: DramaDecisionPort, attempt: number): void {
    const actor = this.d.wireOf(beat.actor);
    const target = beat.with === undefined ? undefined : this.d.wireOf(beat.with);
    // A beat that was walking when the scene was cut is over: not asked in the next scene, even if the pair has come together by now.
    const walked = this.walking.get(beat.id);
    if (walked && walked.scene !== port.scene) return this.settle(beat, "dropped", "veto:too_far", { detail: "scene_cut" });
    if (actor === undefined) return this.settle(beat, "dropped", "not_placed");
    if (beat.with !== undefined && target === undefined) return this.settle(beat, "dropped", "target_gone");
    if (beat.verb === "kill") {
      // The kill rules, held here too so a beat that can never be allowed is not even asked (SCN-1, SCN-3, LAD-4).
      if (this.d.drama.freePlay) return this.settle(beat, "dropped", "free_play");
      if (beat.with === undefined || !this.d.drama.effective.may_die.includes(beat.with)) return this.settle(beat, "dropped", "may_die");
      if (this.killedIn.has(port.scene)) return this.settle(beat, "dropped", "kill_budget");
    }
    const forced = this.d.force?.id === beat.id ? this.d.force : undefined;
    const decision = port.decide({
      actor,
      proposal: { verb: beat.verb, ...(target !== undefined ? { with: target } : {}), origin: "scenario", ...(beat.authored_skip === true || this.skipped.has(beat.id) ? { authoredSkip: true } : {}) },
    });
    switch (decision.kind) {
      case "approve":
      case "initiate":
        if (beat.verb === "kill") this.killedIn.add(port.scene);
        return this.settle(beat, "played", "approve", { decision });
      case "veto":
        if (decision.reason === "too_far") return this.closeIn(beat, port, attempt, decision);
        if (forced && this.forceAgain(beat, forced, decision, attempt)) return;
        return this.settle(beat, "dropped", `veto:${decision.reason}`, { decision });
      case "pass":
        // The actor is in the middle of an act of its own: wait for it, a little. Nothing was asked of any gate yet.
        if (decision.why === "actor_busy" && forced && this.d.clock.now() < this.startedAt + forced.untilMs) return this.schedule(beat, forced.retryMs ?? 1000, () => this.play(beat, attempt + 1));
        if (decision.why === "actor_busy" && (attempt + 1) * this.tuning.busyRetryMs <= this.tuning.busyWindowMs) return this.schedule(beat, this.tuning.busyRetryMs, () => this.play(beat, attempt + 1));
        return this.settle(beat, "dropped", decision.why, { decision });
      case "unsent":
        return this.settle(beat, "dropped", `unsent:${decision.cause}`, { decision });
      default: {
        const unhandled: never = decision;
        return unhandled;
      }
    }
  }

  /**
   * A forced beat was vetoed by a gate that only delays it. True when it was asked for again: at once with the authored skip after a rung veto the beat did
   * not already carry, or in `retryMs` after a spacing veto while the deadline has not passed. False for every other veto, and for these once nothing is left to try.
   */
  private forceAgain(beat: Extract<ScenarioBeat, { kind: "act" }>, force: NonNullable<BeatPlayerDeps["force"]>, decision: Extract<DramaDecision, { kind: "veto" }>, attempt: number): boolean {
    if (decision.reason === "ladder" && decision.detail === "rung" && beat.authored_skip !== true && !this.skipped.has(beat.id) && this.d.drama.canSkip) {
      this.skipped.add(beat.id);
      this.schedule(beat, 0, () => this.play(beat, attempt + 1));
      return true;
    }
    if (decision.reason === "budget" && decision.detail === "physical" && this.d.clock.now() < this.startedAt + force.untilMs) {
      this.schedule(beat, force.retryMs ?? 1000, () => this.play(beat, attempt + 1));
      return true;
    }
    return false;
  }

  /**
   * GATE-7 vetoed an authored contact verb: the pair is apart. Walk them together and ask again, until they are adjacent (the gate then says yes), the
   * window ends, or the scene is cut. Only a distance veto comes here; no other gate is cured by walking, so none is retried.
   */
  private closeIn(beat: Extract<ScenarioBeat, { kind: "act" }>, port: DramaDecisionPort, attempt: number, decision: DramaDecision): void {
    const now = this.d.clock.now();
    const walk = this.walking.get(beat.id) ?? { since: now, scene: port.scene, walkedAt: Number.NEGATIVE_INFINITY };
    // Without a way to walk, or without a target to walk to, a distance veto is as final as any other.
    if (!this.d.walkCloser || beat.with === undefined) return this.settle(beat, "dropped", "veto:too_far", { decision });
    // A forced beat keeps walking up to its deadline, not only for the usual window.
    const end = Math.max(walk.since + this.tuning.walkWindowMs, this.d.force?.id === beat.id ? this.startedAt + this.d.force.untilMs : 0);
    if (now >= end) return this.settle(beat, "dropped", "veto:too_far", { decision, detail: "retry_window_expired" });
    if (now - walk.walkedAt >= this.tuning.walkRepathMs && this.d.walkCloser(beat.actor, beat.with)) walk.walkedAt = now;
    this.walking.set(beat.id, walk);
    // Never past the window's end: the last ask is made when it closes, so the drop is not a retry's delay late.
    const wait = Math.min(this.tuning.walkRetryMs, Math.max(0, end - now));
    this.schedule(beat, wait, () => this.play(beat, attempt));
  }

  private playCut(beat: Extract<ScenarioBeat, { kind: "cut" }>, port: DramaDecisionPort, attempt: number): void {
    const before = port.scene;
    const advance = port.advanceScene(beat.reason);
    switch (advance.kind) {
      case "sent":
        if (!this.confirming.has(beat.id)) this.settle(beat, "played", "sent", { advance });
        this.confirming.add(beat.id);
        // The hotel answers a refused cut with nothing (SCENE-4): if the scene is still the same after the pending window, ask again, a few times.
        return this.schedule(beat, this.tuning.cutVerifyMs, () => this.confirm(beat, before, attempt + 1));
      case "refused":
        if (advance.why === "inert") return this.giveUp(beat, "inert", advance);
        if (attempt + 1 >= this.tuning.cutAttempts) return this.giveUp(beat, `refused:${advance.why}`, advance);
        return this.schedule(beat, Math.max(advance.retryInMs ?? 0, 0) + this.tuning.cutRetryPadMs, () => this.play(beat, attempt + 1));
      default: {
        const unhandled: never = advance;
        return unhandled;
      }
    }
  }

  /** A cut that was sent: the scene changed (done), or it did not and is asked again while attempts last. */
  private confirm(beat: Extract<ScenarioBeat, { kind: "cut" }>, before: string, attempt: number): void {
    const port = this.d.port();
    if (!port?.active || port.scene !== before) {
      this.confirming.delete(beat.id);
      return;
    }
    if (attempt >= this.tuning.cutAttempts) return this.giveUp(beat, "no_scene_cut");
    this.playCut(beat, port, attempt);
  }

  /** A cut that cannot be had: dropped, unless it was already sent once, in which case it only stops being asked (and says so). */
  private giveUp(beat: Extract<ScenarioBeat, { kind: "cut" }>, why: string, advance?: SceneAdvance): void {
    if (this.confirming.delete(beat.id)) {
      this.log.warn("an authored scene cut never arrived", { beat: beat.id, why });
      return;
    }
    this.settle(beat, "dropped", why, advance ? { advance } : {});
  }

  /** The beat is settled, once: played or dropped, and no timer of it is left. */
  private settle(beat: ScenarioBeat, outcome: BeatReport["outcome"], why: string, extra: Pick<BeatReport, "decision" | "advance" | "detail"> = {}): void {
    this.done.add(beat.id);
    this.walking.delete(beat.id);
    if (!this.confirming.has(beat.id)) {
      this.timers.get(beat.id)?.timer?.cancel();
      this.timers.delete(beat.id);
    }
    const report: BeatReport = { beat, at: this.d.clock.now(), outcome, why, ...extra };
    if (outcome === "dropped") this.log.info("authored beat dropped", { beat: beat.id, kind: beat.kind, why, ...(extra.detail ? { detail: extra.detail } : {}) });
    this.d.onReport?.(report);
  }
}
