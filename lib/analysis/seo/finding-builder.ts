/**
 * Helpers for constructing SEO findings.
 *
 * Every finding in this phase is `category: "seo"` and carries at least one
 * piece of evidence, so those parts are supplied here rather than repeated in
 * every check.
 */

import type {
  Evidence,
  EvidenceKind,
  Finding,
  FindingSeverity,
  FindingStatus,
} from "@/lib/types/finding";

interface FindingInput {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly status: FindingStatus;
  readonly evidence: readonly Evidence[];
  readonly explanation: string;
  readonly recommendation?: string;
}

export function seoFinding(input: FindingInput): Finding {
  return { category: "seo", ...input };
}

/**
 * Evidence observed in the parsed document.
 *
 * All DOM-derived SEO evidence is `measured`: whether a `<title>` exists is a
 * fact about the markup, not an interpretation (ADR-009).
 */
export function domEvidence(summary: string, detail?: string): Evidence {
  return {
    kind: "measured",
    source: "dom",
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

/** Evidence observed from an HTTP response, e.g. robots.txt. */
export function httpEvidence(summary: string, detail?: string): Evidence {
  return {
    kind: "measured",
    source: "http",
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

export function evidence(
  kind: EvidenceKind,
  source: Evidence["source"],
  summary: string,
  detail?: string,
): Evidence {
  return { kind, source, summary, ...(detail === undefined ? {} : { detail }) };
}

/**
 * A check that could not run.
 *
 * Required by ADR-021: an analyzer that failed to inspect something has not
 * established that the page is fine, and must never report `pass`.
 */
export function couldNotDetermine(
  id: string,
  reason: string,
  explanation: string,
  recommendation: string,
): Finding {
  return seoFinding({
    id,
    severity: "info",
    status: "could_not_determine",
    evidence: [httpEvidence(reason)],
    explanation,
    recommendation,
  });
}

/** Truncate a value for use as evidence detail, so a finding stays readable. */
export function preview(value: string, maxLength = 120): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
