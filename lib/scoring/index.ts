/**
 * Phase 12 — the deterministic scoring engine.
 *
 * Import from `@/lib/scoring`; the internal modules are implementation detail.
 */

export { scoreAnalysis, scoreCategories, scoreOverall } from "./score-analysis";

export { scoreCategoryFromFindings, wasAssessed } from "./score-category";

export { scorePerformance } from "./score-performance";

export { GRADE_BANDS, GRADES, gradeFor, type Grade } from "./grade";

export {
  CATEGORY_WEIGHTS,
  DEDUCTIONS,
  deductionFor,
  METRIC_CURVES,
  normaliseMetric,
  PERFORMANCE_COMPONENTS,
  SCORED_CATEGORIES,
  type MetricCurve,
  type PerformanceComponent,
} from "./weights";

export { SCORING_VERSION } from "./version";

export type {
  CategoryScore,
  CategoryScoreStatus,
  CategoryWeighting,
  FindingDeduction,
  MetricContribution,
  OverallScore,
  ScoreReport,
  ScoringInput,
  ScoringMethod,
} from "./types";
