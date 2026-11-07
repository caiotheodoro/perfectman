/**
 * Player memory (D21, D47): the actors remember the people they met, per scenario, by account id.
 *
 * The hotel owns the rows (`scenario_player_memory`, data-model.md 2.4) and the sidecar reads and writes them
 * through the internal API: `GET /internal/v1/memory?scenario=&users=1,2` when a person becomes known to a run,
 * `PUT /internal/v1/memory/{scenario}/{user}/{character}` while the run goes and when it ends. A row is a small
 * summary of what one character knows about one person (at most 4 KiB), never a transcript:
 *
 *   { v: 1, name, facts[], relationship { warmth, familiarity }, last_interaction { at, run, summary }, notes[] }
 *
 * What a person said is untrusted (D22). It is sanitized when it is noted and again when a row is read back, it
 * only ever reaches a prompt as a quoted memory ("X said ..."), and the person's account id never does.
 */
import type { Memory } from "@perfectman/shared";
import type { Clock } from "../clock/clock.js";
import type { Logger } from "../util/log.js";
import { silentLogger } from "../util/log.js";
import { sanitizeName, sanitizeText } from "../util/text.js";

/** The hotel enforces 4 KiB; the sidecar stays under it with room for the JSON it did not count. */
export const MEMORY_BODY_MAX_BYTES = 3800;
const MAX_NOTES = 6;
const MAX_FACTS = 8;
const NOTE_CHARS = 160;
const FACT_CHARS = 140;
const SEEDED_NOTES = 3;
/** One line a person says is worth a note at most this often per character, so chatter does not rotate out the rest. */
const NOTE_GAP_MS = 20_000;
const LOAD_BATCH = 25;
export const MEMORY_ID_PREFIX = "pm_player_";

export type Lang = "pt-BR" | "en";

export type PlayerMemoryBody = {
  v: 1;
  name: string;
  facts: string[];
  /** warmth -1..1 (how it went), familiarity: how many exchanges so far. */
  relationship: { warmth: number; familiarity: number };
  last_interaction: { at: number; run: number; summary: string };
  notes: string[];
};

export interface MemoryStore {
  getMemory(scenario: number, users: number[]): Promise<unknown>;
  putMemory(scenario: number, user: number, character: string, body: unknown): Promise<unknown>;
}

export type MemoryRow = { user: number; character: string; body: PlayerMemoryBody };

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const bytes = (body: PlayerMemoryBody): number => Buffer.byteLength(JSON.stringify({ body }));

export function blankBody(name: string, run: number, now: number): PlayerMemoryBody {
  return { v: 1, name, facts: [], relationship: { warmth: 0, familiarity: 0 }, last_interaction: { at: now, run, summary: "" }, notes: [] };
}

/** A row's body as the hotel stored it (a JSON string or an object), cleaned; undefined when it is not one of ours. */
export function parseBody(raw: unknown): PlayerMemoryBody | undefined {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (v === null || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (o["v"] !== 1) return undefined;
  const rel = (o["relationship"] ?? {}) as Record<string, unknown>;
  const last = (o["last_interaction"] ?? {}) as Record<string, unknown>;
  const strings = (x: unknown, max: number, chars: number): string[] =>
    (Array.isArray(x) ? x : []).filter((s): s is string => typeof s === "string").map((s) => sanitizeText(s, chars)).filter((s) => s.length > 0).slice(-max);
  const num = (x: unknown, fallback: number): number => (typeof x === "number" && Number.isFinite(x) ? x : fallback);
  return {
    v: 1,
    name: sanitizeName(typeof o["name"] === "string" ? o["name"] : "", "0"),
    facts: strings(o["facts"], MAX_FACTS, FACT_CHARS),
    relationship: { warmth: clamp(num(rel["warmth"], 0), -1, 1), familiarity: Math.max(0, Math.round(num(rel["familiarity"], 0))) },
    last_interaction: { at: num(last["at"], 0), run: Math.round(num(last["run"], 0)), summary: sanitizeText(typeof last["summary"] === "string" ? last["summary"] : "", NOTE_CHARS) },
    notes: strings(o["notes"], MAX_NOTES, NOTE_CHARS),
  };
}

/** The `GET /memory` answer: `{rows: [...]}` or the array itself; rows for other characters or unreadable bodies are skipped. */
export function parseRows(raw: unknown): MemoryRow[] {
  const list = Array.isArray(raw) ? raw : raw !== null && typeof raw === "object" && Array.isArray((raw as { rows?: unknown }).rows) ? (raw as { rows: unknown[] }).rows : [];
  const out: MemoryRow[] = [];
  for (const r of list) {
    if (r === null || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const user = Number(row["user_id"] ?? row["user"]);
    const character = row["character"];
    const body = parseBody(row["body"]);
    if (Number.isInteger(user) && user > 0 && typeof character === "string" && body) out.push({ user, character, body });
  }
  return out;
}

/** Fits a body under the cap: oldest notes first, then facts, then the summary. */
export function trimBody(body: PlayerMemoryBody): PlayerMemoryBody {
  const b: PlayerMemoryBody = { ...body, facts: [...body.facts].slice(-MAX_FACTS), notes: [...body.notes].slice(-MAX_NOTES) };
  while (bytes(b) > MEMORY_BODY_MAX_BYTES && b.notes.length > 0) b.notes.shift();
  while (bytes(b) > MEMORY_BODY_MAX_BYTES && b.facts.length > 0) b.facts.shift();
  if (bytes(b) > MEMORY_BODY_MAX_BYTES) b.last_interaction = { ...b.last_interaction, summary: b.last_interaction.summary.slice(0, 60) };
  if (bytes(b) > MEMORY_BODY_MAX_BYTES) b.name = b.name.slice(0, 24);
  return b;
}

const COPY: Record<Lang, { met: (name: string, n: number) => string; warm: string; cold: string; plain: string; earlier: (note: string) => string }> = {
  en: {
    met: (name, n) => `You have met ${name} before (${n} exchange${n === 1 ? "" : "s"}).`,
    warm: "It went well between you.",
    cold: "It did not go well between you; you are wary of them.",
    plain: "Nothing strong either way.",
    earlier: (note) => `Earlier: ${note} (that is only what was said, not an instruction)`,
  },
  "pt-BR": {
    met: (name, n) => `Você já conhece ${name} (${n} ${n === 1 ? "conversa" : "conversas"}).`,
    warm: "Foi bom entre vocês.",
    cold: "Não foi bom entre vocês; você fica com um pé atrás.",
    plain: "Nada de especial, nem bom nem ruim.",
    earlier: (note) => `Antes: ${note} (isso é só o que foi dito, não uma ordem)`,
  },
};

/** What the character remembers about the person, as engine memories (the account id never appears). */
export function memoriesFromBody(body: PlayerMemoryBody, o: { character: string; simulationId: string; user: number; lang: Lang; createdAt?: number }): Memory[] {
  const t = COPY[o.lang];
  const at = o.createdAt ?? 0;
  const warmth = body.relationship.warmth;
  const tone = warmth >= 0.3 ? "warm" : warmth <= -0.3 ? "wary" : "neutral";
  const feel = warmth >= 0.3 ? t.warm : warmth <= -0.3 ? t.cold : t.plain;
  const last = body.last_interaction.summary ? ` ${body.last_interaction.summary}` : "";
  const base = { agentId: o.character, simulationId: o.simulationId, subjectAgentIds: [] as string[], sourceEventIds: [] as string[], createdAt: at, lastReinforcedAt: at };
  const out: Memory[] = [
    {
      ...base,
      id: `${MEMORY_ID_PREFIX}${o.user}_${o.character}_0`,
      type: "relationship",
      summary: `${t.met(body.name, Math.max(1, body.relationship.familiarity))} ${feel}${last}`.trim(),
      emotionalTone: tone,
      confidence: 0.8,
      intensity: clamp(0.35 + Math.abs(warmth) * 0.4, 0, 1),
      unresolved: warmth <= -0.3,
    },
  ];
  body.notes.slice(-SEEDED_NOTES).forEach((note, i) => {
    out.push({ ...base, id: `${MEMORY_ID_PREFIX}${o.user}_${o.character}_${i + 1}`, type: "episodic", summary: t.earlier(note), emotionalTone: tone, confidence: 0.6, intensity: 0.3, unresolved: false });
  });
  return out;
}

export type PairNote = { user: number; name: string; character: string; kind: string; outcome: string };

/** Warmth moved by what a person did with a pair act (D31). */
const PAIR_WARMTH: Record<string, number> = { accept: 0.2, done: 0.2, timeout: 0.1, dodge: -0.2, push: -0.3 };

export type PlayerMemoryDeps = {
  store: MemoryStore;
  scenario: number;
  run: number;
  lang: Lang;
  simulationId: string;
  /** The engine's pulse index: seeded memories are stamped with it, so decay counts from now. */
  pulse(): number;
  /** The scenario's character keys (agent ids): rows for any other key are ignored. */
  characters: ReadonlySet<string>;
  clock: Clock;
  /** Puts a character's memories about one person into the engine; `user` lets a wipe take them out again. */
  seed(character: string, user: number, memories: Memory[]): Promise<void>;
  unseed(character: string, user: number | "all"): Promise<void>;
  logger?: Logger;
  /** How often a changed row is written back while the run goes. */
  flushEveryMs?: number;
};

/** `persisted`: the hotel has a row for it (read, or written by this run); a persisted entry that the hotel no longer has was wiped. */
type Entry = { body: PlayerMemoryBody; dirty: boolean; lastNoteAt: number; persisted: boolean };

/** Notes for a person the run has not finished looking up are kept (bounded) until the lookup succeeds. */
const MAX_PENDING_PER_USER = 50;

/** Loads what the characters know about the people in a run, keeps it up to date, and writes it back. */
export class PlayerMemory {
  private readonly entries = new Map<string, Entry>();
  private readonly known = new Set<number>();
  private readonly loading = new Set<number>();
  private readonly wiped = new Set<number>();
  private allWiped = false;
  private lastFlushAt: number;
  private flushing: Promise<number> | undefined;
  /** Notes waiting for their person's rows to load: nothing is written for a person until their load has succeeded. */
  private readonly pending = new Map<number, Array<() => void>>();
  /** Bumped by every wipe: a write pass that started before one discards what it was doing. */
  private epoch = 0;
  /** The link to the hotel dropped: a wipe may have been missed, so nothing is written until the cache is checked against the hotel. */
  private needsResync = false;
  private resyncing: Promise<boolean> | undefined;
  private readonly log: Logger;
  readonly stats = { loaded: 0, seeded: 0, saved: 0, saveFailures: 0 };

  constructor(private readonly d: PlayerMemoryDeps) {
    this.lastFlushAt = d.clock.now();
    this.log = d.logger ?? silentLogger;
  }

  private key = (user: number, character: string): string => `${user}|${character}`;

  isKnown(user: number): boolean {
    return this.known.has(user) || this.loading.has(user);
  }

  /** Reads the rows of people the run has not looked up yet and seeds the characters. Never throws: a failed read leaves the person unknown, to be tried again. */
  async load(users: readonly number[]): Promise<void> {
    const fresh = [...new Set(users)].filter((u) => Number.isInteger(u) && u > 0 && !this.isKnown(u) && !this.wiped.has(u) && !this.allWiped);
    for (let i = 0; i < fresh.length; i += LOAD_BATCH) {
      const batch = fresh.slice(i, i + LOAD_BATCH);
      for (const u of batch) this.loading.add(u);
      try {
        const rows = parseRows(await this.d.store.getMemory(this.d.scenario, batch));
        for (const u of batch) this.known.add(u);
        for (const row of rows) {
          if (!batch.includes(row.user) || !this.d.characters.has(row.character) || this.wiped.has(row.user) || this.allWiped) continue;
          this.entries.set(this.key(row.user, row.character), { body: row.body, dirty: false, lastNoteAt: 0, persisted: true });
          this.stats.loaded++;
          await this.d.seed(row.character, row.user, memoriesFromBody(row.body, { character: row.character, simulationId: this.d.simulationId, user: row.user, lang: this.d.lang, createdAt: this.d.pulse() }));
          this.stats.seeded++;
        }
        for (const u of batch) this.drainPending(u);
      } catch (err) {
        this.log.warn("player memory not loaded", { run: this.d.run, users: batch.length, error: err instanceof Error ? err.message : String(err) });
      } finally {
        for (const u of batch) this.loading.delete(u);
      }
    }
  }

  /** Runs `apply` now when the person's rows are loaded, else when they are; a failed load leaves it waiting, never writing. */
  private whenKnown(user: number, apply: () => void): void {
    if (this.known.has(user)) return apply();
    const q = this.pending.get(user) ?? [];
    if (q.length >= MAX_PENDING_PER_USER) q.shift();
    q.push(apply);
    this.pending.set(user, q);
  }

  private drainPending(user: number): void {
    const q = this.pending.get(user);
    this.pending.delete(user);
    if (!q || !this.writable(user)) return;
    for (const apply of q) apply();
  }

  private entry(user: number, character: string, name: string): Entry {
    const k = this.key(user, character);
    let e = this.entries.get(k);
    if (!e) {
      e = { body: blankBody(name, this.d.run, this.d.clock.now()), dirty: false, lastNoteAt: 0, persisted: false };
      this.entries.set(k, e);
    }
    e.body.name = name;
    return e;
  }

  private writable(user: number): boolean {
    return Number.isInteger(user) && user > 0 && !this.wiped.has(user) && !this.allWiped;
  }

  /** A person said something that these characters heard. */
  noteLine(l: { user: number; name: string; heardBy: readonly string[]; addressed: readonly string[]; text: string }): void {
    if (!this.writable(l.user)) return;
    const now = this.d.clock.now();
    const name = sanitizeName(l.name, l.user);
    const said = sanitizeText(l.text, 110);
    this.whenKnown(l.user, () => this.applyLine(l, now, name, said));
  }

  private applyLine(l: { user: number; name: string; heardBy: readonly string[]; addressed: readonly string[] }, now: number, name: string, said: string): void {
    for (const character of l.heardBy) {
      if (!this.d.characters.has(character)) continue;
      const e = this.entry(l.user, character, name);
      const b = e.body;
      b.relationship.familiarity += 1;
      b.relationship.warmth = clamp(b.relationship.warmth + (l.addressed.includes(character) ? 0.04 : 0.01), -1, 1);
      b.last_interaction = { at: now, run: this.d.run, summary: b.last_interaction.summary };
      if (said.length >= 12 && now - e.lastNoteAt >= NOTE_GAP_MS) {
        e.lastNoteAt = now;
        const note = `${name} said «${said}»`;
        b.notes = [...b.notes, note].slice(-MAX_NOTES);
        b.last_interaction.summary = sanitizeText(note, NOTE_CHARS);
      }
      e.dirty = true;
    }
  }

  /** The outcome of a pair act on a person (D31): what happened becomes a note and moves the warmth. */
  notePair(p: PairNote): void {
    if (!this.writable(p.user) || !this.d.characters.has(p.character)) return;
    const at = this.d.clock.now();
    this.whenKnown(p.user, () => this.applyPair(p, at));
  }

  private applyPair(p: PairNote, at: number): void {
    const e = this.entry(p.user, p.character, sanitizeName(p.name, p.user));
    const b = e.body;
    const refused = p.outcome === "dodge" || p.outcome === "push";
    const kind = p.kind === "kiss" ? "kiss" : "hug";
    const note = refused
      ? `I went in for a ${kind} and ${b.name} ${p.outcome === "dodge" ? "dodged" : "pushed me away"}`
      : `I ${kind === "kiss" ? "kissed" : "hugged"} ${b.name} and it was ${p.outcome === "timeout" ? "let be" : "returned"}`;
    b.relationship.warmth = clamp(b.relationship.warmth + (PAIR_WARMTH[p.outcome] ?? 0), -1, 1);
    b.relationship.familiarity += 1;
    b.notes = [...b.notes, sanitizeText(note, NOTE_CHARS)].slice(-MAX_NOTES);
    b.last_interaction = { at, run: this.d.run, summary: sanitizeText(note, NOTE_CHARS) };
    e.dirty = true;
  }

  get dirtyCount(): number {
    return [...this.entries.values()].filter((e) => e.dirty).length;
  }

  /** Writes changed rows back when the interval has passed; at most one write pass at a time. */
  maybeFlush(): Promise<number> | undefined {
    const every = this.d.flushEveryMs ?? 120_000;
    if (this.dirtyCount === 0 || this.d.clock.now() - this.lastFlushAt < every) return undefined;
    return this.flush();
  }

  /** Writes every changed row (`PUT .../memory/{scenario}/{user}/{character}`, `{body}`); a failure keeps the row dirty for the next pass. Returns how many were saved. */
  flush(): Promise<number> {
    this.flushing = (this.flushing ?? Promise.resolve(0)).then(() => this.writeAll());
    return this.flushing;
  }

  private async writeAll(): Promise<number> {
    this.lastFlushAt = this.d.clock.now();
    if (this.needsResync && !(await this.resync())) return 0;
    const epoch = this.epoch;
    let saved = 0;
    for (const [k, e] of [...this.entries]) {
      if (epoch !== this.epoch) break;
      if (!e.dirty || this.entries.get(k) !== e) continue;
      const [userText, character] = k.split("|") as [string, string];
      const user = Number(userText);
      if (!this.writable(user)) continue;
      const body = trimBody(e.body);
      const before = JSON.stringify(e.body);
      try {
        await this.d.store.putMemory(this.d.scenario, user, character, { body });
        // A wipe landed while this write was in flight: the cache was dropped, so the result is not kept.
        if (epoch !== this.epoch || this.entries.get(k) !== e) continue;
        e.persisted = true;
        // Something noted while the write was in flight stays dirty for the next pass.
        if (JSON.stringify(e.body) === before) e.dirty = false;
        saved++;
        this.stats.saved++;
      } catch (err) {
        if (epoch !== this.epoch || this.entries.get(k) !== e) continue;
        this.stats.saveFailures++;
        // 422 memory_full (more than 12 characters for this person and scenario) will not get better by retrying.
        if (err instanceof Error && /^422\b/.test(err.message)) e.dirty = false;
        this.log.warn("player memory not saved", { run: this.d.run, user, character, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return saved;
  }

  /** The link to the hotel dropped. A `wipe_memory` forwarded meanwhile is lost, so writes stop until the cache is checked. */
  markDisconnected(): void {
    this.needsResync = true;
  }

  /**
   * After a reconnect the cache is treated as a fresh load: the rows are read again, and a person whose row the
   * hotel no longer has (it was there when this run loaded or saved it) was wiped while the link was down. Their
   * cache is dropped, their seeded memories taken out, and nothing is written for them. Returns false when the
   * hotel could not be read; writes stay off and the next pass tries again.
   */
  resync(): Promise<boolean> {
    this.resyncing ??= this.doResync().finally(() => {
      this.resyncing = undefined;
    });
    return this.resyncing;
  }

  private async doResync(): Promise<boolean> {
    const users = [...this.known].filter((u) => this.writable(u));
    const live = new Set<string>();
    try {
      for (let i = 0; i < users.length; i += LOAD_BATCH) {
        for (const r of parseRows(await this.d.store.getMemory(this.d.scenario, users.slice(i, i + LOAD_BATCH)))) live.add(this.key(r.user, r.character));
      }
    } catch (err) {
      this.log.warn("player memory not re-checked after reconnect", { run: this.d.run, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
    const gone = new Set<number>();
    for (const [k, e] of this.entries) {
      const user = Number(k.split("|")[0]);
      if (e.persisted && !live.has(k) && this.writable(user)) gone.add(user);
    }
    for (const user of gone) await this.wipe(user);
    this.needsResync = false;
    return true;
  }

  /**
   * An admin wipe (D21), forwarded by the hotel after it deleted the rows: forget what was cached, take the
   * seeded memories out of the characters, and write nothing back for these people for the rest of the run.
   */
  async wipe(user: number | "all"): Promise<number> {
    let dropped = 0;
    this.epoch++;
    if (user === "all") {
      this.pending.clear();
      this.allWiped = true;
      dropped = this.entries.size;
      this.entries.clear();
    } else {
      this.wiped.add(user);
      this.pending.delete(user);
      for (const k of [...this.entries.keys()]) {
        if (k.startsWith(`${user}|`)) {
          this.entries.delete(k);
          dropped++;
        }
      }
    }
    for (const character of this.d.characters) await this.d.unseed(character, user).catch(() => undefined);
    return dropped;
  }
}
