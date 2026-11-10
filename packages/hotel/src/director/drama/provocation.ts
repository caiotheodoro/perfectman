import { readHostility } from "./hostility.js";
import type { HostilityKind } from "./hostility.js";
import { UNLOCK_MAX_RUNG } from "./pressure.js";
import type { DramaTuning } from "./tuning.js";

/**
 * The grievance the cast's own talk builds (errata P7, P8). One ledger per run: `note` reads a spoken line and raises the level of whoever it was about toward
 * the speaker; `levelOf` is what the drama director reads as `rel.provocation` (`DramaTuning.provocation` says how it is counted, capped and decays).
 *
 * Rules, all deterministic, no model: only the ordered pairs the scenario lets (`allow`: both actors of the run, the offended one allowed to target the speaker,
 * never a human, never `drama: off`); a line is about whoever it names, else about whoever it is addressed to; a line counts once by its strongest kind; the
 * same pair counts a second line only `minGapMs` after the first (one outburst is one provocation); the level falls to 0 over `windowMs` and stops at `cap`.
 * Words a line only reports ("ela te chamou de burro") are not the speaker's: they raise nothing against the messenger (P8). The ledger never starts an act. It
 * only gives the director's ladder the grievance it was missing, and, when the scene spine asks (`unlock`), the rungs it may now climb.
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

/** A counted hostile line: `observer` is who it was about (who holds the grievance), `offender` who said it. */
export type HostileEvent = { at: number; observer: string; offender: string; kind: HostilityKind };

/** The kinds that are a charge or a demand against the person (the evidence an unlock needs at least one of); a bet and a laugh alone are not. */
export const STRONG_KINDS: ReadonlySet<HostilityKind> = new Set<HostilityKind>(["insult", "threat", "blackmail", "accusation"]);

/** How far back the log of counted lines goes (a bound on memory, longer than any window a reader asks for). */
const EVENT_KEEP_MS = 300_000;

type Unlock = { rung: number; until: number };
export type UnlockLevel = "shove" | "slap";
export type UnlockResult = "granted" | "refreshed" | "skipped";

export class ProvocationLedger {
  private readonly pairs = new Map<string, Entry>();
  private readonly unlocks = new Map<string, Unlock>();
  /** Counted lines, by kind (`insult`, `threat`, ...), and the lines a cap, a gap or the pair rule left uncounted. */
  readonly raised: Record<HostilityKind, number> = { insult: 0, threat: 0, blackmail: 0, accusation: 0, challenge: 0, mockery: 0 };
  /** Lines that were hostile and moved nobody: the pair is not allowed, or the gap was not over. Counted so a run says what it left out. */
  skipped = 0;
  /** Lines that only reported hostile words and raised a small grievance of the person told against the alleged speaker (P8). */
  reportedRaised = 0;
  /** Lines whose hostile words were only reported and so counted against nobody (P8). */
  reportedIgnored = 0;
  /** Every counted hostile line, oldest first: what the scene spine reads as evidence. */
  readonly events: HostileEvent[] = [];

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

  /** Everyone `observer` holds a live grievance against, or has an unlock toward. */
  offenders(observer: string): string[] {
    const out = new Set<string>();
    for (const key of this.pairs.keys()) {
      const [o, s] = key.split(">") as [string, string];
      if (o === observer && this.levelOf(o, s) > 0) out.add(s);
    }
    for (const key of this.unlocks.keys()) {
      const [o, s] = key.split(">") as [string, string];
      if (o === observer && this.unlockedRung(o, s) !== undefined) out.add(s);
    }
    return [...out];
  }

  /** When the last counted line of this pair was said, or undefined. */
  lastAt(observer: string, offender: string): number | undefined {
    return this.pairs.get(`${observer}>${offender}`)?.at;
  }

  /** The total of counted lines. */
  get total(): number {
    const r = this.raised;
    return r.insult + r.threat + r.blackmail + r.accusation + r.challenge + r.mockery;
  }

  /**
   * One line spoken. `listeners` are the actors in the speaker's room other than the speaker, each with whether they heard it clearly. Returns the kind that
   * was counted, or undefined when the line was not hostile (or only reported hostile words) or moved nobody.
   */
  note(line: SpokenLine, listeners: readonly Listener[]): HostilityKind | undefined {
    const reading = readHostility(line.content);
    const kind = reading.own;
    if (!kind) {
      if (reading.reported) this.noteReported(line, listeners);
      return undefined;
    }
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
      this.log({ at: now, observer: who, offender: line.speaker, kind });
      counted = true;
    }
    if (counted) this.raised[kind]++;
    return counted ? kind : undefined;
  }

  /**
   * A line that only reports hostile words (P8): not the speaker's insult, so nothing against the messenger. When it names the person it says they came from
   * and says it to someone else who may target them, that someone's grievance against the alleged speaker grows by `reportedGain`.
   */
  private noteReported(line: SpokenLine, listeners: readonly Listener[]): void {
    const told = line.addressees.filter((r) => r !== line.speaker);
    const alleged = line.mentioned.filter((r) => r !== line.speaker && !told.includes(r));
    const t = this.tuning();
    const now = this.now();
    let counted = false;
    for (const who of new Set(told)) {
      const listener = listeners.find((l) => l.ref === who);
      if (!listener) continue;
      for (const from of new Set(alleged)) {
        if (!this.allow(who, from)) continue;
        const key = `${who}>${from}`;
        const prev = this.pairs.get(key);
        if (prev && now - prev.at < t.minGapMs) continue;
        const heard = listener.heard || line.mode === "shout";
        this.pairs.set(key, { level: Math.min(t.cap, this.levelOf(who, from) + t.reportedGain * (heard ? 1 : t.behindBack)), at: now });
        counted = true;
      }
    }
    if (counted) this.reportedRaised++;
    else this.reportedIgnored++;
  }

  private log(e: HostileEvent): void {
    this.events.push(e);
    const cut = e.at - EVENT_KEEP_MS;
    while (this.events.length > 0 && this.events[0]!.at < cut) this.events.shift();
  }

  /** Counted hostile lines between two people (either direction) in the last `windowMs`, and how many were said by `offender` at `observer` and are a charge or a demand. */
  evidence(observer: string, offender: string, windowMs: number): { between: number; against: number; strong: number; lastStrongAt: number | undefined } {
    const since = this.now() - windowMs;
    let between = 0;
    let against = 0;
    let strong = 0;
    let lastStrongAt: number | undefined;
    for (const e of this.events) {
      if (e.at < since) continue;
      const pair = (e.observer === observer && e.offender === offender) || (e.observer === offender && e.offender === observer);
      if (!pair) continue;
      between++;
      if (e.observer === observer && e.offender === offender) {
        against++;
        if (STRONG_KINDS.has(e.kind)) {
          strong++;
          lastStrongAt = e.at;
        }
      }
    }
    return { between, against, strong, lastStrongAt };
  }

  /**
   * The scene spine opens a rung toward `offender` for `observer` (errata P8). `level` is the top rung: `shove` (3) or `slap` (4); never more. Only a pair `allow` lets
   * (both of the run's actors, `may_target`, drama not off, never a human). It writes the pair's grievance at `unlock.provocation` (so the director considers the pair at
   * all) and an unlock that lasts `unlock.holdMs`, renewed by a later call while the evidence stands. `granted` when the pair had no unlock this high yet, `refreshed`
   * when it only renewed one, `skipped` when the pair is not allowed. It starts no act.
   */
  unlock(observer: string, offender: string, level: UnlockLevel): UnlockResult {
    if (observer === offender || !this.allow(observer, offender)) return "skipped";
    const t = this.tuning();
    const now = this.now();
    const rung = Math.min(level === "slap" ? 4 : 3, UNLOCK_MAX_RUNG);
    const key = `${observer}>${offender}`;
    const prev = this.unlockedRung(observer, offender);
    this.unlocks.set(key, { rung: Math.max(prev ?? 0, rung), until: now + t.unlock.holdMs });
    this.pairs.set(key, { level: Math.min(t.cap, Math.max(this.levelOf(observer, offender), t.unlock.provocation)), at: now });
    return prev !== undefined && prev >= rung ? "refreshed" : "granted";
  }

  /** `observer` threw a blow of `rung` at `offender`: an unlock of that rung or below has done its work and ends (one climax per unlock, errata P8). */
  consume(observer: string, offender: string, rung: number): void {
    const key = `${observer}>${offender}`;
    const u = this.unlocks.get(key);
    if (u !== undefined && rung >= u.rung) this.unlocks.delete(key);
  }

  /** The top rung the spine has opened for `observer` toward `offender` and not yet let lapse, or undefined. */
  unlockedRung(observer: string, offender: string): number | undefined {
    const u = this.unlocks.get(`${observer}>${offender}`);
    return u !== undefined && u.until > this.now() ? u.rung : undefined;
  }

  /** Who `observer` holds an open unlock against: the person and the rung (the highest first), or undefined. */
  unlockOf(observer: string): { offender: string; rung: number } | undefined {
    let best: { offender: string; rung: number } | undefined;
    for (const key of this.unlocks.keys()) {
      const [o, s] = key.split(">") as [string, string];
      const rung = o === observer ? this.unlockedRung(o, s) : undefined;
      if (rung !== undefined && (best === undefined || rung > best.rung)) best = { offender: s, rung };
    }
    return best;
  }

  /** A scene cut starts the cast fresh. */
  clear(): void {
    this.pairs.clear();
    this.unlocks.clear();
    this.events.length = 0;
  }
}
