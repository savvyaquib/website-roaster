/**
 * Ordering recommendations.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 13, ADR-053.
 *
 * ## The sort, and why it is in this order
 *
 * Phase 13's goal is "rank problems according to impact", so impact leads. The
 * keys, applied in order until one separates two entries:
 *
 * 1. **Impact level** — high before medium before low before none. This is the
 *    analyzer's judgement of how bad the problem is, and it leads because it is
 *    the one key not distorted by an unsettled category weight (ADR-037).
 * 2. **Severity** — critical before serious, and so on.
 * 3. **Recoverable points, descending** — how far the overall score moves. This
 *    is where `docs/SCORING.md`'s weights do their work, separating two equally
 *    severe problems in different categories. A finding whose points cannot be
 *    computed sorts after one whose can, at the same severity.
 * 4. **Status** — a broken thing before a risky one before an undecided one.
 * 5. **Priority tier** — the four tiers `docs/IMPLEMENTATION.md` lists, as a
 *    tiebreak between otherwise indistinguishable entries.
 * 6. **Finding id** — so the order is total and two runs over the same evidence
 *    produce byte-identical output.
 *
 * There is no key after the id, and ids are unique within a run, so nothing is
 * left to input order. The ranking is deterministic.
 *
 * ## Where this disagrees with the document, and why
 *
 * `docs/IMPLEMENTATION.md` lists "severe technical problems" first, which reads
 * as a category ordering. It is applied as key 5 rather than key 1 because the
 * phase's stated goal is ranking by impact, and because a ranking that
 * contradicted the score would make the report say two different things about
 * what matters. See ADR-053.
 */

import type { Finding } from "@/lib/types/finding";

import {
  IMPACT_LEVEL_ORDER,
  orderIndex,
  SEVERITY_ORDER,
  STATUS_ORDER,
  TIER_LABELS,
} from "./tiers";
import type { PriorityTier, Recommendation, RecommendationImpact } from "./types";

/** A recommendation before it has been given its position. */
export interface UnrankedRecommendation extends Omit<Recommendation, "rank"> {
  readonly finding: Finding;
}

/**
 * Compare two recommendations.
 *
 * Returns a negative number when `a` should appear first. Exported so the
 * ordering can be tested directly rather than only through its results.
 */
export function compareRecommendations(
  a: UnrankedRecommendation,
  b: UnrankedRecommendation,
): number {
  const byLevel =
    orderIndex(IMPACT_LEVEL_ORDER, a.impact.level) -
    orderIndex(IMPACT_LEVEL_ORDER, b.impact.level);
  if (byLevel !== 0) return byLevel;

  const bySeverity =
    orderIndex(SEVERITY_ORDER, a.finding.severity) -
    orderIndex(SEVERITY_ORDER, b.finding.severity);
  if (bySeverity !== 0) return bySeverity;

  const byPoints = comparePoints(a.impact, b.impact);
  if (byPoints !== 0) return byPoints;

  const byStatus =
    orderIndex(STATUS_ORDER, a.finding.status) -
    orderIndex(STATUS_ORDER, b.finding.status);
  if (byStatus !== 0) return byStatus;

  const byTier = a.tier - b.tier;
  if (byTier !== 0) return byTier;

  return a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0;
}

/**
 * Higher recoverable points first.
 *
 * A null — Performance, which the deduction table does not price — sorts after
 * any computed value at the same severity. It is placed, not scored: treating
 * null as zero would rank an unpriceable problem below a trivial one, and
 * treating it as high would invent a number.
 */
function comparePoints(a: RecommendationImpact, b: RecommendationImpact): number {
  if (a.points === null && b.points === null) return 0;
  if (a.points === null) return 1;
  if (b.points === null) return -1;

  return b.points - a.points;
}

/** Sort and number a list of recommendations. */
export function rankRecommendations(
  unranked: readonly UnrankedRecommendation[],
): Recommendation[] {
  return [...unranked].sort(compareRecommendations).map((recommendation, index) => ({
    ...recommendation,
    rank: index + 1,
    rankExplanation: explainRank(recommendation, index + 1, unranked.length),
  }));
}

/** Why a recommendation landed where it did. */
function explainRank(
  recommendation: UnrankedRecommendation,
  rank: number,
  total: number,
): string {
  const { finding, impact, tier } = recommendation;

  const worth =
    impact.points === null
      ? "its score effect cannot be priced from a finding"
      : `fixing it returns ${impact.points} point(s) to the overall score`;

  return (
    `Ranked ${rank} of ${total}. ` +
    `${impact.level} impact, ${finding.severity} severity, status ${finding.status} in ${finding.category}; ` +
    `${worth}. Tier ${tier} (${tierLabel(tier)}).`
  );
}

export function tierLabel(tier: PriorityTier): string {
  return TIER_LABELS[tier];
}
