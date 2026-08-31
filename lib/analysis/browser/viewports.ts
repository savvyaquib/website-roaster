/**
 * The viewports every page is rendered at.
 *
 * Phase 3 requires at least a desktop and a mobile rendering. The exact sizes
 * are a judgement call rather than a measurement, so they live in one named
 * place where they can be changed and reviewed.
 */

import type { ViewportSpec } from "./types";

/**
 * A common laptop viewport. Not a monitor size — most visits are not
 * full-screen on a large display.
 */
export const DESKTOP_VIEWPORT: ViewportSpec = {
  name: "desktop",
  width: 1440,
  height: 900,
  // 1 rather than 2: a retina screenshot is four times the bytes for no extra
  // analytical value, and the screenshots are carried in memory (ADR-031).
  deviceScaleFactor: 1,
  isMobile: false,
};

/** Approximately an iPhone 14 / Pixel 7 logical viewport. */
export const MOBILE_VIEWPORT: ViewportSpec = {
  name: "mobile",
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

export const DEFAULT_VIEWPORTS: readonly ViewportSpec[] = [
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
];
