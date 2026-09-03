/**
 * Running the performance engine against a page.
 *
 * Source of truth: docs/DECISIONS.md ADR-007, ADR-033, ADR-048.
 *
 * ADR-033 requires Lighthouse to attach to the **same browser process** Phase 3
 * uses, while performing its **own** page load — a cold, throttled one, because
 * reusing a warmed page would silently corrupt every metric.
 *
 * Playwright does not expose a raw DevTools port, so the browser is launched
 * with an explicit `--remote-debugging-port` and Lighthouse connects to that.
 *
 * This is the only part of Phase 8 that touches a browser. Extraction and
 * normalization are pure and live elsewhere, which is what lets them be tested
 * with fixtures.
 */

import net from "node:net";

import type { BrowserLauncher } from "@/lib/analysis/browser";
import { BrowserUnavailableError, launchSession } from "@/lib/analysis/browser";
import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "@/lib/analysis/http";
import { analysisStatusForRejection } from "@/lib/analysis/url";
import { createLogger, type Logger } from "@/lib/observability/logger";

import type { LighthouseReport, PerformanceAudit, PerformanceFailureCode } from "./types";

export const DEFAULT_AUDIT_TIMEOUT_MS = 120_000;

export interface RunLighthouseOptions {
  readonly auditTimeoutMs?: number;
  readonly policy?: HttpSecurityPolicy;
  readonly logger?: Logger;
  /** Test seam: supply a browser rather than launching Chromium. */
  readonly launcher?: BrowserLauncher;
  /** Test seam: run the engine without loading the real one. */
  readonly runner?: LighthouseRunner;
}

/** The engine call, injectable so the orchestration can be tested. */
export type LighthouseRunner = (
  url: string,
  port: number,
) => Promise<LighthouseReport | null>;

/** Ask the OS for a port nothing is using, then hand it to Chromium. */
async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a debugging port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** The real engine, loaded on demand so importing this module stays cheap. */
const defaultRunner: LighthouseRunner = async (url, port) => {
  const { default: lighthouse } = await import("lighthouse");

  const result = await lighthouse(url, {
    port,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance"],
  });

  return (result?.lhr as LighthouseReport | undefined) ?? null;
};

/**
 * Load and audit a page.
 *
 * Never throws for an expected condition. The browser is always closed.
 */
export async function runLighthouse(
  inputUrl: string,
  options: RunLighthouseOptions = {},
): Promise<PerformanceAudit> {
  const auditTimeoutMs = options.auditTimeoutMs ?? DEFAULT_AUDIT_TIMEOUT_MS;
  const policy = options.policy ?? publicHttpSecurityPolicy;
  const log = options.logger ?? createLogger("analysis.performance");
  const runner = options.runner ?? defaultRunner;

  const startedAt = Date.now();
  const fail = (code: PerformanceFailureCode, message: string): PerformanceAudit => {
    log.warn("performance.audit.failed", { code });
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

  let port: number;
  try {
    port = await reserveFreePort();
  } catch (error) {
    return fail("browser_error", describe(error));
  }

  let session;
  try {
    session = await launchSession({
      launcher: options.launcher,
      logger: log,
      // Lighthouse speaks raw CDP, which Playwright does not expose, so the
      // port is opened explicitly for it.
      extraArgs: [`--remote-debugging-port=${port}`],
    });
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      return fail("browser_unavailable", error.message);
    }
    return fail("browser_error", describe(error));
  }

  try {
    const report = await withTimeout(runner(url, port), auditTimeoutMs);

    if (report === null) {
      return fail("audit_failed", "The performance engine returned no report.");
    }

    // The engine ran but says it could not measure the page — a different
    // event from the engine itself failing, and reported as such.
    if (report.runtimeError !== undefined) {
      return fail(
        "audit_error",
        report.runtimeError.message ??
          `The performance engine could not measure the page (${report.runtimeError.code ?? "unknown"}).`,
      );
    }

    log.info("performance.audit.completed", {
      url,
      elapsedMs: Date.now() - startedAt,
      engineVersion: report.lighthouseVersion ?? "unknown",
    });

    return { ok: true, report, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return fail(...classifyEngineError(error));
  } finally {
    // Always, on every path. A leaked Chromium is hundreds of megabytes.
    await session.close();
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () => reject(new Error(`Audit timeout of ${timeoutMs}ms exceeded`)),
      timeoutMs,
    ).unref?.();
  });

  return Promise.race([work, timeout]);
}

function classifyEngineError(error: unknown): [PerformanceFailureCode, string] {
  const text = describe(error);

  if (/timeout/i.test(text)) {
    return ["timeout", "The performance audit did not finish within its budget."];
  }
  if (/NO_FCP|NO_SPEEDLINE|PAGE_HUNG|INSECURE_DOCUMENT/i.test(text)) {
    return ["audit_error", `The page could not be measured. ${text}`];
  }
  if (/net::ERR_|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|DNS_FAILURE/i.test(text)) {
    return ["navigation_failed", "The page could not be loaded for measurement."];
  }

  return ["audit_failed", `The performance audit did not complete. ${text}`];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
