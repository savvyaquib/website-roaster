/**
 * Browser process lifecycle.
 *
 * Source of truth: docs/DECISIONS.md ADR-033.
 *
 * ADR-033 requires this module to expose a **connection endpoint**, not only a
 * page handle, because Phase 8 attaches Lighthouse to the same browser process
 * and performs its own cold page load. That requirement is why the session is a
 * separate abstraction rather than something `renderPage` does inline.
 */

import type { Browser, LaunchOptions } from "playwright";

import { createLogger, type Logger } from "@/lib/observability/logger";

/**
 * Chromium flags.
 *
 * The sandbox is deliberately *not* disabled. `--no-sandbox` is the usual
 * workaround for running as root in a container, but it removes the strongest
 * boundary between a hostile page and the host. If a deployment cannot run the
 * sandbox, fix the deployment (run as a non-root user with the right
 * capabilities) rather than turning it off here.
 */
const CHROMIUM_ARGS = [
  // Chromium's default /dev/shm is often too small in containers, which shows
  // up as unexplained renderer crashes.
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--no-first-run",
  "--no-default-browser-check",
  "--metrics-recording-only",
  "--mute-audio",
];

/** Launches a browser. Injectable so tests can supply one. */
export type BrowserLauncher = (options: LaunchOptions) => Promise<Browser>;

export const defaultLauncher: BrowserLauncher = async (options) => {
  // Imported dynamically so that merely importing this module does not require
  // Playwright to be installed, and so the Next.js build does not try to bundle
  // a native dependency into a route.
  const { chromium } = await import("playwright");
  return chromium.launch(options);
};

export class BrowserUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `Could not start a browser. Is Chromium installed (npx playwright install chromium)? ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "BrowserUnavailableError";
  }
}

export interface BrowserSession {
  readonly browser: Browser;
  /**
   * The DevTools Protocol endpoint of the running browser.
   *
   * Phase 8 connects Lighthouse here rather than launching a second Chromium.
   * `null` when the launcher did not expose one, which is the case for a
   * browser that was connected to rather than launched.
   */
  readonly endpoint: string | null;
  close(): Promise<void>;
}

export interface LaunchSessionOptions {
  readonly launcher?: BrowserLauncher;
  readonly logger?: Logger;
  readonly headless?: boolean;
  /** Budget for the launch itself, separate from any page navigation. */
  readonly launchTimeoutMs?: number;
}

export const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;

/**
 * Start a browser.
 *
 * @throws {BrowserUnavailableError} if the browser cannot be started. The
 *   caller turns this into a `browser_unavailable` failure; it is thrown rather
 *   than returned because it means the analyzer itself is misconfigured, not
 *   that the site is broken.
 */
export async function launchSession(
  options: LaunchSessionOptions = {},
): Promise<BrowserSession> {
  const launcher = options.launcher ?? defaultLauncher;
  const log = options.logger ?? createLogger("analysis.browser");

  let browser: Browser;
  try {
    browser = await launcher({
      headless: options.headless ?? true,
      args: CHROMIUM_ARGS,
      timeout: options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS,
    });
  } catch (error) {
    log.error("browser.launch.failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw new BrowserUnavailableError(error);
  }

  log.info("browser.launched", { version: browser.version() });

  return {
    browser,
    // Playwright does not surface the CDP endpoint on the public Browser type.
    // Reading it defensively keeps Phase 8 unblocked without pretending the
    // property is guaranteed.
    endpoint: readEndpoint(browser),
    async close() {
      try {
        await browser.close();
        log.info("browser.closed");
      } catch (error) {
        // Never let cleanup failure mask the real result.
        log.warn("browser.close.failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    },
  };
}

function readEndpoint(browser: Browser): string | null {
  const candidate = (browser as { wsEndpoint?: () => string }).wsEndpoint;
  if (typeof candidate !== "function") return null;

  try {
    return candidate.call(browser) || null;
  } catch {
    return null;
  }
}
