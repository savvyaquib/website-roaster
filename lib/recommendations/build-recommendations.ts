/**
 * Phase 13 — the recommendation engine.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 13, docs/DECISIONS.md ADR-021,
 * ADR-029, ADR-053.
 *
 * Turns findings into a prioritized list of things to do.
 *
 * ## Deterministic, and only deterministic
 *
 * Pure: findings in, ranked list out. No I/O, no clock, no randomness and **no
 * AI** — that arrives in Phase 14 and interprets this list rather than
 * producing it. There is a test asserting this module imports nothing
 * model-shaped.
 *
 * ## Which findings become recommendations
 *
 * - `fail` and `warn` become a **fix**. Something is wrong and can be acted on.
 * - `could_not_determine` becomes a **review**. The check could not decide, and
 *   saying so is the whole point of ADR-021. Dropping these would hide exactly
 *   what that decision exists to surface, so they are ranked last with no
 *   recoverable points and a distinct kind.
 * - `pass` becomes nothing. Several analyzers attach advice to a passing check
 *   — "keep the canonical pointing here if the URL changes" — which is worth
 *   showing in a report but is not a problem to prioritize. The count survives
 *   in the summary.
 */

import type { ScoreReport } from "@/lib/scoring";
import type { AnalysisCategory, Finding } from "@/lib/types/finding";

import { impactFor, weightBasisFor } from "./impact";
import { rankRecommendations, tierLabel } from "./rank";
import type { UnrankedRecommendation } from "./rank";
import { IMPACT_LEVEL_ORDER, impactLevelFor, orderIndex, tierFor } from "./tiers";
import { deriveTitle } from "./title";
import type {
  ImpactLevel,
  PriorityTier,
  Recommendation,
  RecommendationKind,
  RecommendationReport,
  RecommendationSummary,
} from "./types";

/**
 * What the engine consumes.
 *
 * The score report is optional and improves the answer rather than enabling it:
 * with it, recoverable points are computed against the weights a category
 * actually carried; without it, against the weights `docs/SCORING.md` declares.
 */
export interface RecommendationInput {
  readonly findings: readonly Finding[];
  readonly score?: ScoreReport;
}

/** Whether a finding is worth recommending, and as what. */
function kindFor(finding: Finding): RecommendationKind | null {
  switch (finding.status) {
    case "fail":
    case "warn":
      return "fix";
    case "could_not_determine":
      return "review";
    case "pass":
      return null;
  }
}

/**
 * Build a prioritized list of recommendations.
 *
 * Deterministic: the same findings always produce the same list, in the same
 * order, with the same ranks.
 */
export function buildRecommendations(input: RecommendationInput): RecommendationReport {
  const unranked: UnrankedRecommendation[] = [];
  let passingFindings = 0;

  for (const finding of input.findings) {
    const kind = kindFor(finding);

    if (kind === null) {
      passingFindings += 1;
      continue;
    }

    const { title, source } = deriveTitle(finding);
    const tier = tierFor(finding.category, finding.severity);

    unranked.push({
      findingId: finding.id,
      kind,
      title,
      titleSource: source,
      impact: impactFor(finding, input.score),
      tier,
      tierLabel: tierLabel(tier),
      // Replaced during ranking, once the position is known.
      rankExplanation: "",
      finding,
    });
  }

  const recommendations = rankRecommendations(unranked);

  return {
    recommendations,
    weightBasis: weightBasisFor(input.score),
    summary: summarise(recommendations, passingFindings),
  };
}

function summarise(
  recommendations: readonly Recommendation[],
  passingFindings: number,
): RecommendationSummary {
  const byLevel: Record<ImpactLevel, number> = {
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
  };
  const byTier: Record<PriorityTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const byCategory: Partial<Record<AnalysisCategory, number>> = {};

  let fixes = 0;
  let needsReview = 0;
  let recoverablePoints = 0;
  let unquantified = 0;

  for (const recommendation of recommendations) {
    byLevel[recommendation.impact.level] += 1;
    byTier[recommendation.tier] += 1;

    const category = recommendation.finding.category;
    byCategory[category] = (byCategory[category] ?? 0) + 1;

    if (recommendation.kind === "fix") fixes += 1;
    else needsReview += 1;

    if (recommendation.impact.points === null) unquantified += 1;
    else recoverablePoints += recommendation.impact.points;
  }

  return {
    total: recommendations.length,
    fixes,
    needsReview,
    byLevel,
    byTier,
    byCategory,
    recoverablePoints: Math.round(recoverablePoints * 100) / 100,
    unquantified,
    passingFindings,
  };
}

/**
 * The top recommendations.
 *
 * A convenience over the ranked list for callers showing a short summary. It
 * takes from the front, so it inherits the ordering rather than applying a
 * second, different one.
 */
export function topRecommendations(
  report: RecommendationReport,
  count: number,
): readonly Recommendation[] {
  return report.recommendations.slice(0, Math.max(0, count));
}

/**
 * The recommendations whose impact level is at least `level`.
 *
 * Uses the same banding as the ranking, so "the high-impact ones" means the
 * same thing everywhere.
 */
export function recommendationsAtLeast(
  report: RecommendationReport,
  level: ImpactLevel,
): readonly Recommendation[] {
  const floor = orderIndex(IMPACT_LEVEL_ORDER, level);

  return report.recommendations.filter(
    (recommendation) =>
      orderIndex(IMPACT_LEVEL_ORDER, recommendation.impact.level) <= floor,
  );
}

export { impactLevelFor };
