/**
 * Migration tests.
 *
 * These run against real in-memory databases. A mocked driver would prove the
 * runner calls something; only a real one proves the schema it produces is a
 * schema SQLite accepts.
 */

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./database";
import {
  LATEST_VERSION,
  migrate,
  MIGRATIONS,
  MigrationError,
  schemaVersion,
} from "./migrations";

const open: DatabaseSync[] = [];

function fresh(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  open.push(db);
  return db;
}

function tableNames(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as unknown as { name: string }[]
  )
    .map((row) => row.name)
    .filter((name) => !name.startsWith("sqlite_"));
}

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

describe("the migration list", () => {
  it("is numbered from 1 with no gaps or repeats", () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(
      MIGRATIONS.map((_migration, index) => index + 1),
    );
  });

  it("agrees with the version it claims to reach", () => {
    expect(LATEST_VERSION).toBe(MIGRATIONS.length);
  });

  it("gives every migration a name worth reading in a log", () => {
    for (const migration of MIGRATIONS) {
      expect(migration.name.length).toBeGreaterThan(3);
      expect(migration.up.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("migrating a fresh database", () => {
  it("starts at zero", () => {
    expect(schemaVersion(fresh())).toBe(0);
  });

  it("reaches the latest version", () => {
    const db = fresh();
    const result = migrate(db);

    expect(result.from).toBe(0);
    expect(result.to).toBe(LATEST_VERSION);
    expect(result.applied).toHaveLength(MIGRATIONS.length);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
  });

  it("creates the tables the store needs", () => {
    const db = fresh();
    migrate(db);

    expect(tableNames(db)).toEqual(["analyses", "category_scores", "findings"]);
  });
});

describe("migrating again", () => {
  it("applies nothing to a current database", () => {
    const db = fresh();
    migrate(db);

    const second = migrate(db);

    expect(second.from).toBe(LATEST_VERSION);
    expect(second.applied).toEqual([]);
  });

  it("leaves the data alone", () => {
    const db = fresh();
    migrate(db);
    db.prepare(
      "INSERT INTO analyses (id, status, submitted_url, created_at, updated_at, record_version) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("a", "queued", "https://example.com", "2026-01-01", "2026-01-01", 1);

    migrate(db);

    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM analyses").get() as unknown as { n: number })
        .n,
    ).toBe(1);
  });

  it("is safe to run concurrently with itself in sequence", () => {
    const db = fresh();

    expect(() => {
      migrate(db);
      migrate(db);
      migrate(db);
    }).not.toThrow();
  });
});

describe("a database newer than the code", () => {
  it("is refused rather than opened", () => {
    // Older code cannot know what a later migration did, and writing to it
    // would corrupt data it does not understand.
    const db = fresh();
    db.exec(`PRAGMA user_version = ${LATEST_VERSION + 5}`);

    expect(() => migrate(db)).toThrow(MigrationError);
  });

  it("says what it found and what it knows", () => {
    const db = fresh();
    db.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`);

    expect(() => migrate(db)).toThrow(
      new RegExp(
        `version ${LATEST_VERSION + 1}.*only knows up to ${LATEST_VERSION}`,
        "s",
      ),
    );
  });
});

describe("a migration that fails", () => {
  it("leaves the database unchanged", () => {
    const db = fresh();
    // A table the migration will collide with, forcing it to fail partway.
    db.exec("CREATE TABLE findings (x INTEGER)");

    expect(() => migrate(db)).toThrow(MigrationError);

    // Rolled back: the version did not move, and `analyses` was not left
    // behind from the half of the migration that had already run.
    expect(schemaVersion(db)).toBe(0);
    expect(tableNames(db)).toEqual(["findings"]);
  });
});

describe("the schema", () => {
  it("cascades a delete to findings and scores", () => {
    const { db } = openDatabase({ location: ":memory:" });
    open.push(db);

    db.prepare(
      "INSERT INTO analyses (id, status, submitted_url, created_at, updated_at, record_version) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("a", "completed", "https://example.com", "2026-01-01", "2026-01-01", 1);
    db.prepare(
      "INSERT INTO findings (analysis_id, position, finding_id, category, severity, status, explanation, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("a", 0, "seo.title.missing", "seo", "serious", "fail", "x", "[]");

    db.prepare("DELETE FROM analyses WHERE id = ?").run("a");

    // Without `PRAGMA foreign_keys = ON` this row would survive its analysis.
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM findings").get() as unknown as { n: number })
        .n,
    ).toBe(0);
  });

  it("refuses a value of the wrong type", () => {
    // The tables are STRICT, so a bug that wrote a string into an integer
    // column fails at the write rather than surfacing as a wrong number later.
    const { db } = openDatabase({ location: ":memory:" });
    open.push(db);

    expect(() =>
      db
        .prepare(
          "INSERT INTO analyses (id, status, submitted_url, created_at, updated_at, record_version) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          "a",
          "queued",
          "https://example.com",
          "2026-01-01",
          "2026-01-01",
          "not a number",
        ),
    ).toThrow();
  });

  it("stores no page content", () => {
    // Phase 19: never store unnecessary website data. This asserts the schema
    // has nowhere to put it.
    const { db } = openDatabase({ location: ":memory:" });
    open.push(db);

    const columns = tableNames(db).flatMap((table) =>
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
      ).map((column) => `${table}.${column.name}`),
    );

    for (const forbidden of ["html", "body", "screenshot", "content", "markup", "dom"]) {
      expect(
        columns.filter((column) => column.toLowerCase().includes(forbidden)),
        `a column looks like it holds page ${forbidden}`,
      ).toEqual([]);
    }
  });
});

describe("openDatabase", () => {
  it("migrates on open", () => {
    const { db, migration } = openDatabase({ location: ":memory:" });
    open.push(db);

    expect(migration.to).toBe(LATEST_VERSION);
    expect(tableNames(db)).toContain("analyses");
  });

  it("enforces foreign keys", () => {
    const { db } = openDatabase({ location: ":memory:" });
    open.push(db);

    const row = db.prepare("PRAGMA foreign_keys").get() as unknown as {
      foreign_keys: number;
    };

    expect(row.foreign_keys).toBe(1);
  });
});
