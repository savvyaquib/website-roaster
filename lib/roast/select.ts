/**
 * Choosing what to roast, and stating it.
 *
 * Source of truth: ADR-015, ADR-056.
 *
 * Two jobs, both deterministic and both done **before** any model is asked:
 *
 * 1. Which findings are roastable, and which few of them to use.
 * 2. What the observable fact about each one actually is.
 *
 * Doing the selection first is what keeps a roast honest. The model is handed a
 * short list of real problems and asked for jokes about those; it never chooses
 * the subject, so it cannot reach for a funnier problem that does not exist.
 */

import { deriveTitle } from "@/lib/recommendations";
import type { RecommendationReport } from "@/lib/recommendations";
import type { Finding } from "@/lib/types/finding";

/** Lines in a roast. Short enough to read at a glance, per ADR-015. */
export const DEFAULT_LINE_COUNT = 4;

/**
 * Severity order for sites with no ranking supplied.
 *
 * Used only as a fallback: Phase 13's ranking is the better ordering and is
 * preferred whenever a caller has one.
 */
const SEVERITY_ORDER = ["critical", "serious", "moderate", "minor", "info"] as const;

/**
 * Findings a roast may be built from.
 *
 * Failures and warnings only. A passing check is not funny, and a check that
 * could not be determined has established nothing to joke about — treating one
 * as a problem is exactly the fabrication ADR-015 forbids (ADR-021).
 */
export function roastableFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter(
    (finding) =>
      (finding.status === "fail" || finding.status === "warn") &&
      finding.severity !== "info",
  );
}

/**
 * The findings to roast, worst first.
 *
 * Ordered by Phase 13's ranking when one is supplied, so the roast is about the
 * same problems the report leads with. Without one, by severity and then by id,
 * which keeps the choice stable across runs.
 */
export function selectRoastTargets(
  findings: readonly Finding[],
  recommendations: RecommendationReport | undefined,
  lineCount = DEFAULT_LINE_COUNT,
): Finding[] {
  const ranks = new Map<string, number>();
  for (const recommendation of recommendations?.recommendations ?? []) {
    ranks.set(recommendation.findingId, recommendation.rank);
  }

  return roastableFindings(findings)
    .slice()
    .sort((a, b) => {
      const byRank =
        (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      if (byRank !== 0) return byRank;

      const bySeverity =
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
      if (bySeverity !== 0) return bySeverity;

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.max(0, lineCount));
}

/**
 * The observable fact a line is about.
 *
 * Reuses Phase 13's title derivation rather than growing a second one. Both
 * want the same thing — the finding's own short statement of what was seen —
 * and two derivations of it would eventually disagree.
 *
 * The result is a sentence, because a roast line reads as one.
 */
export function observationFor(finding: Finding): string {
  const { title } = deriveTitle(finding);

  return /[.!?]$/.test(title) ? title : `${title}.`;
}
