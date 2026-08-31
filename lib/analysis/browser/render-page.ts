/**
 * Phase 3 — Browser analyzer.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 3, docs/DECISIONS.md ADR-033,
 * ADR-035 and ADR-042.
 *
 * Renders one validated URL in a real browser at a desktop and a mobile
 * viewport, and reports what was observed: screenshots, the post-JavaScript
 * DOM, console errors, network activity, navigation timings and layout metrics.
 *
 * ## Scope
 *
 * Nothing here interprets the observations. The rendered HTML is parsed in
 * Phase 4, layout metrics are judged in Phase 9, and the timings are scored in
 * Phase 8. Producing a second, competing representation of the page here would
 * defeat the point of having a normalization phase at all.
 */

import type { Browser, BrowserContext, Page, Request, Response } from "playwright";

import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "@/lib/analysis/http";
import type { AddressResolver } from "@/lib/analysis/http";
import { analysisStatusForRejection } from "@/lib/analysis/url";
import { createLogger, type Logger } from "@/lib/observability/logger";

import { createNavigationGuard, type NavigationGuard } from "./navigation-guard";
import { launchSession, BrowserUnavailableError, type BrowserLauncher } from "./session";
import { DEFAULT_VIEWPORTS } from "./viewports";
import type {
  BrowserFailureCode,
  BrowserRenderResult,
  BrowserTiming,
  ConsoleEntry,
  LayoutMetrics,
  NetworkEntry,
  ViewportName,
  ViewportRendering,
  ViewportSpec,
} from "./types";

/** Budget for the whole analysis, both viewports included. */
export const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;

/** Budget for a single navigation. */
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;

/**
 * How long to let the page settle after `load` before measuring.
 *
 * Many pages do their real work after `load`. Waiting a little produces a more
 * representative screenshot; waiting for full network idle is unbounded on
 * pages that poll, so this is a fixed, small allowance instead.
 */
export const DEFAULT_SETTLE_MS = 1_500;

/** Upper bound on retained network entries, so a chatty page cannot exhaust memory. */
export const DEFAULT_MAX_NETWORK_ENTRIES = 500;

/** Upper bound on retained console entries. */
export const DEFAULT_MAX_CONSOLE_ENTRIES = 200;

export interface RenderPageOptions {
  readonly totalTimeoutMs?: number;
  readonly navigationTimeoutMs?: number;
  readonly settleMs?: number;
  readonly viewports?: readonly ViewportSpec[];
  /** Capture the whole scrollable page rather than just the viewport. */
  readonly fullPageScreenshots?: boolean;
  readonly policy?: HttpSecurityPolicy;
  readonly logger?: Logger;
  readonly maxNetworkEntries?: number;
  readonly maxConsoleEntries?: number;
  /** Test seam: supply a browser rather than launching Chromium. */
  readonly launcher?: BrowserLauncher;
  /** Test seam: supply DNS answers to the request guard. */
  readonly resolver?: AddressResolver;
}

/**
 * Render a page and report what the browser observed.
 *
 * Never throws for an expected condition — an unreachable site, a timeout and a
 * missing browser binary are all returned as values (ADR-021).
 *
 * The browser is always closed, including on failure.
 */
export async function renderPage(
  inputUrl: string,
  options: RenderPageOptions = {},
): Promise<BrowserRenderResult> {
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const navigationTimeoutMs =
    options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const policy = options.policy ?? publicHttpSecurityPolicy;
  const log = options.logger ?? createLogger("analysis.browser");
  const maxNetwork = options.maxNetworkEntries ?? DEFAULT_MAX_NETWORK_ENTRIES;
  const maxConsole = options.maxConsoleEntries ?? DEFAULT_MAX_CONSOLE_ENTRIES;

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const fail = (code: BrowserFailureCode, message: string): BrowserRenderResult => {
    log.warn("browser.render.failed", { code, elapsedMs: elapsed() });
    return { ok: false, failure: { code, message, totalElapsedMs: elapsed() } };
  };

  // The same validator Phases 1 and 2 use. A URL the HTTP analyzer would refuse
  // is not one the browser gets to try.
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

  const consoleEntries: ConsoleEntry[] = [];
  const networkEntries: NetworkEntry[] = [];
  const renderings = {} as Record<ViewportName, ViewportRendering>;

  let session;
  try {
    session = await launchSession({ launcher: options.launcher, logger: log });
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      return fail("browser_unavailable", error.message);
    }
    return fail("browser_error", describe(error));
  }

  log.info("browser.render.started", { url, viewports: viewports.length });

  try {
    for (const spec of viewports) {
      const remainingMs = totalTimeoutMs - elapsed();
      if (remainingMs <= 0) {
        return fail("timeout", `Rendering exceeded ${totalTimeoutMs}ms.`);
      }

      const outcome = await renderViewport(session.browser, url, spec, {
        navigationTimeoutMs: Math.min(navigationTimeoutMs, remainingMs),
        settleMs,
        fullPage: options.fullPageScreenshots ?? false,
        guard,
        log,
        onConsole: (entry) => {
          if (consoleEntries.length < maxConsole) consoleEntries.push(entry);
        },
        onNetwork: (entry) => {
          if (networkEntries.length < maxNetwork) networkEntries.push(entry);
        },
      });

      if (!outcome.ok) return fail(outcome.code, outcome.message);

      renderings[spec.name] = outcome.rendering;
    }

    log.info("browser.render.completed", {
      url,
      elapsedMs: elapsed(),
      consoleErrors: consoleEntries.length,
      requests: networkEntries.length,
      blocked: guard.blocked.length,
    });

    return {
      ok: true,
      page: {
        requestedUrl: url,
        renderings,
        console: consoleEntries,
        network: networkEntries,
        blockedRequests: guard.blocked,
        totalElapsedMs: elapsed(),
      },
    };
  } catch (error) {
    return fail(...classifyBrowserError(error));
  } finally {
    // Always, on every path. A leaked Chromium is hundreds of megabytes.
    await session.close();
  }
}

interface ViewportRunOptions {
  readonly navigationTimeoutMs: number;
  readonly settleMs: number;
  readonly fullPage: boolean;
  readonly guard: NavigationGuard;
  readonly log: Logger;
  onConsole(entry: ConsoleEntry): void;
  onNetwork(entry: NetworkEntry): void;
}

type ViewportOutcome =
  | { readonly ok: true; readonly rendering: ViewportRendering }
  | { readonly ok: false; readonly code: BrowserFailureCode; readonly message: string };

async function renderViewport(
  browser: Browser,
  url: string,
  spec: ViewportSpec,
  options: ViewportRunOptions,
): Promise<ViewportOutcome> {
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: spec.deviceScaleFactor,
      isMobile: spec.isMobile,
      hasTouch: spec.isMobile,
      userAgent: spec.userAgent,
      // A real TLS error should be reported, not silently accepted.
      ignoreHTTPSErrors: false,
      // Service workers would issue background requests we cannot attribute to
      // a page load, and would serve a second visit from cache.
      serviceWorkers: "block",
    });

    context.setDefaultTimeout(options.navigationTimeoutMs);
    context.setDefaultNavigationTimeout(options.navigationTimeoutMs);

    await installGuard(context, spec.name, options);

    const page = await context.newPage();
    attachListeners(page, spec.name, options);

    const startedAt = Date.now();

    let response: Response | null;
    try {
      response = await page.goto(url, {
        waitUntil: "load",
        timeout: options.navigationTimeoutMs,
      });
    } catch (error) {
      return { ok: false, ...toFailure(error) };
    }

    // A fixed settle allowance rather than network idle, which never arrives on
    // a page that polls.
    await page.waitForTimeout(options.settleMs);

    const snapshot = await readSnapshot(page);
    const navigationMs = Date.now() - startedAt;

    const image = await page.screenshot({
      type: "png",
      fullPage: options.fullPage,
      timeout: options.navigationTimeoutMs,
    });

    return {
      ok: true,
      rendering: {
        viewport: spec.name,
        screenshot: {
          viewport: spec.name,
          data: image,
          width: options.fullPage ? snapshot.layout.scrollWidth : spec.width,
          height: options.fullPage ? snapshot.layout.scrollHeight : spec.height,
          byteLength: image.byteLength,
          fullPage: options.fullPage,
        },
        layout: snapshot.layout,
        timing: { ...snapshot.timing, navigationMs },
        renderedHtml: snapshot.html,
        title: snapshot.title,
        htmlLanguage: snapshot.htmlLanguage,
        viewportMeta: snapshot.viewportMeta,
        status: response?.status() ?? null,
        finalUrl: page.url(),
      },
    };
  } catch (error) {
    return { ok: false, ...toFailure(error) };
  } finally {
    if (context !== null) {
      // Closing the context closes its pages and releases the renderer.
      await context.close().catch(() => undefined);
    }
  }
}

/** Refuse anything the page requests that we would not request ourselves. */
async function installGuard(
  context: BrowserContext,
  viewport: ViewportName,
  options: ViewportRunOptions,
): Promise<void> {
  await context.route("**/*", async (route, request) => {
    const decision = await options.guard.check(request.url());

    if (decision.allowed) {
      await route.continue().catch(() => undefined);
      return;
    }

    options.log.warn("browser.request.blocked", {
      url: request.url(),
      reason: decision.reason ?? "unknown",
    });

    options.onNetwork({
      viewport,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: null,
      transferredBytes: null,
      fromCache: false,
      failure: decision.reason,
      blocked: true,
      durationMs: null,
    });

    await route.abort("blockedbyclient").catch(() => undefined);
  });
}

function attachListeners(
  page: Page,
  viewport: ViewportName,
  options: ViewportRunOptions,
): void {
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;

    const location = message.location();
    options.onConsole({
      viewport,
      level: type,
      text: message.text(),
      url: location.url || null,
      lineNumber: location.lineNumber ?? null,
    });
  });

  page.on("pageerror", (error) => {
    options.onConsole({
      viewport,
      level: "pageerror",
      text: error.message,
      url: null,
      lineNumber: null,
    });
  });

  const startedAt = new WeakMap<Request, number>();
  page.on("request", (request) => startedAt.set(request, Date.now()));

  page.on("requestfinished", (request) => {
    void recordFinished(request, viewport, startedAt, options);
  });

  page.on("requestfailed", (request) => {
    // A request we aborted ourselves is already recorded by the guard.
    if (request.failure()?.errorText === "net::ERR_BLOCKED_BY_CLIENT") return;

    options.onNetwork({
      viewport,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: null,
      transferredBytes: null,
      fromCache: false,
      failure: request.failure()?.errorText ?? "failed",
      blocked: false,
      durationMs: durationSince(startedAt.get(request)),
    });
  });
}

async function recordFinished(
  request: Request,
  viewport: ViewportName,
  startedAt: WeakMap<Request, number>,
  options: ViewportRunOptions,
): Promise<void> {
  try {
    const response = await request.response();
    const sizes = await request.sizes().catch(() => null);

    options.onNetwork({
      viewport,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: response?.status() ?? null,
      transferredBytes: sizes?.responseBodySize ?? null,
      fromCache: response === null ? false : await wasCached(response),
      failure: null,
      blocked: false,
      durationMs: durationSince(startedAt.get(request)),
    });
  } catch {
    // The context can close while a request is still settling. Losing one
    // network entry is not worth failing the analysis over.
  }
}

async function wasCached(response: Response): Promise<boolean> {
  try {
    return (await response.serverAddr()) === null;
  } catch {
    return false;
  }
}

function durationSince(started: number | undefined): number | null {
  return started === undefined ? null : Date.now() - started;
}

interface Snapshot {
  readonly html: string;
  readonly title: string;
  readonly htmlLanguage: string | null;
  readonly viewportMeta: string | null;
  readonly layout: LayoutMetrics;
  readonly timing: Omit<BrowserTiming, "navigationMs">;
}

/**
 * Read everything measurable from inside the page in one round trip.
 *
 * One `evaluate` rather than several: each crossing of the process boundary
 * costs a round trip, and taking the measurements at slightly different moments
 * would make them mutually inconsistent.
 */
async function readSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;

    const paint = (name: string): number | null => {
      const entry = performance.getEntriesByName(name)[0];
      return entry === undefined ? null : Math.round(entry.startTime);
    };

    const round = (value: number | undefined): number | null =>
      value === undefined || value === 0 ? null : Math.round(value);

    const viewportMeta = document.querySelector('meta[name="viewport"]');

    return {
      html: document.documentElement.outerHTML,
      title: document.title,
      htmlLanguage: document.documentElement.getAttribute("lang"),
      viewportMeta: viewportMeta?.getAttribute("content") ?? null,
      layout: {
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      timing: {
        domInteractiveMs: round(nav?.domInteractive),
        domContentLoadedMs: round(nav?.domContentLoadedEventEnd),
        loadEventMs: round(nav?.loadEventEnd),
        responseStartMs: round(nav?.responseStart),
        responseEndMs: round(nav?.responseEnd),
        firstPaintMs: paint("first-paint"),
        firstContentfulPaintMs: paint("first-contentful-paint"),
      },
    };
  });
}

function toFailure(error: unknown): { code: BrowserFailureCode; message: string } {
  const [code, message] = classifyBrowserError(error);
  return { code, message };
}

/** Map a Playwright error onto an explicit, reportable failure. */
function classifyBrowserError(error: unknown): [BrowserFailureCode, string] {
  const text = error instanceof Error ? error.message : String(error);

  if (/Timeout .* exceeded|timeout of|TimeoutError/i.test(text)) {
    return ["timeout", "The page took too long to load."];
  }

  if (/Target (page|closed)|crashed|Target crashed/i.test(text)) {
    return ["renderer_crashed", "The browser tab crashed while loading the page."];
  }

  if (
    /net::ERR_NAME_NOT_RESOLVED|net::ERR_CONNECTION|net::ERR_ABORTED|ERR_SSL|ERR_CERT|net::ERR_/i.test(
      text,
    )
  ) {
    return ["navigation_failed", "The page could not be loaded in a browser."];
  }

  return ["browser_error", `The browser could not render the page. ${text}`];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
