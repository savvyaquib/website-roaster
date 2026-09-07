/**
 * Schema migrations.
 *
 * Source of truth: docs/DECISIONS.md ADR-019, ADR-020, ADR-031, ADR-057,
 * ADR-060.
 *
 * Forward-only, numbered from 1, applied in order. The database's own
 * `user_version` pragma records how far it has got, so there is no migrations
 * table to keep consistent with the thing it describes.
 *
 * ## Rules
 *
 * - **A migration that has shipped is never edited.** Change it and two
 *   databases with the same `user_version` have different schemas, which is the
 *   one failure a migration system exists to prevent.
 * - **A database newer than the code is refused, not opened.** Older code
 *   cannot know what a later migration did, and writing to it would corrupt
 *   data it does not understand.
 * - Each migration runs in a transaction, so a failure leaves the previous
 *   version intact rather than something halfway.
 */

import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  /** Sequential from 1. Also the `user_version` after it has run. */
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

/**
 * The schema.
 *
 * ## What is stored, and what is deliberately not
 *
 * Phase 19 says never to store unnecessary website data, so nothing here holds
 * page content: no HTML, no screenshots, no extracted copy, no response bodies.
 * What is kept is the *analysis* — findings, scores, timestamps, status — and
 * the model prose that cannot be recomputed.
 *
 * Recommendations and roast lines have no tables. Both are pure functions of
 * the findings and the score (Phases 13 and 15), so storing them would be
 * storing a third and fourth copy of every finding. What a model wrote *is*
 * stored, because a model's words cannot be derived from anything: the roast
 * keeps punchlines against finding ids, and the interpretation keeps its prose
 * the same way. That is the Phase 14 and 15 design paying off — the application
 * owns the facts, so storage only needs the prose.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "analyses, findings and category scores",
    up: `
      CREATE TABLE analyses (
        id                                TEXT PRIMARY KEY,
        status                            TEXT NOT NULL,
        -- The normalized URL. Null when the submission was refused, so that
        -- nothing downstream can find an unvalidated value to act on (ADR-057).
        url                               TEXT,
        submitted_url                     TEXT NOT NULL,
        created_at                        TEXT NOT NULL,
        updated_at                        TEXT NOT NULL,
        started_at                        TEXT,
        finished_at                       TEXT,
        error_code                        TEXT,
        error_message                     TEXT,
        record_version                    INTEGER NOT NULL,

        -- Everything below is present only for a completed analysis.
        final_url                         TEXT,
        http_status                       INTEGER,
        duration_ms                       INTEGER,
        not_run                           TEXT,
        scoring_version                   INTEGER,
        overall_score                     INTEGER,
        overall_grade                     TEXT,
        overall_explanation               TEXT,
        assessed_categories               TEXT,
        not_assessed_categories           TEXT,
        overall_weighting                 TEXT,
        -- Raw measurements, kept apart from the scores derived from them
        -- (ADR-012). Null until the browser pass is wired into the API.
        performance_metrics               TEXT,
        interpretation                    TEXT,
        interpretation_unavailable_reason TEXT,
        roast                             TEXT
      ) STRICT;

      CREATE TABLE findings (
        analysis_id    TEXT    NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        -- Findings are ordered, and the order is the analyzers'. Keeping it
        -- means a re-read produces the same report, not a reshuffled one.
        position       INTEGER NOT NULL,
        finding_id     TEXT    NOT NULL,
        category       TEXT    NOT NULL,
        severity       TEXT    NOT NULL,
        status         TEXT    NOT NULL,
        explanation    TEXT    NOT NULL,
        recommendation TEXT,
        evidence       TEXT    NOT NULL,
        PRIMARY KEY (analysis_id, position)
      ) STRICT;

      CREATE TABLE category_scores (
        analysis_id         TEXT    NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        position            INTEGER NOT NULL,
        category            TEXT    NOT NULL,
        status              TEXT    NOT NULL,
        score               INTEGER,
        grade               TEXT,
        method              TEXT    NOT NULL,
        finding_count       INTEGER NOT NULL,
        total_deducted      INTEGER NOT NULL,
        deductions          TEXT    NOT NULL,
        metrics             TEXT    NOT NULL,
        not_assessed_reason TEXT,
        explanation         TEXT    NOT NULL,
        PRIMARY KEY (analysis_id, category)
      ) STRICT;

      -- Retention sweeps and history listings both read in date order.
      CREATE INDEX analyses_created_at ON analyses (created_at);
    `,
  },
];

/** The version a database is brought to by the migrations this code carries. */
export const LATEST_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);

export class MigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MigrationError";
  }
}

/** The version a database is currently at. */
export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };

  return row.user_version;
}

export interface MigrationResult {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly string[];
}

/**
 * Bring a database up to date.
 *
 * Idempotent: running it against a current database applies nothing.
 *
 * @throws {MigrationError} if the database is newer than this code, or if a
 *   migration fails.
 */
export function migrate(db: DatabaseSync): MigrationResult {
  const from = schemaVersion(db);

  if (from > LATEST_VERSION) {
    throw new MigrationError(
      `The database is at schema version ${from}, but this build only knows up to ${LATEST_VERSION}. ` +
        "Refusing to open it: older code cannot know what a later migration did.",
    );
  }

  const pending = MIGRATIONS.filter((migration) => migration.version > from).sort(
    (a, b) => a.version - b.version,
  );

  const applied: string[] = [];

  for (const migration of pending) {
    try {
      db.exec("BEGIN");
      db.exec(migration.up);
      // Not a bound parameter: PRAGMA does not take one. The value is a number
      // from this file, never from input.
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (cause) {
      db.exec("ROLLBACK");
      throw new MigrationError(
        `Migration ${migration.version} (${migration.name}) failed. The database is unchanged.`,
        { cause },
      );
    }

    applied.push(`${migration.version}: ${migration.name}`);
  }

  return { from, to: schemaVersion(db), applied };
}
