/**
 * Browser analyzer result types.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 3, docs/DECISIONS.md ADR-033
 * and ADR-035.
 *
 * This phase reports what a real browser observed while rendering the page. It
 * does not interpret any of it: the rendered HTML is parsed in Phase 4, the
 * layout metrics are judged in Phase 9, and the performance numbers are scored
 * in Phase 8.
 */

/** The viewports every page is rendered at. */
export const VIEWPORT_NAMES = ["desktop", "mobile"] as const;

export type ViewportName = (typeof VIEWPORT_NAMES)[number];

export interface ViewportSpec {
  readonly name: ViewportName;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly isMobile: boolean;
  readonly userAgent?: string;
}

/** Why the browser could not produce a rendering. */
export const BROWSER_FAILURE_CODES = [
  /** The submitted URL failed Phase 1 validation. */
  "invalid_url",
  /** The URL is one we refuse to contact. */
  "blocked",
  /** No browser binary, or it would not start. */
  "browser_unavailable",
  /** Navigation exceeded its budget. */
  "timeout",
  /** The page could not be reached (DNS, connection, TLS). */
  "navigation_failed",
  /** The renderer process died — commonly an out-of-memory page. */
  "renderer_crashed",
  /** Anything else. */
  "browser_error",
] as const;

export type BrowserFailureCode = (typeof BROWSER_FAILURE_CODES)[number];

/** A console message or uncaught error observed during rendering. */
export interface ConsoleEntry {
  /** Which rendering produced it. */
  readonly viewport: ViewportName;
  /** `error` and `warning` come from the console; `pageerror` is an uncaught throw. */
  readonly level: "error" | "warning" | "pageerror";
  readonly text: string;
  /** Source location, when the browser reported one. */
  readonly url: string | null;
  readonly lineNumber: number | null;
}

/** One network request the page made. */
export interface NetworkEntry {
  /** Which rendering produced it. */
  readonly viewport: ViewportName;
  readonly url: string;
  readonly method: string;
  /** Playwright's classification: `document`, `script`, `image`, … */
  readonly resourceType: string;
  /** Null when the request failed or was blocked before a response. */
  readonly status: number | null;
  /** Response body size in bytes, when the browser reported it. */
  readonly transferredBytes: number | null;
  /** Whether the response came from the browser cache. */
  readonly fromCache: boolean;
  /** Set when the request did not complete. */
  readonly failure: string | null;
  /** Set when *we* refused the request. See ADR-042. */
  readonly blocked: boolean;
  readonly durationMs: number | null;
}

/**
 * Navigation and paint timings, in milliseconds relative to navigation start.
 *
 * Null means "not reported by the browser", never zero (ADR-021). These are raw
 * measurements; Phase 8 decides what they are worth.
 */
export interface BrowserTiming {
  readonly domInteractiveMs: number | null;
  readonly domContentLoadedMs: number | null;
  readonly loadEventMs: number | null;
  readonly responseStartMs: number | null;
  readonly responseEndMs: number | null;
  readonly firstPaintMs: number | null;
  readonly firstContentfulPaintMs: number | null;
  /** Wall-clock time this analyzer spent on the navigation. */
  readonly navigationMs: number;
}

/** Measurements that only exist once the page has been laid out. */
export interface LayoutMetrics {
  /** Width of the layout viewport. */
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** Full scrollable width. Greater than `viewportWidth` means overflow. */
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly devicePixelRatio: number;
}

export interface Screenshot {
  readonly viewport: ViewportName;
  /** PNG bytes. */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  /** Whether the whole scrollable page was captured, or just the viewport. */
  readonly fullPage: boolean;
}

/** What one viewport rendering produced. */
export interface ViewportRendering {
  readonly viewport: ViewportName;
  readonly screenshot: Screenshot;
  readonly layout: LayoutMetrics;
  readonly timing: BrowserTiming;
  /**
   * The DOM after scripts have run, serialized.
   *
   * This is the artifact Phase 4 parses. It is deliberately *not* parsed here:
   * structural extraction is Phase 4's job, and doing it twice would create two
   * competing representations of the page.
   */
  readonly renderedHtml: string;
  readonly title: string;
  /** `lang` on the root element, if declared. */
  readonly htmlLanguage: string | null;
  /** Content of the viewport meta tag, if present. */
  readonly viewportMeta: string | null;
  /** HTTP status of the main document, as the browser saw it. */
  readonly status: number | null;
  /** The URL after any client-side or server-side redirects. */
  readonly finalUrl: string;
}

export interface BrowserPageData {
  readonly requestedUrl: string;
  readonly renderings: Readonly<Record<ViewportName, ViewportRendering>>;
  /** Console errors and warnings, across all viewports. */
  readonly console: readonly ConsoleEntry[];
  /** Network requests, across all viewports. */
  readonly network: readonly NetworkEntry[];
  /** Requests refused by the navigation guard. A non-empty list is notable. */
  readonly blockedRequests: readonly string[];
  readonly totalElapsedMs: number;
}

export interface BrowserFailure {
  readonly code: BrowserFailureCode;
  readonly message: string;
  readonly totalElapsedMs: number;
}

export type BrowserRenderResult =
  | { readonly ok: true; readonly page: BrowserPageData }
  | { readonly ok: false; readonly failure: BrowserFailure };

/** Map a browser failure to the analysis job state it produces (ADR-011). */
export function analysisStatusForBrowserFailure(
  code: BrowserFailureCode,
): "failed" | "timeout" | "blocked" | "invalid_url" {
  switch (code) {
    case "invalid_url":
      return "invalid_url";
    case "blocked":
      return "blocked";
    case "timeout":
      return "timeout";
    default:
      return "failed";
  }
}
