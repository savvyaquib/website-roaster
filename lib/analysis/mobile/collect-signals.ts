/**
 * Collecting mobile-viewport signals from a live page.
 *
 * Source of truth: docs/DECISIONS.md ADR-049.
 *
 * The only part of Phase 9 that touches a browser. It reuses Phase 3's session,
 * request guard and mobile viewport, so the security boundary, the device
 * profile and the cleanup behaviour are the ones already reviewed.
 *
 * Everything measured here is measured *in the page*, because element geometry
 * only exists once the browser has laid the page out. The analyzer that decides
 * what any of it means is pure and lives elsewhere.
 */

import type { BrowserContext } from "playwright";

import {
  BrowserUnavailableError,
  createNavigationGuard,
  launchSession,
  MOBILE_VIEWPORT,
  type BrowserLauncher,
} from "@/lib/analysis/browser";
import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "@/lib/analysis/http";
import type { AddressResolver } from "@/lib/analysis/http";
import { analysisStatusForRejection } from "@/lib/analysis/url";
import { createLogger, type Logger } from "@/lib/observability/logger";

import {
  COMFORTABLE_TAP_TARGET_PX,
  MAX_REPORTED_ELEMENTS,
  MIN_COMFORTABLE_FONT_PX,
  MIN_TAP_TARGET_PX,
  OVERFLOW_TOLERANCE_PX,
} from "./thresholds";
import type { MobileFailureCode, MobileProbe, MobileSignals } from "./types";

export const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;
export const DEFAULT_SETTLE_MS = 1_000;

export interface CollectMobileSignalsOptions {
  readonly navigationTimeoutMs?: number;
  readonly settleMs?: number;
  readonly policy?: HttpSecurityPolicy;
  readonly logger?: Logger;
  /** Capture a screenshot alongside the measurements. Default true. */
  readonly screenshot?: boolean;
  /** Test seam: supply a browser rather than launching Chromium. */
  readonly launcher?: BrowserLauncher;
  /** Test seam: supply DNS answers to the request guard. */
  readonly resolver?: AddressResolver;
}

/** Thresholds handed to the in-page script, which cannot import them. */
interface ProbeThresholds {
  readonly minTapTarget: number;
  readonly comfortableTapTarget: number;
  readonly minFontSize: number;
  readonly overflowTolerance: number;
  readonly maxReported: number;
}

/**
 * Render at a phone viewport and measure.
 *
 * Never throws for an expected condition. The browser is always closed.
 */
export async function collectMobileSignals(
  inputUrl: string,
  options: CollectMobileSignalsOptions = {},
): Promise<MobileProbe> {
  const navigationTimeoutMs =
    options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const policy = options.policy ?? publicHttpSecurityPolicy;
  const log = options.logger ?? createLogger("analysis.mobile");
  const wantScreenshot = options.screenshot ?? true;

  const startedAt = Date.now();
  const fail = (code: MobileFailureCode, message: string): MobileProbe => {
    log.warn("mobile.probe.failed", { code });
    return { ok: false, failure: { code, message } };
  };

  const validated = policy.validateUrl(inputUrl);
  if (!validated.valid) {
    const code =
      analysisStatusForRejection(validated.code) === "invalid_url"
        ? "invalid_url"
        : "blocked";
    return fail(code, validated.reason);
  }

  const url = validated.normalizedUrl;
  const guard = createNavigationGuard({ policy, resolver: options.resolver });

  let session;
  try {
    session = await launchSession({ launcher: options.launcher, logger: log });
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      return fail("browser_unavailable", error.message);
    }
    return fail("browser_error", describe(error));
  }

  let context: BrowserContext | null = null;

  try {
    // The same device profile Phase 3 renders at, so the two agree.
    context = await session.browser.newContext({
      viewport: { width: MOBILE_VIEWPORT.width, height: MOBILE_VIEWPORT.height },
      deviceScaleFactor: MOBILE_VIEWPORT.deviceScaleFactor,
      isMobile: MOBILE_VIEWPORT.isMobile,
      hasTouch: MOBILE_VIEWPORT.isMobile,
      userAgent: MOBILE_VIEWPORT.userAgent,
      ignoreHTTPSErrors: false,
      serviceWorkers: "block",
    });

    context.setDefaultTimeout(navigationTimeoutMs);
    context.setDefaultNavigationTimeout(navigationTimeoutMs);

    await context.route("**/*", async (route, request) => {
      const decision = await guard.check(request.url());
      if (decision.allowed) {
        await route.continue().catch(() => undefined);
        return;
      }
      await route.abort("blockedbyclient").catch(() => undefined);
    });

    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: "load", timeout: navigationTimeoutMs });
    } catch (error) {
      return fail(...classifyError(error));
    }

    await page.waitForTimeout(settleMs);

    const thresholds: ProbeThresholds = {
      minTapTarget: MIN_TAP_TARGET_PX,
      comfortableTapTarget: COMFORTABLE_TAP_TARGET_PX,
      minFontSize: MIN_COMFORTABLE_FONT_PX,
      overflowTolerance: OVERFLOW_TOLERANCE_PX,
      maxReported: MAX_REPORTED_ELEMENTS,
    };

    let measured: Omit<MobileSignals, "url" | "screenshot">;
    try {
      measured = await page.evaluate(measureInPage, thresholds);
    } catch (error) {
      return fail("probe_failed", `The page could not be measured. ${describe(error)}`);
    }

    let screenshot: MobileSignals["screenshot"] = {
      available: false,
      byteLength: null,
      widthPx: null,
      heightPx: null,
    };

    if (wantScreenshot) {
      try {
        const image = await page.screenshot({
          type: "png",
          timeout: navigationTimeoutMs,
        });
        screenshot = {
          available: true,
          byteLength: image.byteLength,
          widthPx: MOBILE_VIEWPORT.width,
          heightPx: MOBILE_VIEWPORT.height,
        };
      } catch {
        // A screenshot is supporting evidence, not a measurement. Losing it
        // must not cost the whole probe.
        screenshot = {
          available: false,
          byteLength: null,
          widthPx: null,
          heightPx: null,
        };
      }
    }

    log.info("mobile.probe.completed", {
      url,
      overflowPx: Math.round(measured.horizontalOverflowPx),
      smallTapTargets: measured.smallTapTargetCount,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      ok: true,
      signals: {
        url,
        ...measured,
        // Known here, not in the page: it is what the context was configured
        // with, whereas the page reports the layout width it chose.
        viewport: { ...measured.viewport, deviceWidthPx: MOBILE_VIEWPORT.width },
        screenshot,
      },
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return fail(...classifyError(error));
  } finally {
    if (context !== null) await context.close().catch(() => undefined);
    await session.close();
  }
}

/**
 * The measurement script, run inside the page.
 *
 * Written as a standalone function so it can be handed to `evaluate` whole. It
 * cannot reference anything from the module scope, which is why the thresholds
 * are passed in.
 */
function measureInPage(
  thresholds: ProbeThresholds,
): Omit<MobileSignals, "url" | "screenshot"> {
  const root = document.documentElement;
  const viewportWidth = root.clientWidth;

  /** A short, stable-ish selector for an element, for a human to find it. */
  const describeElement = (element: Element): string => {
    const tag = element.tagName.toLowerCase();
    if (element.id.length > 0) return `${tag}#${element.id}`;

    const className =
      typeof element.className === "string"
        ? element.className.trim().split(/\s+/)[0]
        : "";

    return className !== undefined && className.length > 0 ? `${tag}.${className}` : tag;
  };

  const isVisible = (element: Element): boolean => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // --- Horizontal overflow, and which elements cause it.
  const overflowing: MobileSignals["overflowingElements"][number][] = [];
  for (const element of Array.from(document.body?.querySelectorAll("*") ?? [])) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const past = rect.right - viewportWidth;
    if (past > thresholds.overflowTolerance) {
      overflowing.push({
        selector: describeElement(element),
        tagName: element.tagName.toLowerCase(),
        overflowPx: past,
        widthPx: rect.width,
      });
    }
  }
  overflowing.sort((a, b) => b.overflowPx - a.overflowPx);

  // --- Tap targets.
  const interactive = Array.from(
    document.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [onclick]',
    ),
  ).filter(isVisible);

  const small: MobileSignals["smallTapTargets"][number][] = [];
  let tight = 0;

  for (const element of interactive) {
    const rect = element.getBoundingClientRect();
    const smallest = Math.min(rect.width, rect.height);

    if (smallest < thresholds.minTapTarget) {
      small.push({
        selector: describeElement(element),
        tagName: element.tagName.toLowerCase(),
        widthPx: rect.width,
        heightPx: rect.height,
        text: (element.textContent ?? "").trim().slice(0, 40),
      });
    } else if (smallest < thresholds.comfortableTapTarget) {
      tight += 1;
    }
  }

  // --- Text size. Only elements holding their own text are measured, so a
  // wrapper does not get counted for the text of its children.
  const textSamples: MobileSignals["smallTextSamples"][number][] = [];
  let textRuns = 0;
  let smallText = 0;

  for (const element of Array.from(document.body?.querySelectorAll("*") ?? [])) {
    const ownText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();

    if (ownText.length === 0) continue;
    if (!isVisible(element)) continue;

    textRuns += 1;
    const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);

    if (Number.isFinite(fontSize) && fontSize < thresholds.minFontSize) {
      smallText += 1;
      if (textSamples.length < thresholds.maxReported) {
        textSamples.push({
          selector: describeElement(element),
          fontSizePx: fontSize,
          sample: ownText.slice(0, 60),
        });
      }
    }
  }

  // --- Clipping: a box narrower than its own content, with the rest hidden.
  const clipped: MobileSignals["clippedElements"][number][] = [];
  for (const element of Array.from(document.body?.querySelectorAll("*") ?? [])) {
    const style = window.getComputedStyle(element);
    const hides = style.overflowX === "hidden" || style.overflow === "hidden";
    if (!hides) continue;

    const hidden = element.scrollWidth - element.clientWidth;
    if (hidden > thresholds.overflowTolerance && element.clientWidth > 0) {
      clipped.push({
        selector: describeElement(element),
        tagName: element.tagName.toLowerCase(),
        hiddenPx: hidden,
      });
    }
  }
  clipped.sort((a, b) => b.hiddenPx - a.hiddenPx);

  // --- Navigation.
  const navRegions = Array.from(document.querySelectorAll('nav, [role="navigation"]'));
  let visibleNavLinks = 0;
  let hiddenNavLinks = 0;

  for (const region of navRegions) {
    for (const link of Array.from(region.querySelectorAll("a[href]"))) {
      if (isVisible(link)) visibleNavLinks += 1;
      else hiddenNavLinks += 1;
    }
  }

  // Pattern-matching, and treated as a guess by the analyzer.
  const menuPattern = /menu|hamburger|nav-toggle|navbar-toggle|drawer/i;
  const hasMenuControl = Array.from(
    document.querySelectorAll('button, [role="button"], [aria-expanded], label'),
  ).some((element) => {
    const haystack = [
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("class") ?? "",
      element.getAttribute("id") ?? "",
      element.getAttribute("aria-controls") ?? "",
      (element.textContent ?? "").slice(0, 30),
    ].join(" ");

    return menuPattern.test(haystack);
  });

  return {
    viewport: {
      widthPx: viewportWidth,
      // Overwritten outside the page, which knows the configured device width.
      deviceWidthPx: viewportWidth,
      heightPx: root.clientHeight,
      scrollWidthPx: root.scrollWidth,
      scrollHeightPx: root.scrollHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    viewportMeta:
      document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
    horizontalOverflowPx: Math.max(0, root.scrollWidth - viewportWidth),
    overflowingElementCount: overflowing.length,
    overflowingElements: overflowing.slice(0, thresholds.maxReported),
    interactiveElementCount: interactive.length,
    smallTapTargetCount: small.length,
    smallTapTargets: small.slice(0, thresholds.maxReported),
    tightTapTargetCount: tight,
    textNodeCount: textRuns,
    smallTextCount: smallText,
    smallTextSamples: textSamples,
    clippedElementCount: clipped.length,
    clippedElements: clipped.slice(0, thresholds.maxReported),
    navigation: {
      navCount: navRegions.length,
      visibleNavLinks,
      hiddenNavLinks,
      hasMenuControl,
    },
  };
}

function classifyError(error: unknown): [MobileFailureCode, string] {
  const text = describe(error);

  if (/Timeout .* exceeded|TimeoutError/i.test(text)) {
    return ["timeout", "The page took too long to load."];
  }
  if (/net::ERR_|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i.test(text)) {
    return ["navigation_failed", "The page could not be loaded at a mobile viewport."];
  }

  return ["browser_error", `The mobile check could not run. ${text}`];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
