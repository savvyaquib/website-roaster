/**
 * Phase 8 — Performance analyzer.
 *
 * Import from `@/lib/analysis/performance`; the internal modules are
 * implementation detail.
 */

export { analyzePerformance } from "./analyze-performance";

export {
  DEFAULT_AUDIT_TIMEOUT_MS,
  runLighthouse,
  type LighthouseRunner,
  type RunLighthouseOptions,
} from "./run-lighthouse";

export {
  AUDIT_IDS,
  emptyMeasurements,
  extractMeasurements,
  INP_UNAVAILABLE_REASON,
} from "./extract-measurements";

export { normalizeLighthouseReport, statusForScore } from "./normalize";

export {
  PERFORMANCE_FAILURE_CODES,
  type LighthouseAudit,
  type LighthouseReport,
  type PerformanceAnalysis,
  type PerformanceAnalysisInput,
  type PerformanceAudit,
  type PerformanceFailure,
  type PerformanceFailureCode,
  type PerformanceMeasurements,
  type ResourceGroup,
} from "./types";
