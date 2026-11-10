import { classifyHostility } from "./hostility.js";
import type { HostilityKind } from "./hostility.js";
import type { DramaTuning } from "./tuning.js";

/**
 * The grievance the cast's own talk builds (errata P7). One ledger per run: `note` reads a spoken line and raises the level of whoever it was about toward
 * the speaker; `levelOf` is what the drama director reads as `rel.provocation` (`DramaTuning.provocation` says how it is counted, capped and decays).
 *
 * Rules, all deterministic, no model: only the ordered pairs the scenario lets (`allow`: both actors of the run, the offended one allowed to target the speaker,
 * never a human, never `drama: off`); a line is about whoever it names, else about whoever it is addressed to; a line counts once by its strongest kind; the
 * same pair counts a second line only `minGapMs` after the first (one outburst is one provocation); the level falls to 0 over `windowMs` and stops at `cap`.
 * The ledger never starts an act. It only gives the director's ladder the grievance it was missing.
 */

export type SpokenLine = {
  /** Wire ref of the speaker (`person-1`). */
  speaker: string;
  content: string;
  /** Refs the line is addressed to (the reply's author, a named target, whoever the words call by name when they share the room). */
  addressees: readonly string[];
  /** Refs the words name. */
  mentioned: readonly string[];
  /** `say`, `shout` or `whisper`; a shout carries to the room. */
  mode?: "say" | "shout" | "whisper";
};

/** How one person stands to the line: heard it clearly, or is in the room but did not (behind their back). Out of the room is not listed. */
export type Listener = { ref: string; heard: boolean };

type Entry = { level: number; at: number };

export class ProvocationLedger {
  private readonly pairs = new Map<string, Entry>();
  /** Counted lines, by kind (`insult`, `threat`, ...), and the lines a cap, a gap or the pair rule left uncounted. */
  readonly raised: Record<HostilityKind, number> = { insult: 0, threat: 0, challenge: 0, mockery: 0 };
  /** Lines that were hostile and moved nobody: the pair is not allowed, or the gap was not over. Counted so a run says what it left out. */
  skipped = 0;

  constructor(
    private readonly tuning: () => DramaTuning["provocation"],
    private readonly now: () => number,
    /** `observer` may hold a grievance against `offender`: both are the run's own actors, `observer` may target `offender`, and drama is not off. */
    private readonly allow: (observer: string, offender: string) => boolean,
  ) {}

  /** The grievance of `observer` toward `offender` now: 0 to `cap`, falling to 0 over the window from the last counted line. */
  levelOf(observer: string, offender: string): number {
    const e = this.pairs.get(`${observer}>${offender}`);
    if (!e) return 0;
    const t = this.tuning();
    const left = 1 - (this.now() - e.at) / t.windowMs;
    return left <= 0 ? 0 : Math.round(Math.min(t.cap, e.level * left) * 1000) / 1000;
  }

  /** Everyone `observer` holds a live grievance against. */
  offenders(observer: string): string[] {
    const out: string[] = [];
    for (const key of this.pairs.keys()) {
      const [o, s] = key.split(">") as [string, string];
      if (o === observer && this.levelOf(o, s) > 0) out.push(s);
    }
    return out;
  }

  /** When the last counted line of this pair was said, or undefined. */
  lastAt(observer: string, offender: string): number | undefined {
    return this.pairs.get(`${observer}>${offender}`)?.at;
  }

  /** The total of counted lines. */
  get total(): number {
    return this.raised.insult + this.raised.threat + this.raised.challenge + this.raised.mockery;
  }

  /**
   * One line spoken. `listeners` are the actors in the speaker's room other than the speaker, each with whether they heard it clearly. Returns the kind that
   * was counted, or undefined when the line was not hostile or moved nobody.
   */
  note(line: SpokenLine, listeners: readonly Listener[]): HostilityKind | undefined {
    const kind = classifyHostility(line.content);
    if (!kind) return undefined;
    const named = line.mentioned.filter((r) => r !== line.speaker);
    // Whoever the words name is who they are about; with no name it is about the person spoken to.
    const about = named.length > 0 ? named : line.addressees.filter((r) => r !== line.speaker);
    const t = this.tuning();
    const now = this.now();
    let counted = false;
    for (const who of new Set(about)) {
      const listener = listeners.find((l) => l.ref === who);
      // Not in the room: nobody tells them.
      if (!listener) continue;
      if (!this.allow(who, line.speaker)) {
        this.skipped++;
        continue;
      }
      const key = `${who}>${line.speaker}`;
      const prev = this.pairs.get(key);
      if (prev && now - prev.at < t.minGapMs) {
        this.skipped++;
        continue;
      }
      const heard = listener.heard || line.mode === "shout";
      const add = t.gain[kind] * (heard ? 1 : t.behindBack);
      const carried = this.levelOf(who, line.speaker);
      this.pairs.set(key, { level: Math.min(t.cap, carried + add), at: now });
      counted = true;
    }
    if (counted) this.raised[kind]++;
    return counted ? kind : undefined;
  }

  /** A scene cut starts the cast fresh. */
  clear(): void {
    this.pairs.clear();
  }
}
