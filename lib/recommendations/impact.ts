/**
 * What fixing a finding would be worth.
 *
 * Source of truth: docs/SCORING.md, ADR-036, ADR-052, ADR-053.
 *
 * ## This module computes nothing of its own
 *
 * The deduction table and the category weights are imported from
 * `lib/scoring`. Restating either here would create a second scoring model that
 * could disagree with the first, which is the failure ADR-052 was written to
 * prevent. This module only multiplies.
 */

import { CATEGORY_WEIGHTS, deductionFor } from "@/lib/scoring";
import type { ScoreReport } from "@/lib/scoring";
import type { Finding } from "@/lib/types/finding";

import { impactLevelFor } from "./tiers";
import type { RecommendationImpact, WeightBasis } from "./types";

/**
 * The category the deduction table does not apply to.
 *
 * `docs/SCORING.md` rule 4: metric-based findings are scored by the curves and
 * the Performance sub-weights, not by deductions. So a Performance finding's
 * severity says how bad it is but not what a fix returns — that depends on how
 * far the metric moves, which the finding does not record.
 */
const CURVE_SCORED_CATEGORIES = ["performance"] as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The weight to charge a category's findings against.
 *
 * With a score report in hand this is the **effective** weight — what the
 * category actually carried after unassessable categories were excluded and
 * their weight redistributed (ADR-036). Without one it is the weight
 * `docs/SCORING.md` declares.
 *
 * The two differ whenever anything was unassessable, and the difference is
 * real: fixing an SEO problem is worth more when three other categories could
 * not be measured. Which was used is recorded on every impact.
 */
export function weightBasisFor(score: ScoreReport | undefined): WeightBasis {
  return score === undefined ? "declared" : "effective";
}

/** What fixing this finding would return, and how bad it is meanwhile. */
export function impactFor(
  finding: Finding,
  score: ScoreReport | undefined,
): RecommendationImpact {
  const level = impactLevelFor(finding.severity, finding.status);
  const categoryDeduction = deductionFor(finding.severity, finding.status);

  if ((CURVE_SCORED_CATEGORIES as readonly string[]).includes(finding.category)) {
    return {
      level,
      points: null,
      categoryDeduction,
      categoryWeight: null,
      weightBasis: "not_applicable",
      explanation:
        `A ${finding.severity} ${finding.category} finding, rated ${level} impact. ` +
        "Performance is scored from metric curves rather than from the deduction table, so what this fix returns depends on how far the measurement moves. That is not zero — it is not something a finding can tell us.",
    };
  }

  const declaredWeight = CATEGORY_WEIGHTS[finding.category];
  const effective = score?.overall.weighting.find(
    (entry) => entry.category === finding.category,
  );

  const basis = weightBasisFor(score);
  const categoryWeight =
    basis === "effective" ? (effective?.effectiveWeight ?? 0) : declaredWeight;

  const points = round2((categoryDeduction * categoryWeight) / 100);

  return {
    level,
    points,
    categoryDeduction,
    categoryWeight,
    weightBasis: basis,
    explanation:
      `A ${finding.severity} ${finding.category} finding with status ${finding.status}, rated ${level} impact. ` +
      `It costs its category ${categoryDeduction} point(s); at ${categoryWeight}% ${basis === "effective" ? "effective" : "declared"} weight, fixing it returns ${points} point(s) to the overall score.`,
  };
}
