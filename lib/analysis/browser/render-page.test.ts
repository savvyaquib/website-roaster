import { existsSync } from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { describe, expect, it, vi } from "vitest";

import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "@/lib/analysis/http";

import { renderPage } from "./render-page";
import type { BrowserLauncher } from "./session";
import type { BrowserRenderResult } from "./types";

/**
 * Chromium is a ~150 MB download, so the suite reports honestly rather than
 * failing when it is absent. `npx playwright install chromium` enables these.
 */
function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const HAS_BROWSER = chromiumInstalled();

/** Rendering two viewports in a real browser is not a five-second operation. */
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

/**
 * Permits the local test server while keeping the production rules for every
 * other host, so a blocked-subresource test exercises the real policy.
 */
function hybridPolicy(baseUrl: string): HttpSecurityPolicy {
  return {
    validateUrl: (url) => {
      if (url.startsWith(baseUrl)) return { valid: true, normalizedUrl: url };
      return publicHttpSecurityPolicy.validateUrl(url);
    },
    validateAddress: (address) => {
      if (address === "127.0.0.1" || address === "::1") return null;
      return publicHttpSecurityPolicy.validateAddress(address);
    },
  };
}

function serveHtml(body: string): Handler {
  return (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  };
}

function expectOk(result: BrowserRenderResult) {
  if (!result.ok) throw new Error(`expected success, got ${result.failure.code}`);
  return result.page;
}

function expectFailure(result: BrowserRenderResult) {
  if (result.ok) throw new Error("expected failure");
  return result.failure;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Test Page</title>
</head>
<body><h1>Hello</h1><p>Rendered.</p></body>
</html>`;

describe("failures that need no browser", () => {
  it("refuses a malformed URL", async () => {
    const failure = expectFailure(await renderPage("not a url"));

    expect(failure.code).toBe("invalid_url");
  });

  it("refuses a private address using the production policy", async () => {
    const failure = expectFailure(await renderPage("http://192.168.1.1/"));

    expect(failure.code).toBe("blocked");
  });

  it("refuses the metadata endpoint", async () => {
    const failure = expectFailure(await renderPage("http://169.254.169.254/"));

    expect(failure.code).toBe("blocked");
  });

  it("never launches a browser for a URL it will refuse", async () => {
    const launcher = vi.fn<BrowserLauncher>();

    await renderPage("http://localhost/", { launcher });

    expect(launcher).not.toHaveBeenCalled();
  });

  it("reports a missing browser binary as browser_unavailable", async () => {
    const failure = expectFailure(
      await renderPage("https://example.com/", {
        launcher: async () => {
          throw new Error("Executable doesn't exist at /nowhere/chrome");
        },
      }),
    );

    expect(failure.code).toBe("browser_unavailable");
    expect(failure.message).toMatch(/playwright install/);
  });
});

describe.skipIf(!HAS_BROWSER)("rendering a real page", () => {
  it(
    "collects title, DOM, layout, timings and screenshots at both viewports",
    async () => {
      await withServer(serveHtml(PAGE), async (baseUrl) => {
        const page = expectOk(
          await renderPage(`${baseUrl}/`, {
            policy: hybridPolicy(baseUrl),
            settleMs: 100,
          }),
        );

        expect(Object.keys(page.renderings).sort()).toEqual(["desktop", "mobile"]);

        const desktop = page.renderings.desktop;
        expect(desktop.title).toBe("Test Page");
        expect(desktop.htmlLanguage).toBe("en");
        expect(desktop.viewportMeta).toContain("width=device-width");
        expect(desktop.status).toBe(200);
        expect(desktop.finalUrl).toBe(`${baseUrl}/`);

        // The post-JavaScript DOM, which is what Phase 4 will parse.
        expect(desktop.renderedHtml).toContain("<h1>Hello</h1>");

        expect(desktop.layout.viewportWidth).toBe(1440);
        expect(page.renderings.mobile.layout.viewportWidth).toBe(390);

        expect(desktop.timing.navigationMs).toBeGreaterThan(0);
        expect(desktop.timing.domContentLoadedMs).not.toBeNull();
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "produces real PNG screenshots",
    async () => {
      await withServer(serveHtml(PAGE), async (baseUrl) => {
        const page = expectOk(
          await renderPage(`${baseUrl}/`, {
            policy: hybridPolicy(baseUrl),
            settleMs: 100,
          }),
        );

        for (const name of ["desktop", "mobile"] as const) {
          const shot = page.renderings[name].screenshot;
          expect(shot.byteLength).toBeGreaterThan(100);
          // PNG magic number.
          expect(Array.from(shot.data.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
          expect(shot.viewport).toBe(name);
          expect(shot.fullPage).toBe(false);
        }
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "renders content produced by JavaScript",
    async () => {
      const scripted = `<!doctype html><html><head><title>x</title></head><body>
        <div id="target"></div>
        <script>document.getElementById('target').textContent = 'from-script';
                document.title = 'Scripted';</script>
      </body></html>`;

      await withServer(serveHtml(scripted), async (baseUrl) => {
        const page = expectOk(
          await renderPage(`${baseUrl}/`, {
            policy: hybridPolicy(baseUrl),
            settleMs: 200,
          }),
        );

        // The whole point of a browser phase: this is invisible to Phase 2.
        expect(page.renderings.desktop.renderedHtml).toContain("from-script");
        expect(page.renderings.desktop.title).toBe("Scripted");
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "captures console errors and uncaught exceptions",
    async () => {
      const noisy = `<!doctype html><html><head><title>x</title></head><body>
        <script>
          console.error('a console error');
          console.warn('a console warning');
          setTimeout(() => { throw new Error('an uncaught error'); }, 0);
        </script>
      </body></html>`;

      await withServer(serveHtml(noisy), async (baseUrl) => {
        const page = expectOk(
          await renderPage(`${baseUrl}/`, {
            policy: hybridPolicy(baseUrl),
            settleMs: 400,
          }),
        );

        const texts = page.console.map((entry) => entry.text).join("\n");
        expect(texts).toContain("a console error");
        expect(texts).toContain("a console warning");
        expect(texts).toContain("an uncaught error");

        expect(page.console.some((e) => e.level === "error")).toBe(true);
        expect(page.console.some((e) => e.level === "pageerror")).toBe(true);
        expect(
          page.console.every((e) => e.viewport === "desktop" || e.viewport === "mobile"),
        ).toBe(true);
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "records network requests",
    async () => {
      const withAssets = `<!doctype html><html><head><title>x</title>
        <link rel="stylesheet" href="/style.css"></head>
        <body><script src="/app.js"></script></body></html>`;

      await withServer(
        (request, response) => {
          if (request.url === "/style.css") {
            response.writeHead(200, { "content-type": "text/css" });
            response.end("body{color:red}");
            return;
          }
          if (request.url === "/app.js") {
            response.writeHead(200, { "content-type": "text/javascript" });
            response.end("void 0;");
            return;
          }
          response.writeHead(200, { "content-type": "text/html" });
          response.end(withAssets);
        },
        async (baseUrl) => {
          const page = expectOk(
            await renderPage(`${baseUrl}/`, {
              policy: hybridPolicy(baseUrl),
              settleMs: 300,
            }),
          );

          const types = page.network.map((entry) => entry.resourceType);
          expect(types).toContain("document");
          expect(types).toContain("stylesheet");
          expect(types).toContain("script");

          const document = page.network.find((e) => e.resourceType === "document");
          expect(document?.status).toBe(200);
          expect(document?.method).toBe("GET");
        },
      );
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "blocks a subresource pointing at the metadata endpoint",
    async () => {
      // The largest part of the SSRF surface: the *page* chooses this request,
      // and neither Phase 1 nor Phase 2 sees it.
      const hostile = `<!doctype html><html><head><title>x</title></head><body>
        <img src="http://169.254.169.254/latest/meta-data/iam/">
      </body></html>`;

      await withServer(serveHtml(hostile), async (baseUrl) => {
        const page = expectOk(
          await renderPage(`${baseUrl}/`, {
            policy: hybridPolicy(baseUrl),
            settleMs: 400,
          }),
        );

        expect(page.blockedRequests.some((u) => u.includes("169.254.169.254"))).toBe(
          true,
        );

        const blocked = page.network.filter((entry) => entry.blocked);
        expect(blocked.length).toBeGreaterThan(0);
        expect(blocked[0]?.status).toBeNull();
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "reports a page that cannot be reached",
    async () => {
      let closedPort = 0;
      await withServer(serveHtml(PAGE), async (baseUrl) => {
        closedPort = Number(new URL(baseUrl).port);
      });

      const baseUrl = `http://127.0.0.1:${closedPort}`;
      const failure = expectFailure(
        await renderPage(`${baseUrl}/`, {
          policy: hybridPolicy(baseUrl),
          navigationTimeoutMs: 10_000,
        }),
      );

      expect(["navigation_failed", "browser_error"]).toContain(failure.code);
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
          const failure = expectFailure(
            await renderPage(`${baseUrl}/`, {
              policy: hybridPolicy(baseUrl),
              navigationTimeoutMs: 2_000,
            }),
          );

          expect(failure.code).toBe("timeout");
          expect(failure.totalElapsedMs).toBeLessThan(BROWSER_TEST_TIMEOUT);
        },
      );
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "captures the full scrollable page when asked",
    async () => {
      const tall = `<!doctype html><html><head><title>tall</title></head>
        <body><div style="height:3000px">tall</div></body></html>`;

      await withServer(serveHtml(tall), async (baseUrl) => {
        const page = expectOk(
          await renderPage(`${baseUrl}/`, {
            policy: hybridPolicy(baseUrl),
            settleMs: 100,
            fullPageScreenshots: true,
          }),
        );

        const shot = page.renderings.desktop.screenshot;
        expect(shot.fullPage).toBe(true);
        expect(page.renderings.desktop.layout.scrollHeight).toBeGreaterThan(2000);
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "measures horizontal overflow at the mobile viewport",
    async () => {
      // Raw measurement only. Whether this is a mobile problem is Phase 9.
      const wide = `<!doctype html><html><head><title>wide</title></head>
        <body><div style="width:1200px">wide</div></body></html>`;

      await withServer(serveHtml(wide), async (baseUrl) => {
        const page = expectOk(
          await renderPage(`${baseUrl}/`, {
            policy: hybridPolicy(baseUrl),
            settleMs: 100,
          }),
        );

        const mobile = page.renderings.mobile.layout;
        expect(mobile.scrollWidth).toBeGreaterThan(mobile.viewportWidth);
      });
    },
    BROWSER_TEST_TIMEOUT,
  );

  it(
    "closes the browser even when rendering fails",
    async () => {
      let launched = 0;
      let closed = 0;

      const launcher: BrowserLauncher = async (options) => {
        launched += 1;
        const browser = await chromium.launch(options);
        const originalClose = browser.close.bind(browser);
        browser.close = async () => {
          closed += 1;
          return originalClose();
        };
        return browser;
      };

      const baseUrl = "http://127.0.0.1:1";
      await renderPage(`${baseUrl}/`, {
        policy: hybridPolicy(baseUrl),
        launcher,
        navigationTimeoutMs: 5_000,
      });

      expect(launched).toBe(1);
      expect(closed).toBe(1);
    },
    BROWSER_TEST_TIMEOUT,
  );
});
