/**
 * End-to-end mobile probe tests.
 *
 * The analyzer is covered exhaustively with fixtures. What these prove is the
 * part fixtures cannot: that the in-page measurement script actually runs in a
 * browser and reports the geometry the analyzer expects. Without them the whole
 * measurement layer would be unverified.
 */

import { existsSync } from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "@/lib/analysis/http";

import { analyzeMobile } from "./analyze-mobile";
import { collectMobileSignals } from "./collect-signals";

function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const HAS_BROWSER = chromiumInstalled();
const TIMEOUT = 90_000;

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function withServer(
  html: string,
  body: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const handler: Handler = (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  };

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

/** No viewport tag, a 900px block, a tiny button, and a clipped box. */
const BROKEN = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Broken on mobile</title></head><body style="margin:0">
  <nav><a href="/a">A</a><a href="/b">B</a></nav>
  <div id="wide" style="width:900px;height:40px;background:#ccc">wide</div>
  <button id="tiny" style="width:16px;height:16px;padding:0">x</button>
  <div id="clip" style="width:100px;overflow:hidden;white-space:nowrap">
    a very long line of text that will not fit inside one hundred pixels at all
  </div>
  <p id="fine" style="font-size:9px">Some very small print indeed.</p>
</body></html>`;

const SOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fine on mobile</title></head><body style="margin:0;font-size:16px">
  <nav><a href="/a" style="display:inline-block;min-width:48px;min-height:48px">Home</a></nav>
  <p>Readable body copy that fits the screen.</p>
</body></html>`;

describe.skipIf(!HAS_BROWSER)("measuring a real page at a phone viewport", () => {
  it(
    "measures overflow, tap targets, clipping and small text on a broken page",
    async () => {
      await withServer(BROKEN, async (baseUrl) => {
        const probe = await collectMobileSignals(`${baseUrl}/`, {
          policy: localPolicy(baseUrl),
          settleMs: 200,
        });

        expect(probe.ok).toBe(true);
        if (!probe.ok) return;

        const { signals } = probe;

        expect(signals.viewportMeta).toBeNull();

        // The real symptom of a missing viewport tag: Chromium lays the page
        // out at its 980px desktop fallback and scales the result down, rather
        // than using the 390px screen.
        expect(signals.viewport.deviceWidthPx).toBe(390);
        expect(signals.viewport.widthPx).toBeGreaterThan(900);

        // Measured against that fallback width, so the 900px block does not
        // overflow — which is exactly why the missing tag is the finding that
        // matters on this page.
        expect(signals.horizontalOverflowPx).toBeLessThanOrEqual(2);
        // The block is still wider than the screen, even though it fits the
        // fallback layout width.
        expect(signals.overflowingElementCount).toBe(0);

        // A 16px button is below the WCAG floor.
        expect(signals.smallTapTargetCount).toBeGreaterThan(0);

        // A 100px box holding a much longer line, with overflow hidden.
        expect(signals.clippedElementCount).toBeGreaterThan(0);

        // 9px text.
        expect(signals.smallTextCount).toBeGreaterThan(0);

        expect(signals.navigation.navCount).toBe(1);
        expect(signals.screenshot.available).toBe(true);

        const findings = analyzeMobile({ probe });
        const ids = findings.map((finding) => finding.id);

        expect(ids).toContain("mobile.viewport.missing");
        expect(ids).toContain("mobile.tap_targets.below_minimum");
        expect(ids).toContain("mobile.clipping.content_hidden");
        expect(ids).toContain("mobile.text.small");
      });
    },
    TIMEOUT,
  );

  it(
    "finds nothing wrong with a page built for mobile",
    async () => {
      await withServer(SOUND, async (baseUrl) => {
        const probe = await collectMobileSignals(`${baseUrl}/`, {
          policy: localPolicy(baseUrl),
          settleMs: 200,
        });

        expect(probe.ok).toBe(true);
        if (!probe.ok) return;

        expect(probe.signals.horizontalOverflowPx).toBeLessThanOrEqual(2);
        expect(probe.signals.smallTapTargetCount).toBe(0);
        expect(probe.signals.clippedElementCount).toBe(0);
        expect(probe.signals.viewportMeta).toContain("width=device-width");

        const findings = analyzeMobile({ probe });

        // Even a clean page still carries the caveat about what was not tested.
        expect(
          findings.find((finding) => finding.id === "mobile.assessment.limits")?.status,
        ).toBe("could_not_determine");
        expect(findings.filter((finding) => finding.status === "fail")).toEqual([]);
      });
    },
    TIMEOUT,
  );

  it(
    "closes the browser even when the page cannot be reached",
    async () => {
      let closed = 0;
      const baseUrl = "http://127.0.0.1:1";

      await collectMobileSignals(`${baseUrl}/`, {
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
    TIMEOUT,
  );
});
