/**
 * Normalization of audit results into the Website Roaster finding model.
 *
 * Source of truth: docs/DECISIONS.md ADR-047.
 *
 * Pure: audit results in, `Finding[]` out. No browser, no network, no clock.
 * That is what lets the mapping be tested exhaustively with fixtures, which
 * matters because this is the layer where an external tool's vocabulary becomes
 * ours and a silent mismatch would be invisible.
 *
 * ## What is preserved
 *
 * Every finding carries the engine's **rule identifier**, its **severity**, the
 * **elements** it applied to, the engine's own **explanation**, and a link to
 * its documentation. Phase 7's acceptance criterion is that findings can be
 * traced back to actual audit evidence, and that is only true if the trail
 * survives normalization.
 */

import { findingFactory, preview } from "@/lib/analysis/finding-builder";
import type { Evidence, Finding, FindingSeverity } from "@/lib/types/finding";

import type { AxeAuditResults, AxeNode, AxeRule } from "./types";

const accessibilityFinding = findingFactory("accessibility");

/** Prefix for every finding produced from an engine rule. */
export const RULE_ID_PREFIX = "accessibility.axe";

/**
 * Elements listed per rule.
 *
 * A single rule can match hundreds of elements on a large page. Listing them
 * all would bury the finding; the count is always reported in full, so nothing
 * is hidden by the cap.
 */
export const MAX_REPORTED_NODES = 5;

/** Length cap on an HTML snippet used as evidence. */
const SNIPPET_LENGTH = 160;

/**
 * The engine's impact vocabulary maps onto ours directly.
 *
 * This is not a coincidence: the severity names in `lib/types/finding.ts` were
 * chosen to match the accessibility vocabulary precisely so this phase needs no
 * lossy translation table (ADR-029).
 */
const IMPACT_TO_SEVERITY: Readonly<Record<string, FindingSeverity>> = {
  critical: "critical",
  serious: "serious",
  moderate: "moderate",
  minor: "minor",
};

/**
 * Map an engine impact onto a finding severity.
 *
 * An unrecognised or absent impact becomes `moderate` rather than being
 * discarded: the engine found something worth reporting, and guessing low would
 * quietly demote a real problem.
 */
export function severityForImpact(impact: string | null | undefined): FindingSeverity {
  if (impact === null || impact === undefined) return "moderate";
  return IMPACT_TO_SEVERITY[impact.toLowerCase()] ?? "moderate";
}

/** `color-contrast` becomes `accessibility.axe.color-contrast`. */
export function findingIdForRule(ruleId: string): string {
  return `${RULE_ID_PREFIX}.${ruleId}`;
}

function nodeEvidence(nodes: readonly AxeNode[]): Evidence[] {
  return nodes.slice(0, MAX_REPORTED_NODES).map((node) => ({
    kind: "measured" as const,
    source: "axe" as const,
    summary: `Affected element: ${node.target.join(", ") || "(no selector reported)"}`,
    detail: preview(node.html, SNIPPET_LENGTH),
  }));
}

/** The engine's own words on how to fix a rule, falling back to its help text. */
function recommendationFor(rule: AxeRule): string {
  const summary = rule.nodes.find(
    (node) => (node.failureSummary ?? "").trim().length > 0,
  )?.failureSummary;

  const guidance = (summary ?? rule.help).trim();
  return `${guidance} See ${rule.helpUrl}`;
}

function wcagTags(rule: AxeRule): string[] {
  return rule.tags.filter(
    (tag) => tag.startsWith("wcag") || tag.startsWith("best-practice"),
  );
}

function ruleEvidence(rule: AxeRule, nodeCount: number): Evidence[] {
  const tags = wcagTags(rule);

  return [
    {
      kind: "measured",
      source: "axe",
      summary: `Rule "${rule.id}" matched ${nodeCount} element(s).`,
      detail: tags.length > 0 ? tags.join(", ") : rule.helpUrl,
    },
    ...nodeEvidence(rule.nodes),
  ];
}

function violationFinding(rule: AxeRule): Finding {
  return accessibilityFinding({
    id: findingIdForRule(rule.id),
    severity: severityForImpact(rule.impact),
    status: "fail",
    evidence: ruleEvidence(rule, rule.nodes.length),
    explanation: rule.description,
    recommendation: recommendationFor(rule),
  });
}

/**
 * A rule the engine could not decide.
 *
 * This maps onto `could_not_determine` exactly (ADR-021). Automated tooling
 * genuinely cannot settle some checks — whether an image's alt text is
 * *meaningful*, for instance — and reporting those as passes would be the
 * single most misleading thing this phase could do.
 */
function incompleteFinding(rule: AxeRule): Finding {
  return accessibilityFinding({
    id: `${findingIdForRule(rule.id)}.incomplete`,
    severity: severityForImpact(rule.impact),
    status: "could_not_determine",
    evidence: ruleEvidence(rule, rule.nodes.length),
    explanation: `${rule.description} The automated check could not decide this one way or the other, so it needs a human to look.`,
    recommendation: `Review these elements by hand. ${rule.help} See ${rule.helpUrl}`,
  });
}

/**
 * Passing rules, as a single finding.
 *
 * A typical page passes forty or more rules. One finding per pass would swamp
 * the report and make the failures harder to find, so the detail is summarised
 * and the rule identifiers are kept in the evidence.
 */
function passesFinding(passes: readonly AxeRule[]): Finding {
  const names = passes.map((rule) => rule.id).sort();

  return accessibilityFinding({
    id: "accessibility.axe.passes",
    severity: "info",
    status: "pass",
    evidence: [
      {
        kind: "measured",
        source: "axe",
        summary: `${passes.length} automated accessibility check(s) passed.`,
        detail: preview(names.join(", "), 400),
      },
    ],
    explanation:
      "These automated checks found no problem. Automated testing covers only part of accessibility, so this is not a statement that the page is accessible.",
    recommendation:
      "Keep these passing, and test with a keyboard and a screen reader for the parts automation cannot check.",
  });
}

/**
 * Turn an audit into findings.
 *
 * Ordering is deterministic: violations first, most severe first, then the
 * undecided checks, then the summary of passes. Within a severity, rules are
 * ordered by identifier so two runs of the same page produce the same list.
 */
export function normalizeAxeResults(results: AxeAuditResults): Finding[] {
  const severityRank: Readonly<Record<FindingSeverity, number>> = {
    critical: 0,
    serious: 1,
    moderate: 2,
    minor: 3,
    info: 4,
  };

  const violations = [...results.violations]
    .map(violationFinding)
    .sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] || a.id.localeCompare(b.id),
    );

  const incomplete = [...results.incomplete]
    .map(incompleteFinding)
    .sort((a, b) => a.id.localeCompare(b.id));

  return [
    ...violations,
    ...incomplete,
    ...(results.passes.length > 0 ? [passesFinding(results.passes)] : []),
  ];
}
