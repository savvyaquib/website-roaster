/**
 * Recommendation types.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 13, docs/DECISIONS.md ADR-029,
 * ADR-053.
 *
 * ## A recommendation is a view, not a record
 *
 * ADR-029 is explicit: a recommendation is a **derived view** over a `Finding`,
 * not a second record type. So this type carries the ranking and presentation
 * it adds — rank, title, impact, tier — and a reference to the finding it came
 * from. It does **not** re-store the finding's severity, evidence, explanation
 * or recommended action.
 *
 * Everything a caller needs is on the recommendation:
 *
 * ```ts
 * recommendation.title                    // derived here
 * recommendation.impact                   // derived here
 * recommendation.finding.severity         // read from the source
 * recommendation.finding.evidence         // read from the source
 * recommendation.finding.explanation      // read from the source
 * recommendation.finding.recommendation   // read from the source
 * ```
 *
 * Reading through `finding` is deliberate and slightly more verbose than a flat
 * copy. It is the reason a recommendation can never disagree with the finding
 * that produced it: there is one copy of each of those values in the system.
 */

import type { AnalysisCategory, Finding } from "@/lib/types/finding";

/** What a recommendation is asking for. */
export type RecommendationKind =
  /** Something is wrong and can be fixed. `fail` or `warn`. */
  | "fix"
  /** The check could not decide; a person needs to look (ADR-021). */
  | "review";

/**
 * How much a problem matters.
 *
 * A judgement band, derived from the severity and status the analyzer assigned.
 * Distinct from `points`, which is how far the score would move — see
 * `RecommendationImpact`.
 */
export type ImpactLevel = "high" | "medium" | "low" | "none";

/**
 * The priority tiers `docs/IMPLEMENTATION.md` Phase 13 lists.
 *
 * Used as a tiebreak, not as the primary ordering — see `rank.ts`.
 */
export type PriorityTier = 1 | 2 | 3 | 4;

/** Where a derived title came from, so a reader knows it was not authored. */
export type TitleSource = "evidence" | "explanation" | "identifier";

/** Which weight the recoverable points were computed against. */
export type WeightBasis =
  /** The weight after redistribution, taken from a supplied score report. */
  | "effective"
  /** The weight docs/SCORING.md declares, used when no score report was given. */
  | "declared"
  /** The category is not scored by deduction, so no points can be computed. */
  | "not_applicable";

/**
 * What fixing this would be worth.
 *
 * Two different questions, kept apart on purpose:
 *
 * - `level` is **how bad it is**, banded from the severity and status the
 *   analyzer assigned.
 * - `points` is **how far the overall score would move**, computed from the
 *   deduction table and the category weight.
 *
 * They can disagree, and when they do the disagreement is real rather than a
 * bug. A critical security failure is `high` but recovers few points, because
 * `docs/SCORING.md` weights Security at 5% — the open question in ADR-037.
 * Collapsing the two into one number would hide that.
 */
export interface RecommendationImpact {
  readonly level: ImpactLevel;
  /**
   * Points returned to the **overall** score by fixing this, or null when it
   * cannot be computed.
   *
   * Null for Performance: `docs/SCORING.md` scores that category from metric
   * curves rather than from the deduction table, so what a fix is worth depends
   * on how far the metric moves, which a finding does not record. Null is not
   * zero — see ADR-053.
   */
  readonly points: number | null;
  /** Points this finding costs its own category, from the deduction table. */
  readonly categoryDeduction: number;
  /** The category weight used, as a percentage. Null when not applicable. */
  readonly categoryWeight: number | null;
  readonly weightBasis: WeightBasis;
  /** The arithmetic above, in words. */
  readonly explanation: string;
}

/**
 * One ranked, actionable recommendation.
 *
 * Built from exactly one finding, whose id it carries so the two can always be
 * joined back together.
 */
export interface Recommendation {
  /** The finding this was derived from. */
  readonly findingId: string;
  /** 1-based position in the ranked list. */
  readonly rank: number;
  readonly kind: RecommendationKind;
  /**
   * A short label naming the problem.
   *
   * Derived, not authored: the finding model has no title field. See
   * `title.ts` for the derivation and `titleSource` for which part of the
   * finding it came from.
   */
  readonly title: string;
  readonly titleSource: TitleSource;
  readonly impact: RecommendationImpact;
  readonly tier: PriorityTier;
  readonly tierLabel: string;
  /** Why this landed where it did in the list. */
  readonly rankExplanation: string;
  /**
   * The finding itself.
   *
   * Severity, status, category, evidence, explanation and the recommended
   * action are read from here rather than copied (ADR-029).
   */
  readonly finding: Finding;
}

/** Counts describing a ranked list, so a caller need not recompute them. */
export interface RecommendationSummary {
  readonly total: number;
  readonly fixes: number;
  readonly needsReview: number;
  readonly byLevel: Readonly<Record<ImpactLevel, number>>;
  readonly byTier: Readonly<Record<PriorityTier, number>>;
  readonly byCategory: Readonly<Partial<Record<AnalysisCategory, number>>>;
  /**
   * Total overall points recoverable, summing the recommendations whose points
   * could be computed. Performance is excluded and `unquantified` says so.
   */
  readonly recoverablePoints: number;
  readonly unquantified: number;
  /** Passing findings, which are never recommendations but are still counted. */
  readonly passingFindings: number;
}

/** A ranked list, with the counts describing it. */
export interface RecommendationReport {
  readonly recommendations: readonly Recommendation[];
  readonly weightBasis: WeightBasis;
  readonly summary: RecommendationSummary;
}
