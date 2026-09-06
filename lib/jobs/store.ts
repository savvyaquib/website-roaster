/**
 * The process's job store.
 *
 * Source of truth: ADR-031, ADR-057.
 *
 * One instance, created on first use. The directory comes from
 * `ANALYSIS_STORE_DIR` when set, so a deployment can put it on a mounted
 * volume rather than inside the build output.
 */

import { getServerEnv } from "@/lib/config/env";

import { createFileJobStore } from "./file-store";
import type { JobStore } from "./types";

let store: JobStore | undefined;

/**
 * The job store for this process.
 *
 * Always the file-backed one. The in-memory store is a test double and is never
 * returned here — a store that loses everything on restart is the exact failure
 * ADR-031 was written to prevent.
 */
export function getJobStore(): JobStore {
  store ??= createFileJobStore({ directory: getServerEnv().analysisStoreDir });
  return store;
}

/** Test-only: drop the memoised store so a new directory takes effect. */
export function resetJobStore(): void {
  store = undefined;
}
