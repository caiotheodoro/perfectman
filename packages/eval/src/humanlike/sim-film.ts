import { DEFAULT_CINE, ShotPlanner, lineSalience } from "@perfectman/hotel/drama";
import type { CineConfig, CineWorld, LineItem, NarrationSource, Program } from "@perfectman/hotel/drama";

/**
 * A film for the offline sim: the real shot planner (`ShotPlanner`, the one a cinematic run uses) deciding when each line's typing bubble comes up and when the line plays,
 * on the sim's clock, one program after the other. The cinematic director's buffer, narrator and camera cues are not here; only the part that sets the lines' timing and the
 * cut text of a talked-over line, so the sim can show turn-taking at human_likeness 0 and above with the production code.
 */
export type SimFilmDeps = {
  now(): number;
  setTimer(fn: () => void, ms: number): { cancel(): void };
  world: CineWorld;
  room: number;
  config?: Partial<CineConfig>;
  typing(ref: string, on: boolean): void;
  /** The human layer's walk up to the addressee before the line: how long it takes (ms), if there is one. */
  beforeLine?(line: { ref: string; text: string; to?: string }): number | undefined;
  /** The line plays: what the room sees (the cut text when it was talked over). */
  release(line: { ref: string; to?: string; text: string; mode: LineItem["mode"]; cut: boolean; full: string }): void;
};

const NARRATION: NarrationSource = { card: () => ({ title: "" }), caption: () => undefined };

export class SimFilm {
  readonly planner: ShotPlanner;
  private readonly queue: LineItem[] = [];
  private seq = 0;
  private busy = false;
  private startedAt: number;
  /** For the log: each program's start, in sim ms. */
  readonly played: Array<{ id: string; ref: string; startedAt: number; releasedAt?: number; typingAt?: number; cut: boolean }> = [];

  constructor(private readonly d: SimFilmDeps) {
    this.startedAt = d.now();
    this.planner = new ShotPlanner({ ...DEFAULT_CINE, ...d.config });
    this.planner.peek = () => this.queue[0];
  }

  /** A line the engine produced: it waits its turn on the film. */
  enqueue(line: { ref: string; to?: string; text: string; mode?: LineItem["mode"] }): void {
    const mode = line.mode ?? "say";
    const item: LineItem = {
      kind: "line",
      id: `b${++this.seq}`,
      seq: this.seq,
      at: this.d.now(),
      room: this.d.room,
      ref: line.ref,
      text: line.text,
      mode,
      ...(line.to ? { to: line.to } : {}),
      salience: lineSalience(line.text, mode, this.d.world.moodOf(line.ref)),
    };
    this.queue.push(item);
    this.kick();
  }

  private kick(): void {
    if (this.busy) return;
    const item = this.queue.shift();
    if (!item) return;
    if (this.d.config?.human && this.d.config.human.likeness > 0) {
      const walk = this.d.beforeLine?.({ ref: item.ref, text: item.text, ...(item.to ? { to: item.to } : {}) });
      if (walk !== undefined && walk > 0) item.walkMs = walk;
    }
    const program: Program | undefined = this.planner.plan(item, this.d.now() - this.startedAt, this.d.world, NARRATION);
    if (!program) return this.kick();
    this.busy = true;
    const t0 = this.d.now();
    let endTimer: { cancel(): void } | undefined;
    const rec: SimFilm["played"][number] = { id: item.id, ref: item.ref, startedAt: t0, cut: false };
    this.played.push(rec);
    for (const step of [...program.steps].sort((a, b) => a.at - b.at)) {
      const run = (): void => {
        if (step.k === "typing") {
          if (step.for !== undefined && !this.planner.stillPretyped(step.for)) return;
          this.d.typing(step.ref, step.on !== false);
          if (step.on !== false && rec.typingAt === undefined && step.ref === item.ref) rec.typingAt = this.d.now();
        } else if (step.k === "release" && step.item.kind === "line") {
          const it = step.item;
          // Talked over at the last moment (the answer is queued by now): the line trails off in a dash and the program ends early.
          const over = this.planner.talkOver(it, this.d.now() - this.startedAt, this.d.world);
          if (over) {
            it.cut = over.cut;
            endTimer?.cancel();
            endTimer = this.d.setTimer(() => {
              this.busy = false;
              this.kick();
            }, Math.max(50, over.holdMs));
          }
          rec.releasedAt = this.d.now();
          rec.cut = it.cut !== undefined;
          this.d.release({ ref: it.ref, ...(it.to ? { to: it.to } : {}), text: it.cut ?? it.text, mode: it.mode, cut: it.cut !== undefined, full: it.text });
        }
      };
      if (step.at <= 0) run();
      else this.d.setTimer(run, step.at);
    }
    endTimer = this.d.setTimer(() => {
      this.busy = false;
      this.kick();
    }, Math.max(1, program.durationMs));
  }
}
