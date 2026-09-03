/**
 * Mobile analyzer types.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 9, docs/DECISIONS.md ADR-009,
 * ADR-049.
 *
 * ## Signals, not verdicts
 *
 * `MobileSignals` is what a browser observed at a phone-sized viewport. Nothing
 * in it is a judgement. Whether a 20px button is a problem, and whether a page
 * with three overflowing elements is "broken", is decided in the analyzer — and
 * some of those decisions are explicitly heuristic.
 */

/** An element extending past the right edge of the viewport. */
export interface OverflowingElement {
  readonly selector: string;
  readonly tagName: string;
  /** How far past the viewport's right edge the element reaches, in CSS px. */
  readonly overflowPx: number;
  readonly widthPx: number;
}

/** An interactive element smaller than the target-size floor. */
export interface SmallTapTarget {
  readonly selector: string;
  readonly tagName: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Visible label, truncated. Helps a reader find the control. */
  readonly text: string;
}

/** A run of text rendered below the comfortable reading size. */
export interface SmallTextSample {
  readonly selector: string;
  readonly fontSizePx: number;
  readonly sample: string;
}

/** An element whose own content is cut off by an overflow rule. */
export interface ClippedElement {
  readonly selector: string;
  readonly tagName: string;
  /** How much wider the content is than the box showing it. */
  readonly hiddenPx: number;
}

/** What the page looks like it does for navigation on a small screen. */
export interface NavigationSignals {
  /** `<nav>` elements, or elements with a navigation role. */
  readonly navCount: number;
  /** Links inside those that are actually visible at this viewport. */
  readonly visibleNavLinks: number;
  /** Links inside those that are present but not rendered. */
  readonly hiddenNavLinks: number;
  /**
   * Whether something that looks like a menu control was found.
   *
   * Matched on the patterns a toggle usually has — a button whose label or
   * attributes mention a menu. It is a guess, and the analyzer treats it as one.
   */
  readonly hasMenuControl: boolean;
}

export interface ViewportGeometry {
  /**
   * The **layout** viewport the page chose, which is not always the screen.
   *
   * A page with no viewport meta tag is laid out at a desktop-ish fallback
   * width — 980px in Chromium — and then scaled down to fit. That is the real
   * symptom of the missing tag, and it means overflow measured against this
   * number understates how the page behaves on the actual screen.
   */
  readonly widthPx: number;
  /** The device viewport the browser was configured with. */
  readonly deviceWidthPx: number;
  readonly heightPx: number;
  readonly scrollWidthPx: number;
  readonly scrollHeightPx: number;
  readonly devicePixelRatio: number;
}

/** A screenshot's metadata. The bytes stay with Phase 3's rendering. */
export interface ScreenshotReference {
  readonly available: boolean;
  readonly byteLength: number | null;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
}

/**
 * Everything observed at the mobile viewport.
 *
 * Counts are always reported in full; the element lists are capped so a report
 * stays readable, which is why both exist.
 */
export interface MobileSignals {
  readonly url: string;
  readonly viewport: ViewportGeometry;
  /** Content of `<meta name="viewport">`, or null. */
  readonly viewportMeta: string | null;

  /** `scrollWidth - clientWidth`, clamped at zero. */
  readonly horizontalOverflowPx: number;
  readonly overflowingElementCount: number;
  readonly overflowingElements: readonly OverflowingElement[];

  readonly interactiveElementCount: number;
  readonly smallTapTargetCount: number;
  readonly smallTapTargets: readonly SmallTapTarget[];
  /** Targets meeting the standard floor but below the comfort guideline. */
  readonly tightTapTargetCount: number;

  readonly textNodeCount: number;
  readonly smallTextCount: number;
  readonly smallTextSamples: readonly SmallTextSample[];

  readonly clippedElementCount: number;
  readonly clippedElements: readonly ClippedElement[];

  readonly navigation: NavigationSignals;
  readonly screenshot: ScreenshotReference;
}

export const MOBILE_FAILURE_CODES = [
  "invalid_url",
  "blocked",
  "browser_unavailable",
  "navigation_failed",
  "timeout",
  "probe_failed",
  "browser_error",
] as const;

export type MobileFailureCode = (typeof MOBILE_FAILURE_CODES)[number];

export interface MobileFailure {
  readonly code: MobileFailureCode;
  readonly message: string;
}

export type MobileProbe =
  | { readonly ok: true; readonly signals: MobileSignals; readonly elapsedMs: number }
  | { readonly ok: false; readonly failure: MobileFailure };

export interface MobileAnalysisInput {
  /** Optional: without it, the analyzer reports `could_not_determine`. */
  readonly probe?: MobileProbe;
}
