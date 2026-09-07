/**
 * Opening the database.
 *
 * Source of truth: ADR-020, ADR-032, ADR-060.
 *
 * `node:sqlite` ships with the runtime, so persistence costs no dependency —
 * which is what lets ADR-020's "simplest architecture that supports the current
 * phase" hold while still getting migrations, transactions and indexed reads.
 *
 * One connection per process. ADR-032 puts this on a long-running Node server,
 * so a connection is opened once and kept, rather than opened per request.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { migrate } from "./migrations";
import type { MigrationResult } from "./migrations";

export interface OpenOptions {
  /** A file path, or `:memory:` for a database that lives only in this process. */
  readonly location: string;
}

/**
 * Open a database and bring its schema up to date.
 *
 * Migrating on open rather than in a separate command is deliberate: this is a
 * single-process application with an embedded database, and a deployment that
 * could start the server against an un-migrated file would eventually do it.
 */
export function openDatabase(options: OpenOptions): {
  db: DatabaseSync;
  migration: MigrationResult;
} {
  if (options.location !== ":memory:") {
    mkdirSync(path.dirname(options.location), { recursive: true });
  }

  const db = new DatabaseSync(options.location);

  // Off by default in SQLite, and the schema depends on it: deleting an
  // analysis must take its findings and scores with it.
  db.exec("PRAGMA foreign_keys = ON");

  if (options.location !== ":memory:") {
    // Survives a crash without the fsync cost of the default journal, which
    // matters because every status transition is a write.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }

  return { db, migration: migrate(db) };
}
