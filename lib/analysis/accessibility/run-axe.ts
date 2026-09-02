/**
 * Running the accessibility engine against a live page.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 7, docs/DECISIONS.md ADR-047.
 *
 * This is the only part of Phase 7 that touches a browser. It reuses Phase 3's
 * session management and request guard rather than launching its own Chromium
 * arrangement, so the security boundary and cleanup behaviour are the ones
 * already reviewed (ADR-042).
 *
 * Normalization lives in `normalize.ts` and never runs here, which is what
 * keeps the mapping testable without a browser.
 */

import axe from "axe-core";
import type { BrowserContext, Page } from "playwright";

import { createNavigationGuard } from "@/lib/analysis/browser";
import { launchSession, BrowserUnavailableError } from "@/lib/analysis/browser";
import type { BrowserLauncher } from "@/lib/analysis/browser";
import { DESKTOP_VIEWPORT } from "@/lib/analysis/browser";
import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "@/lib/analysis/http";
import type { AddressResolver } from "@/lib/analysis/http";
import { analysisStatusForRejection } from "@/lib/analysis/url";
import { createLogger, type Logger } from "@/lib/observability/logger";

import type { AccessibilityFailureCode, AxeAudit, AxeAuditResults } from "./types";

export const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;

/** The audit itself, separate from loading the page. */
export const DEFAULT_AUDIT_TIMEOUT_MS = 30_000;

export const DEFAULT_SETTLE_MS = 1_000;

export interface RunAxeOptions {
  readonly navigationTimeoutMs?: number;
  readonly auditTimeoutMs?: number;
  readonly settleMs?: number;
  readonly policy?: HttpSecurityPolicy;
  readonly logger?: Logger;
  /** Test seam: supply a browser rather than launching Chromium. */
  readonly launcher?: BrowserLauncher;
  /** Test seam: supply DNS answers to the request guard. */
  readonly resolver?: AddressResolver;
}

/** The shape the injected engine exposes on `window`. */
interface AxeGlobal {
  run(context: Document, options: unknown): Promise<AxeAuditResults>;
}

/**
 * Load a page and audit it.
 *
 * Never throws for an expected condition. A missing browser, an unreachable
 * page and an engine that fails to run are all returned as values, so the
 * analyzer can report them rather than losing the section (ADR-021).
 *
 * The browser is always closed.
 */
export async function runAxe(
  inputUrl: string,
  options: RunAxeOptions = {},
): Promise<AxeAudit> {
  const navigationTimeoutMs =
    options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  const auditTimeoutMs = options.auditTimeoutMs ?? DEFAULT_AUDIT_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const policy = options.policy ?? publicHttpSecurityPolicy;
  const log = options.logger ?? createLogger("analysis.accessibility");

  const startedAt = Date.now();
  const fail = (code: AccessibilityFailureCode, message: string): AxeAudit => {
    log.warn("accessibility.audit.failed", { code });
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
    context = await session.browser.newContext({
      viewport: { width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height },
      deviceScaleFactor: DESKTOP_VIEWPORT.deviceScaleFactor,
      ignoreHTTPSErrors: false,
      serviceWorkers: "block",
    });

    context.setDefaultTimeout(navigationTimeoutMs);
    context.setDefaultNavigationTimeout(navigationTimeoutMs);

    // The same guard Phase 3 applies, so a page cannot use the audit as a way
    // to reach somewhere we would refuse to go.
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
      return fail(...classifyNavigationError(error));
    }

    await page.waitForTimeout(settleMs);

    try {
      // `axe.source` is the whole engine as a string, so no file needs to be
      // resolved on disk or served to the page.
      await page.addScriptTag({ content: axe.source });
    } catch (error) {
      return fail(
        "engine_injection_failed",
        `The accessibility engine could not be loaded into the page. ${describe(error)}`,
      );
    }

    let results: AxeAuditResults;
    try {
      results = await runAudit(page, auditTimeoutMs);
    } catch (error) {
      const message = describe(error);
      if (/Timeout|timeout/.test(message)) {
        return fail("timeout", "The accessibility audit took too long to finish.");
      }
      return fail("audit_failed", `The accessibility audit did not complete. ${message}`);
    }

    log.info("accessibility.audit.completed", {
      url,
      violations: results.violations.length,
      incomplete: results.incomplete.length,
      passes: results.passes.length,
      elapsedMs: Date.now() - startedAt,
    });

    return { ok: true, results, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return fail(...classifyNavigationError(error));
  } finally {
    if (context !== null) await context.close().catch(() => undefined);
    // Always, on every path. A leaked Chromium is hundreds of megabytes.
    await session.close();
  }
}

async function runAudit(page: Page, timeoutMs: number): Promise<AxeAuditResults> {
  const audit = page.evaluate(async () => {
    // `axe` is injected at runtime, so it is not on the page's type. The cast
    // is confined to this line rather than widening the whole evaluate call.
    const engine = (window as unknown as { axe: AxeGlobal }).axe;

    const results = await engine.run(document, {
      // `inapplicable` says a rule found nothing to test, which says nothing
      // about the page. Excluding it here avoids shipping dozens of empty
      // entries across the process boundary.
      resultTypes: ["violations", "incomplete", "passes"],
    });

    // Selectors come back nested for elements inside iframes. Flattening here,
    // in the page, keeps the normalizer's input a plain list of strings.
    const flatten = (rules: AxeAuditResults["violations"]) =>
      rules.map((rule) => ({
        ...rule,
        nodes: rule.nodes.map((node) => ({
          ...node,
          target: (node.target as unknown as unknown[]).flat(Infinity).map(String),
        })),
      }));

    return {
      violations: flatten(results.violations),
      incomplete: flatten(results.incomplete),
      passes: flatten(results.passes),
      testEngine: results.testEngine,
      url: results.url,
    } as AxeAuditResults;
  });

  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () => reject(new Error(`Audit timeout of ${timeoutMs}ms exceeded`)),
      timeoutMs,
    ).unref?.();
  });

  return Promise.race([audit, timeout]);
}

function classifyNavigationError(error: unknown): [AccessibilityFailureCode, string] {
  const text = describe(error);

  if (/Timeout .* exceeded|TimeoutError/i.test(text)) {
    return ["timeout", "The page took too long to load."];
  }
  if (/net::ERR_|NS_ERROR|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i.test(text)) {
    return ["navigation_failed", "The page could not be loaded in a browser."];
  }

  return ["browser_error", `The accessibility audit could not run. ${text}`];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
