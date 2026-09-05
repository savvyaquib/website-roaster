/**
 * The priority tiers, and the impact bands.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 13, docs/SCORING.md deduction
 * table, ADR-053.
 *
 * Presentation constants. Nothing here changes a score — the scoring model
 * lives in `lib/scoring/weights.ts` and this module reads from it rather than
 * restating any of it.
 */

import { deductionFor } from "@/lib/scoring";
import type {
  AnalysisCategory,
  FindingSeverity,
  FindingStatus,
} from "@/lib/types/finding";

import type { ImpactLevel, PriorityTier } from "./types";

/**
 * The four tiers `docs/IMPLEMENTATION.md` Phase 13 lists, in its order:
 *
 * 1. severe technical problems
 * 2. major usability problems
 * 3. problems affecting conversion or discoverability
 * 4. minor polish
 */
export const TIER_LABELS: Readonly<Record<PriorityTier, string>> = {
  1: "Severe technical problems",
  2: "Major usability problems",
  3: "Conversion and discoverability",
  4: "Minor polish",
};

/**
 * Which tier a category's problems belong to.
 *
 * Read off the document's own wording: security and performance are the
 * technical ones, accessibility, mobile and UX are what a person struggles
 * with, and SEO and content are what decides whether anyone arrives and buys.
 */
const CATEGORY_TIERS: Readonly<Record<AnalysisCategory, PriorityTier>> = {
  security: 1,
  performance: 1,
  accessibility: 2,
  mobile: 2,
  ux: 2,
  seo: 3,
  content: 3,
};

/**
 * The severities that are "minor polish" whatever category they came from.
 *
 * The document's fourth tier is the only one named by size rather than by
 * kind, so it overrides the category mapping. A minor security nit is polish;
 * it is not a severe technical problem.
 */
const POLISH_SEVERITIES: readonly FindingSeverity[] = ["minor", "info"];

/** The tier a finding belongs to. */
export function tierFor(
  category: AnalysisCategory,
  severity: FindingSeverity,
): PriorityTier {
  if (POLISH_SEVERITIES.includes(severity)) return 4;

  return CATEGORY_TIERS[category] ?? 4;
}

/**
 * Impact bands, expressed in the deduction table's own numbers.
 *
 * Each boundary is a value that already appears in `docs/SCORING.md`, so no new
 * thresholds are introduced here:
 *
 * - **15** is a serious failure, the point at which something is plainly broken.
 * - **4** is a moderate warning, the smallest deduction that is not a nit.
 * - **1** is a minor warning, the smallest deduction there is.
 *
 * The band is computed from severity and status alone, deliberately. It says
 * how bad the problem is, which is the analyzer's judgement, and not how far
 * the score moves, which depends on a category weight that ADR-037 has not
 * settled.
 */
export const IMPACT_BANDS: readonly {
  readonly level: ImpactLevel;
  readonly minDeduction: number;
}[] = [
  { level: "high", minDeduction: 15 },
  { level: "medium", minDeduction: 4 },
  { level: "low", minDeduction: 1 },
  { level: "none", minDeduction: 0 },
];

/** How bad a finding is, banded. */
export function impactLevelFor(
  severity: FindingSeverity,
  status: FindingStatus,
): ImpactLevel {
  const deduction = deductionFor(severity, status);

  for (const band of IMPACT_BANDS) {
    if (deduction >= band.minDeduction) return band.level;
  }

  return "none";
}

/** Impact levels, worst first. The ranked list's primary ordering. */
export const IMPACT_LEVEL_ORDER: readonly ImpactLevel[] = [
  "high",
  "medium",
  "low",
  "none",
];

/** Severities, worst first. */
export const SEVERITY_ORDER: readonly FindingSeverity[] = [
  "critical",
  "serious",
  "moderate",
  "minor",
  "info",
];

/**
 * Statuses, most urgent first.
 *
 * `pass` is last and never reaches a ranked list; it is included so the order
 * is total over the whole status type rather than over a subset of it.
 */
export const STATUS_ORDER: readonly FindingStatus[] = [
  "fail",
  "warn",
  "could_not_determine",
  "pass",
];

/** Position in an ordering, with unknown values sorted last. */
export function orderIndex<T>(order: readonly T[], value: T): number {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}
