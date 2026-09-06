/**
 * Phase 16 — the analysis job store.
 *
 * Import from `@/lib/jobs`; the internal modules are implementation detail.
 */

export { createJobId, isJobId } from "./id";

export {
  createFileJobStore,
  DEFAULT_STORE_DIR,
  JobStoreError,
  type FileJobStoreOptions,
} from "./file-store";

export { createMemoryJobStore, type MemoryJobStore } from "./memory-store";

export { getJobStore, resetJobStore } from "./store";

export {
  JOB_SCHEMA_VERSION,
  type AnalysisJob,
  type AnalysisReport,
  type JobError,
  type JobPatch,
  type JobStore,
} from "./types";
