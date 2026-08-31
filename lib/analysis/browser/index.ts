/**
 * Phase 3 — Browser analyzer.
 *
 * Import from `@/lib/analysis/browser`; the internal modules are
 * implementation detail.
 */

export {
  DEFAULT_MAX_CONSOLE_ENTRIES,
  DEFAULT_MAX_NETWORK_ENTRIES,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  DEFAULT_SETTLE_MS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  renderPage,
  type RenderPageOptions,
} from "./render-page";

export {
  BrowserUnavailableError,
  DEFAULT_LAUNCH_TIMEOUT_MS,
  defaultLauncher,
  launchSession,
  type BrowserLauncher,
  type BrowserSession,
  type LaunchSessionOptions,
} from "./session";

export {
  createNavigationGuard,
  type GuardDecision,
  type NavigationGuard,
  type NavigationGuardOptions,
} from "./navigation-guard";

export { DEFAULT_VIEWPORTS, DESKTOP_VIEWPORT, MOBILE_VIEWPORT } from "./viewports";

export {
  analysisStatusForBrowserFailure,
  BROWSER_FAILURE_CODES,
  VIEWPORT_NAMES,
  type BrowserFailure,
  type BrowserFailureCode,
  type BrowserPageData,
  type BrowserRenderResult,
  type BrowserTiming,
  type ConsoleEntry,
  type LayoutMetrics,
  type NetworkEntry,
  type Screenshot,
  type ViewportName,
  type ViewportRendering,
  type ViewportSpec,
} from "./types";
