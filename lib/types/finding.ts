/**
 * The canonical evidence and finding model.
 *
 * Source of truth: docs/DECISIONS.md ADR-008 (Evidence Model),
 * ADR-009 (Fact vs Heuristic) and ADR-021 (Failure Transparency).
 *
 * Every analyzer from Phase 5 onwards emits `Finding` values. Nothing else in
 * the system is allowed to invent a competing shape for "something we noticed
 * about the page".
 */

/** The scored categories of the report. */
export const ANALYSIS_CATEGORIES = [
  "performance",
  "seo",
  "accessibility",
  "mobile",
  "security",
  "content",
  "ux",
] as const;

export type AnalysisCategory = (typeof ANALYSIS_CATEGORIES)[number];

export function isAnalysisCategory(value: unknown): value is AnalysisCategory {
  return (
    typeof value === "string" &&
    (ANALYSIS_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * How much a finding matters.
 *
 * The names match the accessibility audit vocabulary (Phase 7) so that
 * normalized axe results do not need a second mapping table. `info` carries no
 * scoring penalty and exists to report neutral observations.
 */
export const FINDING_SEVERITIES = [
  "critical",
  "serious",
  "moderate",
  "minor",
  "info",
] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * The outcome of a single check.
 *
 * `could_not_determine` is required by ADR-021 and must never be collapsed into
 * `pass`. An analyzer that could not inspect something has not established that
 * the website is fine.
 */
export const FINDING_STATUSES = ["pass", "warn", "fail", "could_not_determine"] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * Whether a piece of evidence was measured or inferred (ADR-009).
 *
 * The UI must not present `heuristic` evidence as objective fact.
 */
export type EvidenceKind = "measured" | "heuristic";

/** Which part of the pipeline observed the evidence. */
export const EVIDENCE_SOURCES = [
  "http",
  "browser",
  "dom",
  "lighthouse",
  "axe",
  "derived",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * A single observation that supports a finding.
 *
 * A finding without evidence is an opinion, and opinions are not allowed to
 * affect the score.
 */
export interface Evidence {
  readonly kind: EvidenceKind;
  readonly source: EvidenceSource;
  /** Short human-readable statement of what was observed. */
  readonly summary: string;
  /** Optional verbatim detail, e.g. a header value or a DOM selector. */
  readonly detail?: string;
}

/**
 * A single traceable result produced by an analyzer.
 *
 * Analyzers produce findings. They do not produce scores — see ADR-001.
 */
export interface Finding {
  /** Stable identifier, e.g. `seo.title.missing`. Must not change between runs. */
  readonly id: string;
  readonly category: AnalysisCategory;
  readonly severity: FindingSeverity;
  readonly status: FindingStatus;
  /** What the analyzer actually observed. Never empty. */
  readonly evidence: readonly Evidence[];
  /** Why this matters, in plain language. */
  readonly explanation: string;
  /**
   * What the site owner should do about it.
   *
   * Absent for `pass` and `info` findings, which require no action.
   */
  readonly recommendation?: string;
}
