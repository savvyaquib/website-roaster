/**
 * Performance analyzer types.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 8, docs/DECISIONS.md ADR-030
 * and ADR-048.
 *
 * ## Raw measurements are kept apart from anything derived
 *
 * `PerformanceMeasurements` holds numbers the engine actually observed, in
 * their original units, and nothing else. No normalised 0-100 value, no
 * category score, no grade.
 *
 * That separation is ADR-012: raw data must survive so the scoring weights can
 * change later without re-running the analysis, and so a wrong score can be
 * debugged against what was actually measured.
 */

/** A per-resource-type slice of the page's weight. */
export interface ResourceGroup {
  /** `script`, `image`, `stylesheet`, `document`, `font`, `other`, `total`. */
  readonly type: string;
  readonly requestCount: number;
  readonly transferBytes: number;
}

/**
 * Everything the engine measured, in its own units.
 *
 * `null` means "not measured", never zero (ADR-021).
 */
export interface PerformanceMeasurements {
  // --- Core Web Vitals and load metrics, milliseconds unless stated.
  readonly lcpMs: number | null;

  /**
   * Interaction to Next Paint.
   *
   * **Always `null` from this analyzer**, and that is not a defect.
   *
   * INP is a field metric: it measures how quickly a page responds to real
   * interactions, so it requires real users interacting. A synthetic load has
   * nobody to interact, and any number produced here would be invented
   * (ADR-030).
   *
   * The field exists so the gap is explicit rather than silently absent, and
   * `tbtMs` is the established lab proxy for the same concern.
   */
  readonly inpMs: number | null;
  /** Why `inpMs` is null. Non-null whenever `inpMs` is null. */
  readonly inpUnavailableReason: string | null;

  /** Cumulative Layout Shift. Unitless. */
  readonly clsScore: number | null;
  /** Total Blocking Time — the lab proxy for interaction readiness. */
  readonly tbtMs: number | null;
  readonly fcpMs: number | null;
  readonly speedIndexMs: number | null;
  readonly timeToInteractiveMs: number | null;
  readonly serverResponseMs: number | null;

  // --- Page weight.
  /** Total bytes transferred for the page and its subresources. */
  readonly totalByteWeight: number | null;
  readonly requestCount: number | null;
  readonly resourceBreakdown: readonly ResourceGroup[];

  // --- JavaScript cost.
  /** Time spent parsing, compiling and executing script. */
  readonly javaScriptBootupMs: number | null;
  readonly mainThreadWorkMs: number | null;
  readonly unusedJavaScriptBytes: number | null;

  // --- Images and render blocking.
  readonly imagePotentialSavingsBytes: number | null;
  readonly renderBlockingWastedMs: number | null;
  readonly renderBlockingCount: number | null;

  // --- Provenance, so a measurement can be traced to what produced it.
  readonly engineName: string | null;
  readonly engineVersion: string | null;
  /** The URL the audit actually measured, after redirects. */
  readonly measuredUrl: string | null;
}

/** One audit as reported by the engine. Narrow: only what is read. */
export interface LighthouseAudit {
  readonly id?: string;
  readonly title?: string;
  readonly description?: string;
  /** 0-1, or null when the audit is informational. The **engine's** verdict. */
  readonly score?: number | null;
  readonly numericValue?: number;
  readonly numericUnit?: string;
  readonly displayValue?: string;
  readonly details?: {
    readonly items?: readonly Record<string, unknown>[];
    readonly overallSavingsBytes?: number;
    readonly overallSavingsMs?: number;
    [key: string]: unknown;
  };
}

/**
 * A Lighthouse report, narrowed to the fields this phase reads.
 *
 * Declared rather than imported for the same reason as Phase 7: it keeps the
 * pure modules free of a dependency on the engine, so they can be tested with
 * plain fixtures instead of a browser.
 */
export interface LighthouseReport {
  readonly audits: Readonly<Record<string, LighthouseAudit>>;
  readonly lighthouseVersion?: string;
  readonly finalDisplayedUrl?: string;
  readonly requestedUrl?: string;
  readonly runtimeError?: { readonly code?: string; readonly message?: string };
}

export const PERFORMANCE_FAILURE_CODES = [
  "invalid_url",
  "blocked",
  "browser_unavailable",
  "navigation_failed",
  "timeout",
  /** The engine ran but reported it could not measure the page. */
  "audit_error",
  "audit_failed",
  "browser_error",
] as const;

export type PerformanceFailureCode = (typeof PERFORMANCE_FAILURE_CODES)[number];

export interface PerformanceFailure {
  readonly code: PerformanceFailureCode;
  readonly message: string;
}

export type PerformanceAudit =
  | {
      readonly ok: true;
      readonly report: LighthouseReport;
      readonly elapsedMs: number;
    }
  | { readonly ok: false; readonly failure: PerformanceFailure };

export interface PerformanceAnalysisInput {
  /** Optional: without it, the analyzer reports `could_not_determine`. */
  readonly audit?: PerformanceAudit;
}

/**
 * What the analyzer returns.
 *
 * Two separate fields on purpose. The measurements are the evidence; the
 * findings are the observations drawn from them. Neither is a score — that is
 * Phase 12's job (ADR-002).
 */
export interface PerformanceAnalysis {
  readonly measurements: PerformanceMeasurements;
  readonly findings: readonly import("@/lib/types/finding").Finding[];
}
