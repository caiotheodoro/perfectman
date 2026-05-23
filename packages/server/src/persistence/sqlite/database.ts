/**
 * SQLite connection helper.
 * Opens (or creates) the database, runs schema creation, returns the DB instance.
 * Import `openDatabase` where you need a DB handle.
 */

import Database from "better-sqlite3";
import { CREATE_TABLES_SQL } from "./schema.js";

export type DB = Database.Database;

/**
 * Open (or create) a SQLite database at the given path.
 * Runs schema migration on first open.
 * Use `:memory:` for tests.
 */
export function openDatabase(path: string): DB {
  const db = new Database(path);

  // WAL + foreign keys are set per-connection inside CREATE_TABLES_SQL PRAGMAs.
  // exec() runs multiple statements at once.
  db.exec(CREATE_TABLES_SQL);

  return db;
}

/** Close gracefully (call on process exit or test teardown). */
export function closeDatabase(db: DB): void {
  db.close();
}
