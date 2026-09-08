/**
 * Phase 16 — the analysis pipeline.
 *
 * Import from `@/lib/pipeline`; the internal modules are implementation detail.
 */

export {
  createConcurrencyLimiter,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_QUEUED,
  QueueFullError,
  type ConcurrencyLimiter,
  type LimiterOptions,
} from "./limiter";

export {
  DEFAULT_ANALYSIS_TIMEOUT_MS,
  MAX_REQUEST_TIMEOUT_MS,
  NOT_RUN_IN_THIS_PHASE,
  runAnalysis,
  type AnalysisOutcome,
  type AnalysisRunner,
  type RunAnalysisOptions,
} from "./run-analysis";
