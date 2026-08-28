/**
 * Analysis lifecycle types.
 *
 * Source of truth: docs/DECISIONS.md ADR-011 (One Analysis Job).
 *
 * These types describe the *state* of an analysis job. They intentionally
 * contain no execution logic — the analyzer pipeline is introduced in Phase 2.
 */

/**
 * The explicit lifecycle states an analysis can be in.
 *
 * Every state is meaningful and user-visible; there is deliberately no
 * catch-all "error" state, because ADR-021 requires the system to distinguish
 * *how* an analysis failed.
 */
export const ANALYSIS_STATUSES = [
  /** Accepted and waiting to start. */
  "queued",
  /** Actively being analyzed. */
  "running",
  /** Finished and produced a report. */
  "completed",
  /** Stopped because of an internal or network error. */
  "failed",
  /** Stopped because it exceeded its time budget. */
  "timeout",
  /** Refused because the target resolved to a disallowed network location. */
  "blocked",
  /** Refused because the submitted URL was not a valid public HTTP(S) URL. */
  "invalid_url",
] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** States from which an analysis will never transition again. */
export const TERMINAL_ANALYSIS_STATUSES = [
  "completed",
  "failed",
  "timeout",
  "blocked",
  "invalid_url",
] as const satisfies readonly AnalysisStatus[];

export type TerminalAnalysisStatus = (typeof TERMINAL_ANALYSIS_STATUSES)[number];

/** Terminal states in which no report was produced. */
export const FAILED_ANALYSIS_STATUSES = [
  "failed",
  "timeout",
  "blocked",
  "invalid_url",
] as const satisfies readonly AnalysisStatus[];

export type FailedAnalysisStatus = (typeof FAILED_ANALYSIS_STATUSES)[number];

export function isAnalysisStatus(value: unknown): value is AnalysisStatus {
  return (
    typeof value === "string" && (ANALYSIS_STATUSES as readonly string[]).includes(value)
  );
}

/** True when the analysis has reached a state it will never leave. */
export function isTerminalAnalysisStatus(
  status: AnalysisStatus,
): status is TerminalAnalysisStatus {
  return (TERMINAL_ANALYSIS_STATUSES as readonly string[]).includes(status);
}

/**
 * True when the analysis finished without producing a report.
 *
 * Callers must not treat this as "the website has no problems" — see ADR-021.
 */
export function isFailedAnalysisStatus(
  status: AnalysisStatus,
): status is FailedAnalysisStatus {
  return (FAILED_ANALYSIS_STATUSES as readonly string[]).includes(status);
}
