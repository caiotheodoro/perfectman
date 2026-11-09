import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { TaggedBeat } from "./types.js";

/**
 * The index: one SQLite file, one row per tagged beat, the vector as a Float32 BLOB. Retrieval is a metadata filter in SQL and a
 * brute-force cosine in JS over what is left. For a few thousand beats that is milliseconds and needs no native extension;
 * sqlite-vec can replace the scan later behind the same `candidates` call.
 */
export type Filter = { action_type?: string; medium?: string; language?: string; castMin?: number; castMax?: number };
export type StoredBeat = TaggedBeat & { vec: Float32Array; embed_model: string };

export class Store {
  private readonly db: Database.Database;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS beats (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, language TEXT NOT NULL, medium TEXT NOT NULL,
        act TEXT NOT NULL, scene TEXT NOT NULL, idx INTEGER NOT NULL, speakers TEXT NOT NULL, cast_size INTEGER NOT NULL, text TEXT NOT NULL,
        directions TEXT NOT NULL, action_hint TEXT NOT NULL, license_class TEXT NOT NULL,
        tactic_verb TEXT NOT NULL, status_delta TEXT NOT NULL, action_type TEXT NOT NULL, emotion TEXT NOT NULL, driver TEXT NOT NULL, target TEXT,
        confidence REAL NOT NULL, boundary_ok INTEGER NOT NULL, tagged_by TEXT NOT NULL, embed_model TEXT NOT NULL, vec BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS beats_action ON beats(action_type, medium, language);
      CREATE INDEX IF NOT EXISTS beats_cast ON beats(cast_size);
    `);
  }

  close(): void {
    this.db.close();
  }

  upsert(items: ReadonlyArray<{ beat: TaggedBeat; vec: Float32Array; embedModel: string }>): void {
    const stmt = this.db.prepare(`INSERT OR REPLACE INTO beats VALUES (@id,@source_id,@title,@author,@language,@medium,@act,@scene,@idx,@speakers,@cast_size,@text,@directions,@action_hint,@license_class,@tactic_verb,@status_delta,@action_type,@emotion,@driver,@target,@confidence,@boundary_ok,@tagged_by,@embed_model,@vec)`);
    const tx = this.db.transaction((rows: typeof items) => {
      for (const { beat: b, vec, embedModel } of rows) {
        stmt.run({
          id: b.id, source_id: b.sourceId, title: b.title, author: b.author, language: b.language, medium: b.medium, act: b.act, scene: b.scene, idx: b.index,
          speakers: JSON.stringify(b.speakers), cast_size: b.castSize, text: b.text, directions: JSON.stringify(b.directions), action_hint: b.actionHint,
          license_class: b.license_class, tactic_verb: b.tag.tactic_verb, status_delta: b.tag.status_delta, action_type: b.tag.action_type, emotion: b.tag.emotion,
          driver: b.tag.driver, target: b.tag.target, confidence: b.tag.confidence, boundary_ok: b.tag.boundary_ok ? 1 : 0, tagged_by: b.tag.tagged_by,
          embed_model: embedModel, vec: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
        });
      }
    });
    tx(items);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM beats").get() as { n: number }).n;
  }

  stats(): { total: number; by_action: Record<string, number>; by_medium: Record<string, number>; by_language: Record<string, number>; embed_models: string[] } {
    const group = (col: string) =>
      Object.fromEntries((this.db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM beats GROUP BY ${col}`).all() as Array<{ k: string; n: number }>).map((r) => [r.k, r.n]));
    return {
      total: this.count(),
      by_action: group("action_type"),
      by_medium: group("medium"),
      by_language: group("language"),
      embed_models: (this.db.prepare("SELECT DISTINCT embed_model AS m FROM beats").all() as Array<{ m: string }>).map((r) => r.m),
    };
  }

  candidates(f: Filter): StoredBeat[] {
    const where: string[] = [];
    const args: Record<string, unknown> = {};
    if (f.action_type) (where.push("action_type = @action_type"), (args["action_type"] = f.action_type));
    if (f.medium) (where.push("medium = @medium"), (args["medium"] = f.medium));
    if (f.language) (where.push("language = @language"), (args["language"] = f.language));
    if (f.castMin !== undefined) (where.push("cast_size >= @castMin"), (args["castMin"] = f.castMin));
    if (f.castMax !== undefined) (where.push("cast_size <= @castMax"), (args["castMax"] = f.castMax));
    const sql = `SELECT * FROM beats${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
    const rows = this.db.prepare(sql).all(args) as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const blob = r["vec"] as Buffer;
      const vec = new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
      return {
        id: r["id"] as string, sourceId: r["source_id"] as string, title: r["title"] as string, author: r["author"] as string, language: r["language"] as string,
        medium: r["medium"] as StoredBeat["medium"], act: r["act"] as string, scene: r["scene"] as string, index: r["idx"] as number,
        speakers: JSON.parse(r["speakers"] as string) as string[], castSize: r["cast_size"] as number, text: r["text"] as string,
        directions: JSON.parse(r["directions"] as string) as string[], actionHint: r["action_hint"] as StoredBeat["actionHint"], license_class: r["license_class"] as string,
        tag: {
          id: r["id"] as string, tactic_verb: r["tactic_verb"] as string, status_delta: r["status_delta"] as StoredBeat["tag"]["status_delta"],
          action_type: r["action_type"] as StoredBeat["tag"]["action_type"], emotion: r["emotion"] as StoredBeat["tag"]["emotion"], driver: r["driver"] as string,
          target: (r["target"] as string | null) ?? null, confidence: r["confidence"] as number, boundary_ok: (r["boundary_ok"] as number) === 1, tagged_by: r["tagged_by"] as string,
        },
        vec,
        embed_model: r["embed_model"] as string,
      } satisfies StoredBeat;
    });
  }
}
