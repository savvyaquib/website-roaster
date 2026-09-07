/**
 * The process's job store.
 *
 * Source of truth: ADR-031, ADR-057, ADR-060.
 *
 * One database connection and one store, created on first use. ADR-032 puts
 * this on a long-running Node server, so both are opened once and kept.
 */

import { getServerEnv } from "@/lib/config/env";
import { openDatabase } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";

import { createSqliteJobStore } from "./sqlite-store";
import type { SqliteJobStore } from "./sqlite-store";

let store: SqliteJobStore | undefined;

/**
 * The job store for this process.
 *
 * Always the database-backed one. The in-memory store is a test double and is
 * never returned here — a store that loses everything on restart is the exact
 * failure ADR-031 was written to prevent.
 */
export function getJobStore(): SqliteJobStore {
  if (store === undefined) {
    const env = getServerEnv();
    const { db, migration } = openDatabase({ location: env.analysisDbPath });

    createLogger("db").info("db.opened", {
      from: migration.from,
      to: migration.to,
      applied: migration.applied.length,
    });

    store = createSqliteJobStore({ db, retentionDays: env.analysisRetentionDays });
  }

  return store;
}

/** Test-only: drop the memoised store so a new database path takes effect. */
export function resetJobStore(): void {
  store = undefined;
}
