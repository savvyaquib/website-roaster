/**
 * Phase 12 — the deterministic scoring engine.
 *
 * Source of truth: docs/SCORING.md, docs/DECISIONS.md ADR-002, ADR-012,
 * ADR-013, ADR-036, ADR-052.
 *
 * Turns findings and raw metrics into category scores and an overall score.
 *
 * ## Deterministic, and only deterministic
 *
 * Pure arithmetic over evidence. No I/O, no clock, no randomness, and **no AI**
 * — ADR-002 requires a user to be able to understand why they got a score, and
 * a number an opinion produced cannot be explained. There is a test asserting
 * this module imports nothing model-shaped.
 *
 * ## Everything reconstructs
 *
 * Each category records the deductions or metric contributions that produced
 * it; the overall score records the weight each category was given. A reader
 * can recompute every number from the report, and a test does exactly that.
 *
 * ## Layer separation
 *
 * Analyzer logic lives in `lib/analysis`. The weights live in `weights.ts`,
 * mirroring `docs/SCORING.md`. The calculations live here. None of it lives in
 * the UI (CLAUDE.md, ADR-001).
 */

import type { AnalysisCategory, Finding } from "@/lib/types/finding";

import { gradeFor } from "./grade";
import { scoreCategoryFromFindings } from "./score-category";
import { scorePerformance } from "./score-performance";
import type {
  CategoryScore,
  CategoryWeighting,
  OverallScore,
  ScoreReport,
  ScoringInput,
} from "./types";
import { CATEGORY_WEIGHTS, SCORED_CATEGORIES } from "./weights";
import { SCORING_VERSION } from "./version";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Group findings by the category that produced them. */
function groupByCategory(findings: readonly Finding[]): Map<AnalysisCategory, Finding[]> {
  const grouped = new Map<AnalysisCategory, Finding[]>();

  for (const category of SCORED_CATEGORIES) grouped.set(category, []);

  for (const finding of findings) {
    // A finding for an unknown category is dropped rather than silently folded
    // into another one; the category list is closed and adding to it is a
    // deliberate change.
    grouped.get(finding.category)?.push(finding);
  }

  return grouped;
}

/**
 * Score every category.
 *
 * Performance is scored from raw metrics by curve; every other category is
 * scored from its findings by deduction. That split is `docs/SCORING.md`'s,
 * not an implementation convenience — Performance is the only category with a
 * defined sub-weight table.
 */
export function scoreCategories(input: ScoringInput): CategoryScore[] {
  const grouped = groupByCategory(input.findings);

  return SCORED_CATEGORIES.map((category) =>
    category === "performance"
      ? scorePerformance(input.performance)
      : scoreCategoryFromFindings(category, grouped.get(category) ?? []),
  );
}

/**
 * Combine category scores into an overall score.
 *
 * Categories that were not assessed are excluded and their weight is
 * redistributed proportionally across the rest (ADR-036). The overall score is
 * computed from the **rounded** category scores the report displays, so a
 * reader can reproduce it from what they see rather than from hidden precision.
 */
export function scoreOverall(categories: readonly CategoryScore[]): OverallScore {
  const assessed = categories.filter(
    (category) => category.status === "scored" && category.score !== null,
  );

  const totalAssessedWeight = assessed.reduce(
    (sum, category) => sum + CATEGORY_WEIGHTS[category.category],
    0,
  );

  const weighting: CategoryWeighting[] = categories.map((category) => {
    const declaredWeight = CATEGORY_WEIGHTS[category.category];
    const isAssessed = assessed.includes(category);

    const effectiveWeight =
      isAssessed && totalAssessedWeight > 0
        ? round2((declaredWeight / totalAssessedWeight) * 100)
        : 0;

    return {
      category: category.category,
      declaredWeight,
      effectiveWeight,
      score: category.score,
      contribution:
        isAssessed && category.score !== null
          ? round2((category.score * effectiveWeight) / 100)
          : 0,
    };
  });

  const assessedCategories = assessed.map((category) => category.category);
  const notAssessedCategories = categories
    .filter((category) => !assessed.includes(category))
    .map((category) => category.category);

  if (assessed.length === 0) {
    return {
      score: null,
      grade: null,
      weighting,
      assessedCategories,
      notAssessedCategories,
      explanation:
        "No category could be assessed, so there is no overall score. This is not a score of zero: nothing about this site was established.",
    };
  }

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(weighting.reduce((sum, entry) => sum + entry.contribution, 0)),
    ),
  );

  const breakdown = weighting
    .filter((entry) => entry.effectiveWeight > 0)
    .map((entry) => `${entry.category} ${entry.score} at ${entry.effectiveWeight}%`)
    .join("; ");

  const exclusions =
    notAssessedCategories.length === 0
      ? "Every category contributed."
      : `${notAssessedCategories.join(", ")} could not be assessed, so ${100 - totalAssessedWeight}% of the declared weight was redistributed across the rest.`;

  return {
    score,
    grade: gradeFor(score),
    weighting,
    assessedCategories,
    notAssessedCategories,
    explanation: `Overall ${score}/100 (${gradeFor(score) ?? "-"}) from ${assessed.length} of ${categories.length} categories: ${breakdown}. ${exclusions}`,
  };
}

/**
 * Score an analysis.
 *
 * The engine's entry point. Deterministic: the same evidence always produces
 * the same report.
 */
export function scoreAnalysis(input: ScoringInput): ScoreReport {
  const categories = scoreCategories(input);

  return {
    scoringVersion: SCORING_VERSION,
    overall: scoreOverall(categories),
    categories,
  };
}
