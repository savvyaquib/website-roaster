/**
 * Scoring a category from its findings.
 *
 * Source of truth: docs/SCORING.md "From findings to a score", ADR-021,
 * ADR-036.
 *
 * Pure arithmetic. No analyzer logic, no I/O, no AI.
 *
 * ## Why there is no per-check weight table
 *
 * `docs/SCORING.md` says sub-weights for these categories are "not yet
 * defined". They are not needed: the per-check weighting is already carried by
 * each finding's **severity**, which the analyzer that produced it assigned.
 * A second table mapping check to weight would duplicate that and could
 * disagree with it. See ADR-052.
 */

import type { AnalysisCategory, Finding } from "@/lib/types/finding";

import { gradeFor } from "./grade";
import type { CategoryScore, FindingDeduction } from "./types";
import { deductionFor } from "./weights";

const STARTING_SCORE = 100;

/** Severity order, worst first, so the biggest deductions are listed first. */
const SEVERITY_ORDER = ["critical", "serious", "moderate", "minor", "info"] as const;

/**
 * Was this category assessed at all?
 *
 * A category counts as assessed when at least one finding reached a verdict.
 * Two cases mean it did not:
 *
 * - **no findings**, because the analyzer never ran or produced nothing;
 * - **every finding is `could_not_determine`**, which is what an analyzer emits
 *   when it could not establish anything.
 *
 * Both must produce "not assessed" rather than 100. A category with nothing to
 * deduct from would otherwise score full marks for having been unmeasurable,
 * which is the exact failure ADR-021 exists to prevent.
 */
export function wasAssessed(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.status !== "could_not_determine");
}

function describeDeductions(deductions: readonly FindingDeduction[]): string {
  if (deductions.length === 0) return "Nothing was deducted.";

  const bySeverity = new Map<string, { count: number; points: number }>();

  for (const deduction of deductions) {
    const entry = bySeverity.get(deduction.severity) ?? { count: 0, points: 0 };
    entry.count += 1;
    entry.points += deduction.deduction;
    bySeverity.set(deduction.severity, entry);
  }

  const parts = SEVERITY_ORDER.filter((severity) => bySeverity.has(severity)).map(
    (severity) => {
      const entry = bySeverity.get(severity);
      return `${entry?.count ?? 0} ${severity} (-${entry?.points ?? 0})`;
    },
  );

  return `Deducted ${parts.join(", ")}.`;
}

/**
 * Score one category from its findings.
 *
 * Starts at 100 and subtracts, clamping at zero. Every deduction is recorded
 * against the finding that caused it, so the number can be reconstructed by
 * hand from the report.
 *
 * @param category the category being scored.
 * @param findings every finding for that category, including passes — they are
 *   counted in `findingCount` even though they deduct nothing, because the
 *   report shows what a site got right.
 */
export function scoreCategoryFromFindings(
  category: AnalysisCategory,
  findings: readonly Finding[],
): CategoryScore {
  if (!wasAssessed(findings)) {
    const reason =
      findings.length === 0
        ? "No findings were produced for this category, so nothing about it was established."
        : "Every check reported that it could not determine an answer, so nothing about this category was established.";

    return {
      category,
      status: "not_assessed",
      score: null,
      grade: null,
      method: "deductions",
      findingCount: findings.length,
      deductions: [],
      totalDeducted: 0,
      metrics: [],
      notAssessedReason: reason,
      explanation: `${category} was not assessed. ${reason} It is excluded from the overall score rather than scored as zero.`,
    };
  }

  const deductions: FindingDeduction[] = [];

  for (const finding of findings) {
    const deduction = deductionFor(finding.severity, finding.status);
    if (deduction === 0) continue;

    deductions.push({
      findingId: finding.id,
      severity: finding.severity,
      status: finding.status,
      deduction,
    });
  }

  const totalDeducted = deductions.reduce((sum, item) => sum + item.deduction, 0);
  // Clamped, never negative: a page cannot be worse than nothing.
  const score = Math.max(0, STARTING_SCORE - totalDeducted);

  const clampNote =
    totalDeducted > STARTING_SCORE
      ? ` Deductions totalled ${totalDeducted}, which was clamped at ${STARTING_SCORE}.`
      : "";

  return {
    category,
    status: "scored",
    score,
    grade: gradeFor(score),
    method: "deductions",
    findingCount: findings.length,
    deductions,
    totalDeducted,
    metrics: [],
    notAssessedReason: null,
    explanation:
      `${category} scored ${score}/100 (${gradeFor(score) ?? "-"}). ` +
      `Started at ${STARTING_SCORE} across ${findings.length} check(s). ` +
      `${describeDeductions(deductions)}${clampNote}`,
  };
}
