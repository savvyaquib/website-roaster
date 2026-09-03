/**
 * End-to-end audit test.
 *
 * Extraction and normalization are covered exhaustively with fixtures. What
 * this proves is the part fixtures cannot: that the real engine attaches to the
 * browser, runs, and returns a report whose audit identifiers still match the
 * ones this phase reads. Without it, an engine API change would pass every
 * other test in the suite.
 */

import { existsSync } from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "@/lib/analysis/http";

import { analyzePerformance } from "./analyze-performance";
import { runLighthouse } from "./run-lighthouse";

function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const HAS_BROWSER = chromiumInstalled();

/** A real Lighthouse run is throttled by design and takes tens of seconds. */
const E2E_TIMEOUT = 180_000;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Performance fixture</title><link rel="stylesheet" href="/site.css"></head>
<body><h1>Hello</h1><img src="/hero.png" width="400" height="300" alt="A hero">
<script src="/app.js"></script></body></html>`;

const handler: Handler = (request, response) => {
  if (request.url === "/site.css") {
    response.writeHead(200, { "content-type": "text/css" });
    response.end("body{color:#111;font-family:system-ui}".repeat(50));
  } else if (request.url === "/app.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end("var unused = function () { return 1; };\n".repeat(1500));
  } else if (request.url === "/hero.png") {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(Buffer.alloc(120_000, 7));
  } else {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(PAGE);
  }
};

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function withServer(body: (baseUrl: string) => Promise<void>): Promise<void> {
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

describe.skipIf(!HAS_BROWSER)("auditing a real page with the real engine", () => {
  it(
    "collects the measurements this phase claims to collect",
    async () => {
      await withServer(async (baseUrl) => {
        const audit = await runLighthouse(`${baseUrl}/`, {
          policy: localPolicy(baseUrl),
        });

        expect(audit.ok).toBe(true);
        if (!audit.ok) return;

        const { measurements, findings } = analyzePerformance({ audit });

        // Every metric named in the phase specification, from a real report.
        expect(measurements.lcpMs).toBeGreaterThan(0);
        expect(measurements.clsScore).not.toBeNull();
        expect(measurements.tbtMs).not.toBeNull();
        expect(measurements.totalByteWeight).toBeGreaterThan(0);
        expect(measurements.requestCount).toBeGreaterThan(0);
        expect(measurements.javaScriptBootupMs).not.toBeNull();
        expect(measurements.mainThreadWorkMs).not.toBeNull();

        // Provenance, so a number can be traced to what produced it.
        expect(measurements.engineName).toBe("lighthouse");
        expect(measurements.engineVersion).toMatch(/^\d+\./);

        // INP stays null even against a real engine run (ADR-030).
        expect(measurements.inpMs).toBeNull();
        expect(measurements.inpUnavailableReason).not.toBeNull();

        expect(findings.length).toBeGreaterThan(0);
        for (const finding of findings) {
          expect(finding.category).toBe("performance");
          expect(finding.evidence.length).toBeGreaterThan(0);
          expect((finding.recommendation ?? "").length).toBeGreaterThan(0);
        }
      });
    },
    E2E_TIMEOUT,
  );
});
