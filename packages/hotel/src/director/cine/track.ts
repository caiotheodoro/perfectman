/**
 * The director track (D39): the time-ordered list of cues, lines, cuts and
 * pauses the Director produced, one JSON object per line. Metrics and replay
 * read it back; nothing else is needed to judge the film.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TrackEntry } from "./types.js";

export class TrackRecorder {
  readonly entries: TrackEntry[] = [];

  constructor(private readonly sink?: (line: string) => void) {}

  add(entry: TrackEntry): void {
    this.entries.push(entry);
    this.sink?.(JSON.stringify(entry));
  }

  /** Entries in playback order. Cues carry their effective time, so they are appended slightly out of order. */
  sorted(): TrackEntry[] {
    return [...this.entries].sort((a, b) => a.t - b.t);
  }

  toJsonl(): string {
    return this.sorted().map((e) => JSON.stringify(e)).join("\n") + "\n";
  }
}

export function parseTrack(jsonl: string): TrackEntry[] {
  return jsonl
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as TrackEntry);
}

/** Appends track lines to a file in order; a failed write is reported once and never thrown into playback. */
export class TrackFileSink {
  private chain: Promise<void> = Promise.resolve();
  private started = false;
  private failed = false;

  constructor(private readonly file: string, private readonly onError?: (err: unknown) => void) {}

  readonly write = (line: string): void => {
    const first = !this.started;
    this.started = true;
    this.chain = this.chain.then(async () => {
      try {
        if (first) await mkdir(dirname(this.file), { recursive: true });
        await appendFile(this.file, `${line}\n`);
      } catch (err) {
        if (!this.failed) this.onError?.(err);
        this.failed = true;
      }
    });
  };

  flush(): Promise<void> {
    return this.chain;
  }
}
