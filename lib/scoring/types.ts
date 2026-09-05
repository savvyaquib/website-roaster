/**
 * Scoring result types.
 *
 * Source of truth: docs/SCORING.md, docs/DECISIONS.md ADR-002, ADR-012,
 * ADR-036, ADR-052.
 *
 * ## Every number carries its own derivation
 *
 * A score that cannot be traced back to the evidence that produced it is an
 * assertion, and ADR-002 exists so this product does not make those. So each
 * category score carries the individual deductions or metric contributions that
 * built it, and the overall score carries the weight each category was given.
 *
 * That means a reader can reconstruct every number by hand from what the report
 * shows, and a test does exactly that.
 */

import type {
  AnalysisCategory,
  FindingSeverity,
  FindingStatus,
} from "@/lib/types/finding";

import type { Grade } from "./grade";

/** One finding's effect on a category score. */
export interface FindingDeduction {
  readonly findingId: string;
  readonly severity: FindingSeverity;
  readonly status: FindingStatus;
  /** Points removed. Always zero or positive. */
  readonly deduction: number;
}

/** One metric's effect on the Performance score. */
export interface MetricContribution {
  readonly key: string;
  readonly label: string;
  /** The measurement, in its original unit. Never overwritten (ADR-012). */
  readonly rawValue: number | null;
  readonly unit: string;
  /** The raw value on a 0-100 scale, or null when it could not be scored. */
  readonly normalisedScore: number | null;
  /** The weight docs/SCORING.md declares for this component. */
  readonly declaredWeight: number;
  /**
   * The weight actually applied, after redistributing the weight of components
   * that could not be scored. Zero when this component was excluded.
   */
  readonly effectiveWeight: number;
  /** `normalisedScore * effectiveWeight / 100`, rounded to two decimals. */
  readonly contribution: number;
  /** Why the component was excluded, when it was. */
  readonly excludedReason: string | null;
}

export type CategoryScoreStatus = "scored" | "not_assessed";

/** How a category's score was arrived at. */
export type ScoringMethod =
  /** 100 minus the deductions from its findings. */
  | "deductions"
  /** A weighted sum of normalised metric curves. */
  | "metric_curves";

export interface CategoryScore {
  readonly category: AnalysisCategory;
  readonly status: CategoryScoreStatus;
  /** An integer 0-100, or null when the category was not assessed. */
  readonly score: number | null;
  readonly grade: Grade | null;
  readonly method: ScoringMethod;
  /** Every finding the analyzer produced for this category. */
  readonly findingCount: number;
  /** Findings that removed points, in the order they were applied. */
  readonly deductions: readonly FindingDeduction[];
  readonly totalDeducted: number;
  /** Metric contributions, for the categories scored by curve. */
  readonly metrics: readonly MetricContribution[];
  /** Why the category was not assessed. Null when it was. */
  readonly notAssessedReason: string | null;
  /** A plain-language derivation of the number above. */
  readonly explanation: string;
}

/** How one category fed into the overall score. */
export interface CategoryWeighting {
  readonly category: AnalysisCategory;
  /** The weight docs/SCORING.md declares. */
  readonly declaredWeight: number;
  /**
   * The weight actually applied after redistributing the weight of categories
   * that were not assessed (ADR-036). Zero for an excluded category.
   */
  readonly effectiveWeight: number;
  readonly score: number | null;
  /** `score * effectiveWeight / 100`, rounded to two decimals. */
  readonly contribution: number;
}

export interface OverallScore {
  /** An integer 0-100, or null when no category could be assessed. */
  readonly score: number | null;
  readonly grade: Grade | null;
  readonly weighting: readonly CategoryWeighting[];
  readonly assessedCategories: readonly AnalysisCategory[];
  readonly notAssessedCategories: readonly AnalysisCategory[];
  readonly explanation: string;
}

/**
 * The complete result of scoring one analysis.
 *
 * Carries no timestamp: the engine is pure, and the time an analysis ran is a
 * property of the analysis rather than of the arithmetic (ADR-022 puts that on
 * the stored record, which arrives in Phase 16).
 */
export interface ScoreReport {
  readonly scoringVersion: number;
  readonly overall: OverallScore;
  readonly categories: readonly CategoryScore[];
}

/**
 * What the engine consumes.
 *
 * Findings from every analyzer, and the raw performance measurements. Nothing
 * else: no AI output, no analyzer internals, and no pre-computed scores.
 */
export interface ScoringInput {
  readonly findings: readonly import("@/lib/types/finding").Finding[];
  /**
   * Raw metrics from Phase 8.
   *
   * Optional. Without them Performance is reported as not assessed rather than
   * as zero (ADR-021).
   */
  readonly performance?: import("@/lib/analysis/performance").PerformanceMeasurements;
}
