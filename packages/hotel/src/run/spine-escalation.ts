import { BEAT_CRAFT_MAX_CHARS } from "@perfectman/shared";
import type { Spine, SpineAdvance } from "@perfectman/shared";
import type { DramaBody } from "../embodiment/drama-body.js";
import type { SceneSpine } from "./scene-recorder.js";

/**
 * The scene spine's coupling to the ladder (errata P8). The spine alone writes steering notes; it knew nothing of who had been heard threatening whom, so a scene
 * whose cast blackmailed and accused each other for ten minutes never got a blow: the spine reached its decision, the ladder's grievance and volition gates stayed shut.
 *
 * Here the spine's turn (step 2) and decision (step 3) ask the body to open the ladder (`DramaBody.escalate`): at the turn the shove, at the decision the slap, for the
 * person the hostile lines were about toward the person who said them, and only when the cast was heard heating up (`DramaTuning.provocation.unlock`). A step that finds no
 * evidence opens nothing and is counted. A hostile line said after the step is looked at too (`onLine`): the heat of run 60 came minutes after its spine had reached the
 * decision. The aggressor's next prompt carries one line (`craftFor`) while the unlock lasts. The climb is the director's: one rung per beat, 25 s apart, the witness rule,
 * the spacing, the cooldown. Never the punch or the kill, never a human, nothing when drama is off or the scene has authored beats (the spine does not exist then).
 *
 * `PERFECTMAN_SPINE_ESCALATE=0` restores the spine that writes notes and opens nothing.
 */

/** `PERFECTMAN_SPINE_ESCALATE=0` turns the coupling off for the process; anything else leaves it on. */
export const SPINE_ESCALATE_ENV = "PERFECTMAN_SPINE_ESCALATE";
export const spineEscalateEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env[SPINE_ESCALATE_ENV]?.trim() !== "0";

/** The spine's steps that open a rung: the turn the shove, the decision the slap. */
export const TURN_STEP = 2;
export const DECISION_STEP = 3;

export class SpineEscalation {
  private scene: SceneSpine | undefined;
  private looking = false;
  private readonly holders: string[];

  constructor(
    private readonly body: DramaBody,
    spine: Spine,
    private readonly language: "pt-BR" | "en",
  ) {
    this.holders = Object.entries(spine.roles).filter(([, role]) => role === "holder").map(([id]) => id);
  }

  /** The spine this looks at; set once, after the spine is built with `onAdvance`. */
  attach(scene: SceneSpine): void {
    this.scene = scene;
  }

  /** For `SceneSpine`'s `onAdvance`: the spine has moved into a step. Its turn and decision look at the cast. */
  readonly onAdvance = (a: SpineAdvance): void => {
    if (a.step >= TURN_STEP) this.look(true);
  };

  /**
   * A hostile line was said (the run calls this after it handed the line to the body): once the arc has reached its turn, look at whether the cast has now earned what the
   * step opens. Brings the arc up to the clock first, so a step that is due is not missed for want of a prompt.
   */
  onLine(now: number): void {
    const scene = this.scene;
    if (!scene) return;
    const before = scene.step;
    scene.advance(now);
    if (scene.step === before && scene.step >= TURN_STEP) this.look(false);
  }

  /**
   * One look. At the decision the slap is tried first and the shove after it; at the turn only the shove. `entering` is the spine reaching a step (a miss is counted once for
   * it), not a later look (a miss is not counted again).
   */
  private look(entering: boolean): void {
    if (this.looking) return;
    this.looking = true;
    try {
      const step = this.scene?.step ?? 0;
      const levels = step >= DECISION_STEP ? (["slap", "shove"] as const) : (["shove"] as const);
      for (const level of levels) {
        // A miss at the last level is the step's miss; the first of two levels only falls through.
        const last = level === levels[levels.length - 1];
        if (this.body.escalate(level, this.holders, entering && last) !== "none") return;
      }
    } finally {
      this.looking = false;
    }
  }

  /** The note for `actorId` with the unlock line, when it is the aggressor of an open one, ahead of the spine's own note and inside the beat-craft budget. */
  craftFor(actorId: string, base: string | undefined): string | undefined {
    const line = this.body.unlockNote(actorId, this.language);
    if (line === undefined) return base;
    if (base === undefined || base === "") return line.slice(0, BEAT_CRAFT_MAX_CHARS);
    const room = BEAT_CRAFT_MAX_CHARS - line.length - 1;
    if (room <= 0) return line.slice(0, BEAT_CRAFT_MAX_CHARS);
    const tail = base.length <= room ? base : `${base.slice(0, Math.max(0, room - 1)).replace(/[\s,;:.]+$/u, "")}…`;
    return `${line} ${tail}`;
  }

  /** What the run's manifest says about it (`scene_spine.unlocks`): the grants with when (ms on the run clock) and why, and the counts. */
  manifest(startedAt: number): { shove: number; slap: number; skipped_no_evidence: number; grants: Array<{ at_ms: number; level: string; aggressor: string; target: string; why: string }> } {
    const c = this.body.counters();
    return {
      shove: c["spine_unlock_shove"] ?? 0,
      slap: c["spine_unlock_slap"] ?? 0,
      skipped_no_evidence: c["spine_unlock_skipped_no_evidence"] ?? 0,
      grants: this.body.unlockLog.map((g) => ({ at_ms: g.at - startedAt, level: g.level, aggressor: g.observer, target: g.offender, why: g.why })),
    };
  }
}
