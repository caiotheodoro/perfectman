import { MAJOR_KINDS, ProgressTracker, SCRIPT_NORMS, SpineClock, buildSpine, mergeTurns, scoreTurns, turnsFromBodyFrames } from "@perfectman/shared";
import type { ReplayManifest } from "./artifacts.js";
import type { BodyFrame, ScriptLang, ScriptMedium, ScriptNorms, ScriptScore, ScriptTurn, Spine, SpineAdvance, SpineEvents, SpineInput } from "@perfectman/shared";

/**
 * What the actors said and did in this run, as the script-likeness metrics read it: the lines the actors committed (a guest's line is not an
 * actor's turn and is left out), and the moves, sits, gestures and acts their bodies made. Kept in order, with the run clock in ms from the run's
 * start, and tracked live for new facts and moves that change the scene (the scene spine gates on them) and for the run's score at the end.
 */
export class SceneRecorder {
  readonly turns: ScriptTurn[] = [];
  private readonly tracker: ProgressTracker;
  private readonly any: number[] = [];
  private readonly major: number[] = [];

  constructor(names: Iterable<string>) {
    this.tracker = new ProgressTracker({ names });
  }

  private note(atMs: number, from: number): void {
    for (const e of this.tracker.events.slice(from)) {
      this.any.push(atMs);
      if (MAJOR_KINDS.has(e.kind)) this.major.push(atMs);
    }
  }

  say(speaker: string, text: string, atMs: number): void {
    const t: ScriptTurn = { speaker, text, kind: "say", atMs };
    this.turns.push(t);
    const before = this.tracker.events.length;
    this.tracker.push(t);
    this.note(atMs, before);
  }

  act(speaker: string, atMs: number): void {
    const t: ScriptTurn = { speaker, text: "", kind: "act", atMs };
    this.turns.push(t);
    const before = this.tracker.events.length;
    this.tracker.push(t);
    this.note(atMs, before);
  }

  /** Times of what was new and what moved the scene, as the spine reads them. */
  get events(): SpineEvents {
    return { any: this.any, major: this.major };
  }

  /** Script-likeness of what was recorded, with the run's walks and sits from the frame log joined to the lines (the lines' own acts are replaced by them). */
  score(opts: { norms: ScriptNorms; language: ScriptLang; medium: ScriptMedium; frames: readonly BodyFrame[]; startedAt: number }): ScriptScore {
    const say = this.turns.filter((t) => t.kind !== "act");
    const acts = turnsFromBodyFrames(opts.frames).map((t) => (t.atMs === undefined ? t : { ...t, atMs: t.atMs - opts.startedAt }));
    return scoreTurns(mergeTurns(say, acts), { norms: opts.norms, language: opts.language, medium: opts.medium, names: [...new Set(say.map((t) => t.speaker))] });
  }
}

/** The scene spine of a run that has no authored beats: the notes it shows each actor, advancing on what the recorder saw. */
export class SceneSpine {
  private readonly clock: SpineClock;

  constructor(
    readonly spine: Spine,
    private readonly recorder: SceneRecorder,
    private readonly startedAt: number,
    /** Called for each step the arc moves into (errata P8), with the run clock; the run uses it to open the ladder at the turn and the decision. */
    onAdvance?: (advance: SpineAdvance) => void,
  ) {
    this.clock = new SpineClock(spine, undefined, onAdvance);
  }

  /** The note for this actor at this run-clock time, or undefined. Advancing the arc is idempotent per instant. */
  textFor(actorId: string, now: number): string | undefined {
    return this.clock.textFor(actorId, now - this.startedAt, this.recorder.events);
  }

  /** Moves the arc on as far as the rules allow at this run-clock time and says which step is current (errata P8: the run looks when a hostile line is said, not only when a prompt is built). */
  advance(now: number): number {
    return this.clock.advance(now - this.startedAt, this.recorder.events);
  }

  get step(): number {
    return this.clock.step;
  }

  get advances(): readonly SpineAdvance[] {
    return this.clock.advances;
  }
}

/** Builds the spine of a scene (`@perfectman/shared`): kept here so the run imports one module for the scene's script side. */
export const buildSceneSpine = (input: SpineInput): Spine | undefined => buildSpine(input);

/** `PERFECTMAN_SCRIPT_GUARD=0` turns the script checks (length, novelty, motif, question debt) off for the process; anything else leaves them on. */
export const SCRIPT_GUARD_ENV = "PERFECTMAN_SCRIPT_GUARD";
export const scriptGuardEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env[SCRIPT_GUARD_ENV]?.trim() !== "0";

/** `PERFECTMAN_SCENE_SPINE=0` turns the scene spine off for the process; anything else leaves it on. */
export const SCENE_SPINE_ENV = "PERFECTMAN_SCENE_SPINE";
export const sceneSpineEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env[SCENE_SPINE_ENV]?.trim() !== "0";

/** The run's script-likeness as it goes into `replay.json` and the end-of-run log: the score, where it sits among real beats, the sub-scores, and what the norms were. */
export function scriptLikenessManifest(s: ScriptScore): NonNullable<ReplayManifest["script_likeness"]> {
  return {
    score: s.score,
    percentile: s.percentile,
    verdict: s.score >= 80 ? "script-like" : s.score >= 60 ? "borderline" : "not script-like",
    sub: Object.fromEntries(Object.entries(s.sub).map(([k, v]) => [k, v ?? 0])),
    worst_window: s.worst,
    windows: s.windows.length,
    say_turns: s.sayTurns,
    language: s.language,
    medium: s.medium,
    medium_fallback: s.mediumFallback,
    low_n: s.lowN,
    motifs: s.stats.motifs.filter((m) => m.family !== "word").length,
    unanswered_questions: s.stats.debt.unanswered,
    ...(SCRIPT_NORMS.built !== undefined ? { norms_built: SCRIPT_NORMS.built } : {}),
  };
}
