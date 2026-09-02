/**
 * Accessibility analyzer types.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 7, docs/DECISIONS.md ADR-047.
 *
 * ## Why these are declared rather than imported from axe-core
 *
 * They describe only the fields the normalizer reads, and they are
 * structurally satisfied by axe's real output.
 *
 * Declaring them keeps `normalize.ts` free of any dependency on axe, which
 * means the normalization can be tested with plain object fixtures instead of
 * a browser, and means swapping the engine later would touch the runner rather
 * than the normalizer. axe's own `Result` type carries a dozen fields this
 * phase never looks at, and satisfying it in a fixture would be noise.
 */

/** One element an accessibility rule applied to. */
export interface AxeNode {
  /** The element's outer HTML, as captured by the engine. */
  readonly html: string;
  /**
   * CSS selectors locating the element.
   *
   * axe returns nested arrays when an element is inside an iframe; the runner
   * flattens those to strings before they reach the normalizer.
   */
  readonly target: readonly string[];
  /** The engine's explanation of why this element failed. */
  readonly failureSummary?: string;
}

/** One rule's outcome, as reported by the engine. */
export interface AxeRule {
  /** The engine's rule identifier, e.g. `color-contrast`. Preserved verbatim. */
  readonly id: string;
  /** `critical`, `serious`, `moderate`, `minor`, or absent for a pass. */
  readonly impact?: string | null;
  /** Rule tags, e.g. `wcag2aa`, `cat.color`. */
  readonly tags: readonly string[];
  readonly description: string;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly AxeNode[];
}

/**
 * A complete audit.
 *
 * `inapplicable` is deliberately absent: a rule with no matching elements on
 * the page says nothing about the page, and including it would add dozens of
 * empty findings.
 */
export interface AxeAuditResults {
  /** Rules that failed. */
  readonly violations: readonly AxeRule[];
  /** Rules the engine could not decide — needs human review. */
  readonly incomplete: readonly AxeRule[];
  /** Rules that passed. */
  readonly passes: readonly AxeRule[];
  readonly testEngine?: { readonly name: string; readonly version: string };
  /** The URL the audit ran against. */
  readonly url?: string;
}

/** Why an audit could not be produced. */
export const ACCESSIBILITY_FAILURE_CODES = [
  /** The submitted URL failed validation, or points somewhere we refuse. */
  "invalid_url",
  "blocked",
  /** No browser binary, or it would not start. */
  "browser_unavailable",
  /** The page could not be loaded. */
  "navigation_failed",
  /** Navigation or the audit exceeded its budget. */
  "timeout",
  /** The engine could not be injected into the page. */
  "engine_injection_failed",
  /** The engine threw while auditing. */
  "audit_failed",
  /** Anything else. */
  "browser_error",
] as const;

export type AccessibilityFailureCode = (typeof ACCESSIBILITY_FAILURE_CODES)[number];

export interface AccessibilityFailure {
  readonly code: AccessibilityFailureCode;
  readonly message: string;
}

/**
 * The outcome of running the audit.
 *
 * A failure is a value, not an exception: the analyzer turns it into a
 * `could_not_determine` finding rather than dropping the accessibility section
 * from the report (ADR-021).
 */
export type AxeAudit =
  | { readonly ok: true; readonly results: AxeAuditResults; readonly elapsedMs: number }
  | { readonly ok: false; readonly failure: AccessibilityFailure };

export interface AccessibilityAnalysisInput {
  /**
   * The audit produced by `runAxe`.
   *
   * Optional: without it the analyzer reports `could_not_determine` rather than
   * silently omitting accessibility from the report.
   */
  readonly audit?: AxeAudit;
}
