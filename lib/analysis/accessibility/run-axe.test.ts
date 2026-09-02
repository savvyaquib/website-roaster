/**
 * End-to-end audit tests.
 *
 * The normalization is covered exhaustively with fixtures in normalize.test.ts.
 * What these prove is the part fixtures cannot: that the engine actually
 * injects into a live page, runs, and produces output the normalizer accepts.
 */

import { existsSync } from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "@/lib/analysis/http";

import { analyzeAccessibility } from "./analyze-accessibility";
import { runAxe } from "./run-axe";

function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const HAS_BROWSER = chromiumInstalled();
const BROWSER_TEST_TIMEOUT = 90_000;

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function withServer(
  handler: Handler,
  body: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await body(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function localPolicy(baseUrl: string): HttpSecurityPolicy {
  return {
    validateUrl: (url) =>
      url.startsWith(baseUrl)
        ? { valid: true, normalizedUrl: url }
        : publicHttpSecurityPolicy.validateUrl(url),
    validateAddress: (address) =>
      address === "127.0.0.1" ? null : publicHttpSecurityPolicy.validateAddress(address),
  };
}

function serve(html: string): Handler {
  return (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  };
}

/** Deliberately broken: no lang, no title, an image with no alt text. */
const INACCESSIBLE = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
  <div style="color:#eee;background:#fff">Very low contrast text</div>
  <a href="/somewhere"></a>
</body>
</html>`;

const ACCESSIBLE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>An accessible page</title></head>
<body>
  <main>
    <h1>Hello</h1>
    <p style="color:#111;background:#fff">Readable text with strong contrast.</p>
  </main>
</body>
</html>`;

describe.skipIf(!HAS_BROWSER)("auditing a real page", () => {
  it(
    "finds real violations and normalizes them",
    async () => {
      await withServer(serve(INACCESSIBLE), async (baseUrl) => {
        const audit = await runAxe(`${baseUrl}/`, {
          policy: localPolicy(baseUrl),
          settleMs: 200,
        });

        expect(audit.ok).toBe(true);
        if (!audit.ok) return;

        expect(audit.results.violations.length).toBeGreaterThan(0);

        const findings = analyzeAccessibility({ audit });
        const ids = findings.map((finding) => finding.id);

        // These three are unambiguous and stable across engine versions.
        expect(ids).toContain("accessibility.axe.image-alt");
        expect(ids).toContain("accessibility.axe.html-has-lang");
        expect(ids).toContain("accessibility.axe.document-title");

        const imageAlt = findings.find(
          (finding) => finding.id === "accessibility.axe.image-alt",
        );
        expect(imageAlt?.status).toBe("fail");
        expect(imageAlt?.severity).toBe("critical");
        // Traceable back to the audit: a real selector and real markup.
        expect(imageAlt?.evidence.length).toBeGreaterThan(1);
        expect(imageAlt?.evidence[1]?.detail).toContain("<img");
        expect(imageAlt?.recommendation).toContain("https://");
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "reports passes without claiming the page is accessible",
    async () => {
      await withServer(serve(ACCESSIBLE), async (baseUrl) => {
        const audit = await runAxe(`${baseUrl}/`, {
          policy: localPolicy(baseUrl),
          settleMs: 200,
        });

        expect(audit.ok).toBe(true);
        if (!audit.ok) return;

        const findings = analyzeAccessibility({ audit });
        const passes = findings.find(
          (finding) => finding.id === "accessibility.axe.passes",
        );

        expect(passes?.status).toBe("pass");
        expect(passes?.explanation).toContain(
          "not a statement that the page is accessible",
        );
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "produces findings that all satisfy the finding contract",
    async () => {
      await withServer(serve(INACCESSIBLE), async (baseUrl) => {
        const audit = await runAxe(`${baseUrl}/`, {
          policy: localPolicy(baseUrl),
          settleMs: 200,
        });

        const findings = analyzeAccessibility({ audit });

        expect(findings.length).toBeGreaterThan(0);
        for (const finding of findings) {
          expect(finding.category).toBe("accessibility");
          expect(
            finding.evidence.length,
            `${finding.id} has no evidence`,
          ).toBeGreaterThan(0);
          expect(
            (finding.recommendation ?? "").length,
            `${finding.id} has no recommendation`,
          ).toBeGreaterThan(0);
          expect(finding.explanation.length).toBeGreaterThan(0);
        }
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "reports a page it cannot reach rather than throwing",
    async () => {
      let closedPort = 0;
      await withServer(serve(ACCESSIBLE), async (baseUrl) => {
        closedPort = Number(new URL(baseUrl).port);
      });

      const baseUrl = `http://127.0.0.1:${closedPort}`;
      const audit = await runAxe(`${baseUrl}/`, {
        policy: localPolicy(baseUrl),
        navigationTimeoutMs: 8_000,
      });

      expect(audit.ok).toBe(false);
      if (!audit.ok) {
        expect(["navigation_failed", "browser_error", "timeout"]).toContain(
          audit.failure.code,
        );
      }

      // The section survives the failure as an explicit unknown.
      expect(analyzeAccessibility({ audit })[0]?.status).toBe("could_not_determine");
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "times out on a page that never finishes loading",
    async () => {
      await withServer(
        (_request, response) => {
          response.writeHead(200, { "content-type": "text/html" });
          response.write("<html><head><title>slow</title></head><body>");
          // Never end the response.
        },
        async (baseUrl) => {
          const audit = await runAxe(`${baseUrl}/`, {
            policy: localPolicy(baseUrl),
            navigationTimeoutMs: 2_000,
          });

          expect(audit.ok).toBe(false);
          if (!audit.ok) expect(audit.failure.code).toBe("timeout");
        },
      );
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "closes the browser even when the audit fails",
    async () => {
      let closed = 0;

      const baseUrl = "http://127.0.0.1:1";
      await runAxe(`${baseUrl}/`, {
        policy: localPolicy(baseUrl),
        navigationTimeoutMs: 5_000,
        launcher: async (options) => {
          const browser = await chromium.launch(options);
          const originalClose = browser.close.bind(browser);
          browser.close = async () => {
            closed += 1;
            return originalClose();
          };
          return browser;
        },
      });

      expect(closed).toBe(1);
    },
    BROWSER_TEST_TIMEOUT,
  );
});
