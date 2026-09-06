/**
 * Job identifiers.
 *
 * Source of truth: ADR-057.
 *
 * ## Two properties, both load-bearing
 *
 * **Unguessable.** A job id is the only thing protecting one person's report
 * from another's; there are no accounts in V1 (CLAUDE.md scope). A sequential
 * id would make every report on the server enumerable.
 *
 * **Strictly shaped.** The id becomes a filename in the file-backed store, so
 * anything that is not exactly a UUID must be refused *before* it reaches the
 * filesystem. `../../etc/passwd` is a perfectly good string and a very bad file
 * name. The route validates, and the store validates again — the second check
 * is not redundant, it is the one that holds if a new caller forgets the first.
 */

import { randomUUID } from "node:crypto";

/** A v4 UUID, lowercase, and nothing else. */
const JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createJobId(): string {
  return randomUUID();
}

/** True only for a string this application could have generated. */
export function isJobId(value: unknown): value is string {
  return typeof value === "string" && JOB_ID_PATTERN.test(value);
}
