/**
 * The weights, the deduction table and the metric curves.
 *
 * Source of truth: docs/SCORING.md. **This file mirrors that document and
 * nothing else may.** Scoring numbers live here, apart from the analyzers that
 * produce evidence and apart from the UI that displays results (CLAUDE.md,
 * ADR-001).
 *
 * A test asserts these values match the document, so the two cannot drift
 * without something failing.
 */

import type { AnalysisCategory } from "@/lib/types/finding";
import type { FindingSeverity, FindingStatus } from "@/lib/types/finding";

// ---------------------------------------------------------------------------
// Overall category weights
// ---------------------------------------------------------------------------

/**
 * How much each category contributes to the overall score, as percentages.
 *
 * **These are unreviewed.** ADR-037 records that Security at 5% and UX at 20%
 * both look unintentional — a site on plain HTTP with no security headers can
 * lose at most five points overall, while roughly a third of the score rests on
 * the least objective evidence the system collects.
 *
 * They are implemented exactly as `docs/SCORING.md` records them, because
 * inventing different weights is forbidden (CLAUDE.md) and a weight is a
 * product judgement. ADR-037 stays open. Changing the product's mind is a
 * change to this one object plus the document and the scoring version.
 */
export const CATEGORY_WEIGHTS: Readonly<Record<AnalysisCategory, number>> = {
  performance: 20,
  ux: 20,
  seo: 15,
  accessibility: 15,
  content: 15,
  mobile: 10,
  security: 5,
};

// ---------------------------------------------------------------------------
// Findings to a score
// ---------------------------------------------------------------------------

/**
 * Points deducted from a category's starting 100, by severity and status.
 *
 * A finding's `severity` is how the per-check weighting is expressed: the
 * analyzer that produced the finding decided how much the check matters, so no
 * separate per-check weight table is needed.
 *
 * `pass`, `info` and `could_not_determine` deduct nothing. The last of those is
 * the important one: a check that could not run has not established that the
 * site is fine, and must not be treated as a failure either (ADR-021).
 */
export const DEDUCTIONS: Readonly<
  Record<FindingSeverity, Readonly<Partial<Record<FindingStatus, number>>>>
> = {
  critical: { fail: 25, warn: 12 },
  serious: { fail: 15, warn: 8 },
  moderate: { fail: 8, warn: 4 },
  minor: { fail: 3, warn: 1 },
  info: { fail: 0, warn: 0 },
};

/**
 * The deduction a single finding causes.
 *
 * @returns points to remove, always zero or positive.
 */
export function deductionFor(severity: FindingSeverity, status: FindingStatus): number {
  return DEDUCTIONS[severity][status] ?? 0;
}

// ---------------------------------------------------------------------------
// Metric curves
// ---------------------------------------------------------------------------

/**
 * A piecewise-linear normalisation curve.
 *
 * At or better than `good` scores 100, at or worse than `poor` scores 0, and
 * values between interpolate linearly.
 */
export interface MetricCurve {
  readonly good: number;
  readonly poor: number;
  readonly unit: string;
}

/** Curves defined in docs/SCORING.md. */
export const METRIC_CURVES = {
  lcp: { good: 2500, poor: 4000, unit: "ms" },
  tbt: { good: 200, poor: 600, unit: "ms" },
  cls: { good: 0.1, poor: 0.25, unit: "" },
} as const satisfies Record<string, MetricCurve>;

/**
 * Normalise a raw metric onto 0-100.
 *
 * Lower is better for every metric currently defined, which is why the
 * interpolation runs from `poor` down to `good`.
 *
 * @returns an integer from 0 to 100, or null when there is no value to
 *   normalise. Null is not zero: an unmeasured metric has not scored badly.
 */
export function normaliseMetric(value: number | null, curve: MetricCurve): number | null {
  if (value === null || !Number.isFinite(value)) return null;

  // Checked before the value, not after. A curve whose `poor` is not worse than
  // its `good` is a misconfiguration, and answering 100 from it would be a
  // confident number derived from nonsense. Refusing to score says so.
  const span = curve.poor - curve.good;
  if (!Number.isFinite(span) || span <= 0) return null;

  if (value <= curve.good) return 100;
  if (value >= curve.poor) return 0;

  return Math.round(((curve.poor - value) / span) * 100);
}

// ---------------------------------------------------------------------------
// Performance sub-weights
// ---------------------------------------------------------------------------

/**
 * One component of the Performance score.
 *
 * `curve` is null where `docs/SCORING.md` declares a weight but defines no
 * thresholds. That gap is represented in the data rather than hidden in the
 * logic, so the report can say which parts of Performance were not scored and
 * why.
 */
export interface PerformanceComponent {
  readonly key: string;
  readonly label: string;
  /** Percentage of the Performance score, as declared in docs/SCORING.md. */
  readonly declaredWeight: number;
  readonly curve: MetricCurve | null;
  /** Why this component cannot be scored yet. Null when it can. */
  readonly undefinedReason: string | null;
}

/**
 * The Performance sub-weights.
 *
 * Four of the seven components have a declared weight but no defined
 * thresholds: `docs/SCORING.md` defers page weight, image optimization and JS
 * cost to Phase 8, and Phase 8 collected the raw measurements without defining
 * curves for them. "Other" was never given a definition at all.
 *
 * Those four are declared here with `curve: null` rather than being given
 * invented thresholds (CLAUDE.md). The scoring engine excludes them and
 * redistributes their weight across the components it can score, which is the
 * same rule `docs/SCORING.md` already applies to unassessable categories
 * (ADR-036) — see ADR-052.
 */
export const PERFORMANCE_COMPONENTS: readonly PerformanceComponent[] = [
  {
    key: "lcp",
    label: "Largest Contentful Paint",
    declaredWeight: 25,
    curve: METRIC_CURVES.lcp,
    undefinedReason: null,
  },
  {
    key: "tbt",
    label: "Total Blocking Time",
    declaredWeight: 20,
    curve: METRIC_CURVES.tbt,
    undefinedReason: null,
  },
  {
    key: "cls",
    label: "Cumulative Layout Shift",
    declaredWeight: 15,
    curve: METRIC_CURVES.cls,
    undefinedReason: null,
  },
  {
    key: "pageWeight",
    label: "Page weight",
    declaredWeight: 10,
    curve: null,
    undefinedReason:
      "docs/SCORING.md defines no good/poor thresholds for page weight, so it cannot be normalised.",
  },
  {
    key: "imageOptimization",
    label: "Image optimization",
    declaredWeight: 10,
    curve: null,
    undefinedReason:
      "docs/SCORING.md defines no good/poor thresholds for image optimization, so it cannot be normalised.",
  },
  {
    key: "jsCost",
    label: "JavaScript cost",
    declaredWeight: 10,
    curve: null,
    undefinedReason:
      "docs/SCORING.md defines no good/poor thresholds for JavaScript cost, so it cannot be normalised.",
  },
  {
    key: "other",
    label: "Other",
    declaredWeight: 10,
    curve: null,
    undefinedReason:
      "docs/SCORING.md allocates weight to 'Other' without saying what it covers, so nothing can be measured against it.",
  },
];

/** Every category, in the order the report presents them. */
export const SCORED_CATEGORIES: readonly AnalysisCategory[] = [
  "performance",
  "seo",
  "accessibility",
  "security",
  "mobile",
  "content",
  "ux",
];
