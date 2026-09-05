/**
 * Scoring Performance from raw metrics.
 *
 * Source of truth: docs/SCORING.md "Performance sub-weights" and "Metric
 * curves", ADR-012, ADR-030, ADR-036, ADR-052.
 *
 * Performance is the one category with a defined sub-weight table, so it is
 * scored differently from the rest: a weighted sum of normalised metrics rather
 * than deductions from findings. `docs/SCORING.md` rule 4 says as much — metric
 * findings "do not use this table" and are scored by the curves instead.
 *
 * ## Raw values survive
 *
 * Every contribution keeps the measurement in its original unit alongside the
 * normalised 0-100 value. The raw number is never overwritten by its score
 * (ADR-012), which is what allows the weights to change later without
 * re-running the audit.
 */

import type { PerformanceMeasurements } from "@/lib/analysis/performance";

import { gradeFor } from "./grade";
import type { CategoryScore, MetricContribution } from "./types";
import { normaliseMetric, PERFORMANCE_COMPONENTS } from "./weights";

/** Pull the raw value for a component out of the measurements. */
function rawValueFor(key: string, measurements: PerformanceMeasurements): number | null {
  switch (key) {
    case "lcp":
      return measurements.lcpMs;
    case "tbt":
      return measurements.tbtMs;
    case "cls":
      return measurements.clsScore;
    // The remaining components have no curve, so their raw values are not read
    // here. They are still collected and stored by Phase 8 (ADR-012), ready for
    // the moment thresholds are defined.
    default:
      return null;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Score Performance.
 *
 * A component contributes only when it has both a defined curve and a measured
 * value. The weight of every excluded component is redistributed across those
 * that remain, in proportion to their declared weights — the same rule
 * `docs/SCORING.md` applies to unassessable categories, one level down
 * (ADR-052).
 *
 * @param measurements raw metrics from Phase 8, or undefined when the
 *   performance audit did not run.
 */
export function scorePerformance(
  measurements: PerformanceMeasurements | undefined,
): CategoryScore {
  if (measurements === undefined) {
    return notAssessed(
      "No performance measurements were supplied, so nothing about this page's performance was established.",
      [],
    );
  }

  // Work out which components can contribute before weighting anything, so the
  // redistribution is computed from the real set rather than assumed.
  const evaluated = PERFORMANCE_COMPONENTS.map((component) => {
    const rawValue = rawValueFor(component.key, measurements);
    const normalisedScore =
      component.curve === null ? null : normaliseMetric(rawValue, component.curve);

    const excludedReason =
      component.undefinedReason ??
      (rawValue === null
        ? `${component.label} was not measured, so it could not be scored.`
        : null);

    return { component, rawValue, normalisedScore, excludedReason };
  });

  const included = evaluated.filter(
    (item) => item.excludedReason === null && item.normalisedScore !== null,
  );

  const totalIncludedWeight = included.reduce(
    (sum, item) => sum + item.component.declaredWeight,
    0,
  );

  if (included.length === 0 || totalIncludedWeight === 0) {
    return notAssessed(
      "No performance metric could be scored: none of the components with defined thresholds had a measured value.",
      evaluated.map((item) => ({
        key: item.component.key,
        label: item.component.label,
        rawValue: item.rawValue,
        unit: item.component.curve?.unit ?? "",
        normalisedScore: item.normalisedScore,
        declaredWeight: item.component.declaredWeight,
        effectiveWeight: 0,
        contribution: 0,
        excludedReason: item.excludedReason,
      })),
    );
  }

  const metrics: MetricContribution[] = evaluated.map((item) => {
    const isIncluded = included.includes(item);

    const effectiveWeight = isIncluded
      ? round2((item.component.declaredWeight / totalIncludedWeight) * 100)
      : 0;

    return {
      key: item.component.key,
      label: item.component.label,
      rawValue: item.rawValue,
      unit: item.component.curve?.unit ?? "",
      normalisedScore: item.normalisedScore,
      declaredWeight: item.component.declaredWeight,
      effectiveWeight,
      // Computed from the rounded effective weight that the report displays, so
      // a reader can reproduce the arithmetic from what they see.
      contribution: isIncluded
        ? round2(((item.normalisedScore ?? 0) * effectiveWeight) / 100)
        : 0,
      excludedReason: item.excludedReason,
    };
  });

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(metrics.reduce((sum, metric) => sum + metric.contribution, 0)),
    ),
  );

  const excludedCount = metrics.filter((metric) => metric.excludedReason !== null).length;

  const breakdown = metrics
    .filter((metric) => metric.excludedReason === null)
    .map(
      (metric) =>
        `${metric.label} ${metric.rawValue}${metric.unit} scored ${metric.normalisedScore} at ${metric.effectiveWeight}%`,
    )
    .join("; ");

  return {
    category: "performance",
    status: "scored",
    score,
    grade: gradeFor(score),
    method: "metric_curves",
    findingCount: 0,
    deductions: [],
    totalDeducted: 0,
    metrics,
    notAssessedReason: null,
    explanation:
      `performance scored ${score}/100 (${gradeFor(score) ?? "-"}) from ${included.length} metric(s): ${breakdown}. ` +
      (excludedCount > 0
        ? `${excludedCount} component(s) were excluded and their weight redistributed across the rest.`
        : "Every component contributed."),
  };
}

function notAssessed(reason: string, metrics: MetricContribution[]): CategoryScore {
  return {
    category: "performance",
    status: "not_assessed",
    score: null,
    grade: null,
    method: "metric_curves",
    findingCount: 0,
    deductions: [],
    totalDeducted: 0,
    metrics,
    notAssessedReason: reason,
    explanation: `performance was not assessed. ${reason} It is excluded from the overall score rather than scored as zero.`,
  };
}
