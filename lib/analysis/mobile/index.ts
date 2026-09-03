/**
 * Phase 9 — Mobile analyzer.
 *
 * Import from `@/lib/analysis/mobile`; the internal modules are implementation
 * detail.
 */

export { analyzeMobile } from "./analyze-mobile";

export {
  collectMobileSignals,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  DEFAULT_SETTLE_MS,
  type CollectMobileSignalsOptions,
} from "./collect-signals";

export {
  COMFORTABLE_TAP_TARGET_PX,
  MAX_REPORTED_ELEMENTS,
  MIN_COMFORTABLE_FONT_PX,
  MIN_TAP_TARGET_PX,
  NAV_LINKS_EXPECTING_TOGGLE,
  OVERFLOW_TOLERANCE_PX,
  SEVERE_OVERFLOW_PX,
} from "./thresholds";

export {
  MOBILE_FAILURE_CODES,
  type ClippedElement,
  type MobileAnalysisInput,
  type MobileFailure,
  type MobileFailureCode,
  type MobileProbe,
  type MobileSignals,
  type NavigationSignals,
  type OverflowingElement,
  type SmallTapTarget,
  type SmallTextSample,
  type ViewportGeometry,
} from "./types";
