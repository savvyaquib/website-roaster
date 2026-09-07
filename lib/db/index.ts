/**
 * Phase 19 — persistence.
 *
 * Import from `@/lib/db`; the internal modules are implementation detail.
 */

export { openDatabase, type OpenOptions } from "./database";

export {
  LATEST_VERSION,
  migrate,
  MIGRATIONS,
  MigrationError,
  schemaVersion,
  type Migration,
  type MigrationResult,
} from "./migrations";
