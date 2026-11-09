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
  /** The run clock's zero: the second a beat's `at_ms` counts from. Default: the clock when the player is built. */
  startedAt?: number;
  /** Beat ids already played, for a player rebuilt over the same body (a resume). They are never played again. */
  played?: Iterable<string>;
  tuning?: DramaTuning["beats"];
  logger?: Logger;
  onReport?: (report: BeatReport) => void;
};

type Pending = { timer: TimerHandle | undefined };

/**
 * The scenario's script, played by the production path (errata P4-01). The contract has the director veto a model's `kill` by design (LAD-5:
 * mortality is authored), so in a run a kill happens only here: a beat of `body.beats` is scheduled on the run's clock and handed to the
 * `DramaDirector` as a scenario-origin act (`origin:"scenario"`, `authored_skip` where the author wrote `skip`). It is still subject to
 * `may_target`, `may_die`, `max_rung` and every hotel gate (SCN-3, SCN-4, GATE-1 to GATE-10); the director runs them. A beat they veto is
 * logged and dropped, never retried: the one wait is for an actor that is busy with an act of its own, which is not a gate. A cut goes to
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
  /** Cuts that were sent and whose scene_cut has not been seen yet. */
  private readonly confirming = new Set<string>();
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
    if (actor === undefined) return this.settle(beat, "dropped", "not_placed");
    if (beat.with !== undefined && target === undefined) return this.settle(beat, "dropped", "target_gone");
    if (beat.verb === "kill") {
      // The kill rules, held here too so a beat that can never be allowed is not even asked (SCN-1, SCN-3, LAD-4).
      if (this.d.drama.freePlay) return this.settle(beat, "dropped", "free_play");
      if (beat.with === undefined || !this.d.drama.effective.may_die.includes(beat.with)) return this.settle(beat, "dropped", "may_die");
      if (this.killedIn.has(port.scene)) return this.settle(beat, "dropped", "kill_budget");
    }
    const decision = port.decide({
      actor,
      proposal: { verb: beat.verb, ...(target !== undefined ? { with: target } : {}), origin: "scenario", ...(beat.authored_skip === true ? { authoredSkip: true } : {}) },
    });
    switch (decision.kind) {
      case "approve":
      case "initiate":
        if (beat.verb === "kill") this.killedIn.add(port.scene);
        return this.settle(beat, "played", "approve", { decision });
      case "veto":
        return this.settle(beat, "dropped", `veto:${decision.reason}`, { decision });
      case "pass":
        // The actor is in the middle of an act of its own: wait for it, a little. Nothing was asked of any gate yet.
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
  private settle(beat: ScenarioBeat, outcome: BeatReport["outcome"], why: string, extra: Pick<BeatReport, "decision" | "advance"> = {}): void {
    this.done.add(beat.id);
    if (!this.confirming.has(beat.id)) {
      this.timers.get(beat.id)?.timer?.cancel();
      this.timers.delete(beat.id);
    }
    const report: BeatReport = { beat, at: this.d.clock.now(), outcome, why, ...extra };
    if (outcome === "dropped") this.log.info("authored beat dropped", { beat: beat.id, kind: beat.kind, why });
    this.d.onReport?.(report);
  }
}
