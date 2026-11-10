import { GUARD_LOG_RULE } from "@perfectman/server/hotel";
import type { GuardInfo, GuardKind, GuardLogRule } from "@perfectman/server/hotel";
import { TrackFileSink } from "../director/cine/index.js";

/**
 * The run's guard log, `guard-log.jsonl` beside `events.jsonl` (registered as `guard_log`): one JSON line per thing a guard did to an actor's line, so
 * "why did she say that?" and "why was nothing said?" have an answer after the run. The counters in `replay.json` say how often; this says to which text.
 * For the operator only: no replay, player or web client reads it. `PERFECTMAN_GUARD_LOG=0` turns it off for the process; a run in which no guard acted writes no file.
 */
export type GuardLogLine = {
  /** Milliseconds from the run's start. */
  t_ms: number;
  /** The actor's display name. */
  actor: string;
  rule: GuardLogRule;
  /** The text the guard was given: the line it retried, cut, struck or silenced; the line a note answered; empty when there was none. */
  before: string;
  /** The text it left, or the note it added; empty for a line that was silenced or dropped. */
  after: string;
};

export const guardLogEnabled = (): boolean => process.env["PERFECTMAN_GUARD_LOG"] !== "0";

/** One log line, or undefined for a kind of guard event that changes no line (the stall nudge, a held line dropped on release). */
export function guardLogLine(tMs: number, kind: GuardKind, info: GuardInfo | undefined): string | undefined {
  const rule = GUARD_LOG_RULE[kind];
  if (rule === undefined) return undefined;
  const line: GuardLogLine = { t_ms: Math.max(0, Math.round(tMs)), actor: info?.actor ?? "", rule, before: info?.before ?? "", after: info?.after ?? "" };
  return JSON.stringify(line);
}

/** Appends the log as the run goes (writes are chained, a failed one is reported once and never thrown into a pulse). */
export class GuardLog {
  private readonly sink: TrackFileSink;

  constructor(file: string, private readonly sinceStartMs: () => number, onError?: (err: unknown) => void) {
    this.sink = new TrackFileSink(file, onError);
  }

  record(kind: GuardKind, info: GuardInfo | undefined): void {
    const line = guardLogLine(this.sinceStartMs(), kind, info);
    if (line !== undefined) this.sink.write(line);
  }

  flush(): Promise<void> {
    return this.sink.flush();
  }
}
