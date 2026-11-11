import { TrackFileSink } from "../director/cine/index.js";
import { DramaLog } from "../director/drama/decision-log.js";
export { DRAMA_LOG_FILE } from "./artifacts.js";

/**
 * The run's drama decision log, `drama-log.jsonl` beside `events.jsonl` (registered as `drama_log`, errata P9): one JSON line per consult of the drama planner, so
 * "why did the unlock not become a blow?" has an answer after the run. The counters in `replay.json` say how often the spine opened the ladder; this says what the
 * director saw at each consult of the actor it opened it for. For the operator only: no replay, player or web client reads it, and nothing in a run depends on it.
 * `PERFECTMAN_DRAMA_LOG=0` turns it off for the process. A run whose drama planner was never consulted (drama off, not negotiated) writes no file.
 * The line format is in `director/drama/decision-log.ts` and `docs/plans/script-likeness.md`.
 */
export const dramaLogEnabled = (): boolean => process.env["PERFECTMAN_DRAMA_LOG"] !== "0";

/** The log of a run, writing to `file`; a failed write is reported once and never thrown into a pulse. `flush` waits for every write. */
export class RunDramaLog {
  readonly log: DramaLog;
  private readonly sink: TrackFileSink;

  constructor(file: string, sinceStartMs: () => number, onError?: (err: unknown) => void) {
    this.sink = new TrackFileSink(file, onError);
    this.log = new DramaLog(this.sink.write, sinceStartMs);
  }

  /** The run is over: the stretches of identical consults still going are closed with their counts, and every write is waited for. */
  flush(): Promise<void> {
    this.log.close();
    return this.sink.flush();
  }
}
