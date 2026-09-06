/**
 * An in-memory job store.
 *
 * Source of truth: ADR-031, ADR-057.
 *
 * For tests. **Not** for production: ADR-031 exists precisely because
 * module-level state appears to work locally and fails the moment the process
 * restarts or a second worker starts. `getJobStore` never returns this one.
 *
 * Records are cloned in and out, so a caller holding a job object cannot
 * accidentally mutate what the store believes — which is the failure mode a
 * naive Map-backed store hides until a test starts passing for the wrong
 * reason.
 */

import { isJobId } from "./id";
import type { AnalysisJob, JobPatch, JobStore } from "./types";

export interface MemoryJobStore extends JobStore {
  /** Every job, for assertions. */
  all(): AnalysisJob[];
  clear(): void;
}

function clone(job: AnalysisJob): AnalysisJob {
  return structuredClone(job);
}

export function createMemoryJobStore(): MemoryJobStore {
  const jobs = new Map<string, AnalysisJob>();

  return {
    create(job) {
      jobs.set(job.id, clone(job));
      return Promise.resolve();
    },

    get(id) {
      if (!isJobId(id)) return Promise.resolve(null);

      const job = jobs.get(id);
      return Promise.resolve(job === undefined ? null : clone(job));
    },

    update(id, patch: JobPatch) {
      const existing = jobs.get(id);
      if (existing === undefined) return Promise.resolve(null);

      const updated: AnalysisJob = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };

      jobs.set(id, clone(updated));
      return Promise.resolve(clone(updated));
    },

    all() {
      return [...jobs.values()].map(clone);
    },

    clear() {
      jobs.clear();
    },
  };
}
