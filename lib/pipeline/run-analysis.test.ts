/**
 * End-to-end pipeline tests.
 *
 * A real HTTP server, the real Phase 2 client, the real DOM parser and the real
 * analyzers. The only substitutions are the network policy — the production one
 * correctly refuses 127.0.0.1, so a test that reached a local server without it
 * would be testing nothing — and AI, which is switched off.
 *
 * This is the layer that stub-runner API tests cannot cover: whether the
 * analyzers are actually wired together and produce a coherent report.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { publicHttpSecurityPolicy } from "@/lib/analysis/http";
import type { HttpSecurityPolicy } from "@/lib/analysis/http";
import { validateUrl } from "@/lib/analysis/url";
import { createLogger } from "@/lib/observability/logger";

import { NOT_RUN_IN_THIS_PHASE, runAnalysis } from "./run-analysis";

const silent = createLogger("test", { level: "silent" });

/**
 * A policy permitting loopback and non-default ports.
 *
 * Defined here rather than exported from the application, so nothing shipped
 * contains a way to relax the production policy.
 */
const localPolicy: HttpSecurityPolicy = {
  validateUrl(url) {
    const parsed = new URL(url);

    return parsed.hostname === "127.0.0.1"
      ? { valid: true, normalizedUrl: parsed.href }
      : publicHttpSecurityPolicy.validateUrl(url);
  },
  validateAddress(address) {
    return address === "127.0.0.1"
      ? null
      : publicHttpSecurityPolicy.validateAddress(address);
  },
};

const servers: http.Server[] = [];

async function serve(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

function html(body: string): string {
  return `<!doctype html><html lang="en"><head><title>Example page</title>
<meta name="description" content="A page that exists for a test to read.">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>${body}</body></html>`;
}

const PAGE = html(`<nav><a href="/a">A</a><a href="/b">B</a></nav>
<main><h1>Ship faster</h1><p>We help engineering teams ship sooner than they do now.</p>
<h2>Pricing</h2><p>Simple plans for teams of every size, starting today.</p>
<a href="/signup">Get started</a></main>
<footer><p>Contact <a href="mailto:hi@example.com">hi@example.com</a></p></footer>`);

function run(url: string) {
  return runAnalysis(url, { httpPolicy: localPolicy, skipAi: true, logger: silent });
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

// ---------------------------------------------------------------------------

describe("a page that analyzes cleanly", () => {
  it("completes and produces a report", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(PAGE);
    });

    const outcome = await run(url);

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;

    expect(outcome.report.httpStatus).toBe(200);
    expect(outcome.report.findings.length).toBeGreaterThan(0);
  });

  it("produces a score traceable to the findings it collected", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(PAGE);
    });

    const outcome = await run(url);
    if (outcome.status !== "completed") throw new Error("expected completion");

    const { score, findings } = outcome.report;

    expect(score.overall.score).not.toBeNull();
    expect(score.overall.grade).not.toBeNull();

    const categories = new Set(findings.map((finding) => finding.category));
    for (const category of categories) {
      const scored = score.categories.find((entry) => entry.category === category);
      expect(scored, `${category} was not scored`).toBeDefined();
    }
  });

  it("runs every analyzer this phase claims to run", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(PAGE);
    });

    const outcome = await run(url);
    if (outcome.status !== "completed") throw new Error("expected completion");

    const categories = new Set(
      outcome.report.findings.map((finding) => finding.category),
    );

    for (const expected of ["seo", "security", "content", "ux"]) {
      expect(categories.has(expected as never), `no ${expected} findings`).toBe(true);
    }
  });

  it("names the analyzers it did not run, rather than hiding them", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(PAGE);
    });

    const outcome = await run(url);
    if (outcome.status !== "completed") throw new Error("expected completion");

    expect(outcome.report.notRun).toEqual(NOT_RUN_IN_THIS_PHASE);

    // Not assessed, not zero (ADR-036).
    for (const category of NOT_RUN_IN_THIS_PHASE) {
      const scored = outcome.report.score.categories.find(
        (entry) => entry.category === category,
      );
      expect(scored?.status).toBe("not_assessed");
      expect(scored?.score).toBeNull();
    }
  });

  it("ranks recommendations and writes a roast from the same findings", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(html("<main><p>Nothing much here at all.</p></main>"));
    });

    const outcome = await run(url);
    if (outcome.status !== "completed") throw new Error("expected completion");

    const ids = new Set(outcome.report.findings.map((finding) => finding.id));

    expect(outcome.report.recommendations.summary.total).toBeGreaterThan(0);
    for (const recommendation of outcome.report.recommendations.recommendations) {
      expect(ids.has(recommendation.findingId)).toBe(true);
    }

    expect(outcome.report.roast.lines.length).toBeGreaterThan(0);
    for (const line of outcome.report.roast.lines) {
      expect(ids.has(line.finding.id)).toBe(true);
    }
  });

  it("falls back to the written roast when AI is off", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(html("<main><p>Thin.</p></main>"));
    });

    const outcome = await run(url);
    if (outcome.status !== "completed") throw new Error("expected completion");

    expect(outcome.report.roast.source).toBe("deterministic");
    expect(outcome.report.interpretation).toBeNull();
    expect(outcome.report.interpretationUnavailableReason).not.toBeNull();
  });

  it("serialises to JSON, because it is about to be stored as JSON", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(PAGE);
    });

    const outcome = await run(url);
    if (outcome.status !== "completed") throw new Error("expected completion");

    const roundTripped = JSON.parse(JSON.stringify(outcome.report)) as unknown;

    expect(roundTripped).toEqual(outcome.report);
  });

  it("follows a redirect and reports where it ended up", async () => {
    const url = await serve((request, response) => {
      if (request.url === "/") {
        response.writeHead(302, { location: "/final" });
        response.end();
        return;
      }

      response.writeHead(200, { "content-type": "text/html" });
      response.end(PAGE);
    });

    const outcome = await run(url);
    if (outcome.status !== "completed") throw new Error("expected completion");

    expect(outcome.report.finalUrl).toContain("/final");
  });
});

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

describe("failures get their own state", () => {
  it("reports a timeout as timeout, not failed", async () => {
    const url = await serve(() => {
      // Never responds.
    });

    const outcome = await runAnalysis(url, {
      httpPolicy: localPolicy,
      skipAi: true,
      logger: silent,
      timeoutMs: 60,
    });

    expect(outcome.status).toBe("timeout");
  });

  it("reports an unreachable host as failed", async () => {
    // A port nothing is listening on.
    const url = await serve(() => undefined);
    const closed = new URL(url);
    closed.port = String(Number(closed.port) + 1);

    const outcome = await run(closed.href);

    expect(outcome.status).toBe("failed");
    if (outcome.status === "completed") return;
    expect(outcome.code.length).toBeGreaterThan(0);
    expect(outcome.message.length).toBeGreaterThan(0);
  });

  it("reports a non-HTML response rather than analyzing nothing", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end("%PDF-1.4");
    });

    const outcome = await run(url);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "completed") expect(outcome.code).toBe("no_html");
  });

  it("still completes a 404 page, because a 404 is a page", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(404, { "content-type": "text/html" });
      response.end(PAGE);
    });

    const outcome = await run(url);

    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") expect(outcome.report.httpStatus).toBe(404);
  });

  it("refuses a private address under the production policy", async () => {
    // No policy override: this is what the API actually does.
    const outcome = await runAnalysis("http://127.0.0.1:1/", {
      skipAi: true,
      logger: silent,
    });

    expect(outcome.status).toBe("blocked");
  });

  it("survives a page that breaks one analyzer", async () => {
    // Malformed markup must not cost the categories that parsed fine.
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body><div><p>unclosed<<<>>&&amp;</body>");
    });

    const outcome = await run(url);

    expect(outcome.status).toBe("completed");
  });
});
