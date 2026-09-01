/**
 * Shared helpers for constructing findings.
 *
 * Every analyzer emits the canonical `Finding` type (ADR-029) and every finding
 * carries evidence, so the boilerplate lives here rather than being repeated
 * per category.
 */

import type {
  AnalysisCategory,
  Evidence,
  EvidenceSource,
  Finding,
  FindingSeverity,
  FindingStatus,
} from "@/lib/types/finding";

export interface FindingInput {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly status: FindingStatus;
  readonly evidence: readonly Evidence[];
  readonly explanation: string;
  readonly recommendation?: string;
}

/** Build a finding for a fixed category. */
export function findingFactory(category: AnalysisCategory) {
  return (input: FindingInput): Finding => ({ category, ...input });
}

/** Evidence observed in the parsed document. */
export function domEvidence(summary: string, detail?: string): Evidence {
  return makeEvidence("dom", summary, detail);
}

/** Evidence observed from an HTTP response — headers, status, cookies. */
export function httpEvidence(summary: string, detail?: string): Evidence {
  return makeEvidence("http", summary, detail);
}

/** Evidence derived from other evidence rather than observed directly. */
export function derivedEvidence(summary: string, detail?: string): Evidence {
  return makeEvidence("derived", summary, detail);
}

function makeEvidence(
  source: EvidenceSource,
  summary: string,
  detail?: string,
): Evidence {
  return {
    // Everything built here states what was observed, not what it means, so it
    // is `measured` rather than `heuristic` (ADR-009).
    kind: "measured",
    source,
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

/** Truncate a value for use as evidence detail, so a finding stays readable. */
export function preview(value: string, maxLength = 120): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
