import type { ActVerb } from "@perfectman/shared";

/**
 * The drama decision log (errata P9): one compact line per consult of `DramaBody.planFor` (and of the follow and climb-watch timers), so "why did the unlock
 * not become a blow?" has an answer after the run. For the operator only: nothing reads it back, nothing is sent, no behaviour depends on it. The run writes it to
 * `drama-log.jsonl` (`run/drama-log.ts`); a sim keeps the lines in memory.
 */

/** `originate`: the body asked the director for a beat of its own. `propose`: the model's `act` (or a hug or kiss) went to the director. `continue`: a timer asked again (a follow tick or a climb watch). `skip`: the body did not ask the director at all. `hotel`: the hotel answered an act of an own actor: `started`, `done:<outcome>` or `blocked:<reason>[/<detail>]` (a refusal the director's own gates did not foresee). */
export type DramaLogKind = "originate" | "propose" | "continue" | "skip" | "hotel";

/**
 * What came of the consult. `act`: a beat was sent. `blocked:<code>[/<detail>]`: the director or a gate refused a proposal (`blocked:ladder/motive`) or the best candidate
 * of an origination (`blocked:too_far/distance` for a pair that needs an approach is `far`). `pace`: the director's own pace held it. `no_candidates`: nobody it could
 * aim at. `no_emotion`: the body had no feelings to ask with. `far`: motivated, the only thing missing is the distance (an `approach` was returned). `busy`: the actor
 * holds an act, a lock, or is dead. `not_asked`: the body did not ask the director to originate because the model proposed (`reason: model_proposed`) or an earlier proposal of
 * the same consult already held the actor (`reason: held`).
 */
export type DramaLogResult = string;

export type DramaLogEntry = {
  /** The actor's `person-N` ref. */
  actor: string;
  kind: DramaLogKind;
  /** `person-3>person-2`: who the line is about. For a `skip` it is the pair an open unlock names, when the actor holds one. */
  pair?: string;
  verb?: ActVerb;
  /** The verb's ladder rung. */
  rung?: number;
  /** The volition and its threshold for that verb toward that person, two decimals. */
  v?: number;
  theta?: number;
  /** The top rung the scene spine has opened for `pair`, 0 when none (errata P8). */
  unlocked: number;
  /** The unlock the actor holds right now, whoever the line is about: `person-3>person-2@3` (the aggressor, the person it may go for, the top rung). Absent when it holds none. */
  unlock?: string;
  /** What the actor holds against that person: the strongest of resentment, envy and suspicion, two decimals. */
  grievance?: number;
  /** The grievance the cast's talk built toward that person (errata P7), two decimals. */
  provocation?: number;
  /** Chebyshev distance in tiles between the two. */
  dist?: number;
  /** Proposals the model made in this consult. */
  queue: number;
  /** The consult already held the actor (an act was approved or started) when this line was written. */
  hold: boolean;
  result: DramaLogResult;
  reason?: string;
};

export type DramaLogLine = DramaLogEntry & {
  /** Milliseconds from the run's start. */
  t_ms: number;
  /** Identical consults of this actor and kind dropped just before this line (idle ones are written once per run of them). */
  same?: number;
};

/** The most lines a run keeps: a 45-minute run with three actors consulted every pulse writes far fewer once identical consults collapse. */
export const DRAMA_LOG_CAP = 2000;

const num = (n: number | undefined): number | undefined => (n === undefined || !Number.isFinite(n) ? undefined : Math.round(n * 100) / 100);

/** The key two consults share when they say the same thing: the numbers that drift (`v`, `theta`, `dist`, `provocation`, `grievance`) are left out. */
function signature(e: DramaLogEntry): string {
  return JSON.stringify([e.actor, e.kind, e.pair ?? null, e.verb ?? null, e.rung ?? null, e.unlocked, e.unlock ?? null, e.queue, e.hold, e.result, e.reason ?? null]);
}

/** One line as written, keys in a fixed order, undefined fields left out. */
export function dramaLogLine(tMs: number, e: DramaLogEntry, same: number): string {
  const line: DramaLogLine = {
    t_ms: Math.max(0, Math.round(tMs)),
    actor: e.actor,
    kind: e.kind,
    ...(e.pair !== undefined ? { pair: e.pair } : {}),
    ...(e.verb !== undefined ? { verb: e.verb } : {}),
    ...(e.rung !== undefined ? { rung: e.rung } : {}),
    ...(e.v !== undefined ? { v: num(e.v)! } : {}),
    ...(e.theta !== undefined ? { theta: num(e.theta)! } : {}),
    unlocked: e.unlocked,
    ...(e.unlock !== undefined ? { unlock: e.unlock } : {}),
    ...(e.grievance !== undefined ? { grievance: num(e.grievance)! } : {}),
    ...(e.provocation !== undefined ? { provocation: num(e.provocation)! } : {}),
    ...(e.dist !== undefined ? { dist: e.dist } : {}),
    queue: e.queue,
    hold: e.hold,
    result: e.result,
    ...(e.reason !== undefined ? { reason: e.reason } : {}),
    ...(same > 0 ? { same } : {}),
  };
  return JSON.stringify(line);
}

/**
 * The writer: collapses a run of identical consults of one actor and kind into the first (a consult that sent an act is always written), counts what it dropped and
 * writes the count on the next line of that actor and kind (`same`) or, for a run still going at the end, on one last line (`close`), and stops at `cap` lines with one last
 * `log_capped` line. `emit` takes the finished line (no newline).
 */
export class DramaLog {
  private readonly last = new Map<string, { sig: string; dropped: number; entry: DramaLogEntry }>();
  private written = 0;
  /** Lines dropped as identical to the one before them, and lines dropped after the cap, for the run's counters. */
  dropped = 0;
  capped = false;

  constructor(
    private readonly emit: (line: string) => void,
    private readonly sinceStartMs: () => number,
    private readonly cap: number = DRAMA_LOG_CAP,
  ) {}

  get lines(): number {
    return this.written;
  }

  record(entry: DramaLogEntry): void {
    if (this.capped) {
      this.dropped++;
      return;
    }
    const key = `${entry.actor}|${entry.kind}`;
    const sig = signature(entry);
    const prev = this.last.get(key);
    if (entry.result !== "act" && prev?.sig === sig) {
      prev.dropped++;
      this.dropped++;
      return;
    }
    if (this.written >= this.cap - 1) {
      this.capped = true;
      this.emit(dramaLogLine(this.sinceStartMs(), { actor: entry.actor, kind: "skip", unlocked: 0, queue: 0, hold: false, result: "log_capped", reason: `cap ${this.cap}` }, 0));
      this.written++;
      this.dropped++;
      return;
    }
    this.emit(dramaLogLine(this.sinceStartMs(), entry, prev?.dropped ?? 0));
    this.last.set(key, { sig, dropped: 0, entry });
    this.written++;
  }

  /**
   * The run is over: every run of identical consults that was still going is written once more, with the count of the ones dropped since its first line, so a log that ends
   * in a stretch of the same answer says how long it went on. Nothing is written after the cap or a second time.
   */
  close(): void {
    if (this.capped) return;
    for (const [key, run] of this.last) {
      if (run.dropped === 0) continue;
      if (this.written >= this.cap) break;
      this.emit(dramaLogLine(this.sinceStartMs(), run.entry, run.dropped));
      this.written++;
      this.last.set(key, { ...run, dropped: 0 });
    }
  }
}
