import { TrackFileSink } from "../director/cine/index.js";
import type { HumanLogEntry } from "../embodiment/human/types.js";
export { BODY_LOG_FILE } from "./artifacts.js";

/**
 * The human layer's body log, `body-log.jsonl` beside `events.jsonl` (registered as `body_log`, cinematic revamp B5): one JSON line per thing the layer decided, with
 * the rule that decided it (`approach:cool`, `avert:shame`, `backchannel:tilt`, `interrupt`, `typing`), so the scorer and the operator can read why a body did what it did.
 * Also lines for what it held back (`skipped`). For the operator and the eval only; nothing in a run reads it back. `PERFECTMAN_BODY_LOG=0` turns it off for the process;
 * a run at human_likeness 0 writes no file. The line format is `HumanLogLine` below.
 */
export const bodyLogEnabled = (): boolean => process.env["PERFECTMAN_BODY_LOG"] !== "0";

export type HumanLogLine = HumanLogEntry & {
  /** Milliseconds from the run's start. */
  t_ms: number;
};

export class RunBodyLog {
  private readonly sink: TrackFileSink;

  constructor(file: string, private readonly sinceStartMs: (at: number) => number, onError?: (err: unknown) => void) {
    this.sink = new TrackFileSink(file, onError);
  }

  write = (entry: HumanLogEntry & { at: number }): void => {
    const { at, ...rest } = entry;
    const line: HumanLogLine = { t_ms: Math.max(0, Math.round(this.sinceStartMs(at))), ...rest };
    this.sink.write(JSON.stringify(line));
  };

  flush(): Promise<void> {
    return this.sink.flush();
  }
}
