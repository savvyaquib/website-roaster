import { describe, expect, it, vi } from "vitest";

import type { Finding } from "@/lib/types/finding";

import { analyzePerformance } from "./analyze-performance";
import { AUDIT_IDS } from "./extract-measurements";
import { statusForScore } from "./normalize";
import { runLighthouse, type LighthouseRunner } from "./run-lighthouse";
import {
  PERFORMANCE_FAILURE_CODES,
  type LighthouseAudit,
  type LighthouseReport,
  type PerformanceFailureCode,
} from "./types";

function audit(
  score: number | null,
  extra: Partial<LighthouseAudit> = {},
): LighthouseAudit {
  return { score, title: "An audit", description: "What it means", ...extra };
}

function report(audits: Record<string, LighthouseAudit> = {}): LighthouseReport {
  return {
    audits: {
      [AUDIT_IDS.lcp]: audit(1, { numericValue: 2400, displayValue: "2.4 s" }),
      [AUDIT_IDS.cls]: audit(1, { numericValue: 0.02 }),
      // 0.6 sits in the warn band; below 0.5 would be a failure.
      [AUDIT_IDS.tbt]: audit(0.6, { numericValue: 480, displayValue: "480 ms" }),
      [AUDIT_IDS.totalByteWeight]: audit(0.8, { numericValue: 1_200_000 }),
      [AUDIT_IDS.networkRequests]: { details: { items: [{ url: "a" }, { url: "b" }] } },
      ...audits,
    },
    lighthouseVersion: "13.4.1",
    finalDisplayedUrl: "https://example.com/",
  };
}

function byId(findings: readonly Finding[], id: string): Finding | undefined {
  return findings.find((finding) => finding.id === id);
}

describe("statusForScore", () => {
  it.each([
    [1, "pass"],
    [0.95, "pass"],
    [0.9, "pass"],
    [0.7, "warn"],
    [0.5, "warn"],
    [0.4, "fail"],
    [0, "fail"],
  ] as const)("maps %s to %s", (score, expected) => {
    expect(statusForScore(score)).toBe(expected);
  });

  it.each([null, undefined])(
    "treats an unscored audit as undecided rather than a pass",
    (score) => {
      // The engine declined to judge it; inventing a verdict would be worse
      // than saying so.
      expect(statusForScore(score)).toBe("could_not_determine");
    },
  );
});

describe("a successful audit", () => {
  const analysis = analyzePerformance({
    audit: { ok: true, report: report(), elapsedMs: 4000 },
  });

  it("returns measurements and findings as separate things", () => {
    expect(analysis.measurements).toBeDefined();
    expect(analysis.findings.length).toBeGreaterThan(0);
  });

  it("keeps raw measurements out of the findings and vice versa", () => {
    // ADR-012: the evidence and the observations drawn from it stay apart.
    expect(analysis.measurements.lcpMs).toBe(2400);
    expect(analysis).not.toHaveProperty("score");
  });

  it("produces no score anywhere", () => {
    for (const finding of analysis.findings) {
      expect(finding).not.toHaveProperty("score");
    }
    expect(JSON.stringify(analysis.measurements)).not.toContain('"score"');
  });

  it("turns a passing audit into a pass finding", () => {
    expect(
      byId(analysis.findings, `performance.lighthouse.${AUDIT_IDS.lcp}`)?.status,
    ).toBe("pass");
  });

  it("turns a low-scoring audit into a warning with a fixed severity", () => {
    const finding = byId(analysis.findings, `performance.lighthouse.${AUDIT_IDS.tbt}`);

    expect(finding?.status).toBe("warn");
    expect(finding?.severity).toBe("serious");
  });

  it("carries the engine's displayed value as evidence", () => {
    const finding = byId(analysis.findings, `performance.lighthouse.${AUDIT_IDS.tbt}`);

    expect(finding?.evidence[0]?.summary).toContain("480 ms");
    expect(finding?.evidence[0]?.detail).toContain("480");
  });

  it("skips audits the engine did not run rather than passing them", () => {
    // An audit that never executed has established nothing.
    expect(
      byId(analysis.findings, `performance.lighthouse.${AUDIT_IDS.cache}`),
    ).toBeUndefined();
  });

  it("reports page weight with its breakdown", () => {
    const finding = byId(analysis.findings, "performance.page_weight.measured");

    expect(finding?.status).toBe("pass");
    expect(finding?.evidence[0]?.summary).toContain("KiB");
    expect(finding?.evidence[1]?.summary).toContain("2 request");
  });

  it("always reports that INP was not measured", () => {
    const finding = byId(analysis.findings, "performance.inp.not_measurable");

    expect(finding?.status).toBe("could_not_determine");
    expect(finding?.explanation).toContain("real user interactions");
    // The lab proxy is offered in the same finding.
    expect(finding?.evidence.map((item) => item.summary).join(" ")).toContain(
      "Total Blocking Time",
    );
  });

  it("gives every finding evidence, an explanation and a recommendation", () => {
    for (const finding of analysis.findings) {
      expect(finding.category).toBe("performance");
      expect(finding.evidence.length, `${finding.id} has no evidence`).toBeGreaterThan(0);
      expect(finding.explanation.length).toBeGreaterThan(0);
      expect(
        (finding.recommendation ?? "").length,
        `${finding.id} has no recommendation`,
      ).toBeGreaterThan(0);
    }
  });

  it("uses unique finding ids", () => {
    const ids = analysis.findings.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic", () => {
    const first = analyzePerformance({
      audit: { ok: true, report: report(), elapsedMs: 1 },
    });
    const second = analyzePerformance({
      audit: { ok: true, report: report(), elapsedMs: 1 },
    });

    expect(first).toEqual(second);
  });

  it("reports an unscored audit as undecided", () => {
    const analysis = analyzePerformance({
      audit: {
        ok: true,
        report: report({ [AUDIT_IDS.mainThread]: audit(null, { numericValue: 2000 }) }),
        elapsedMs: 1,
      },
    });

    expect(
      byId(analysis.findings, `performance.lighthouse.${AUDIT_IDS.mainThread}`)?.status,
    ).toBe("could_not_determine");
  });
});

describe("failure handling", () => {
  it("returns empty measurements, not zeroed ones", () => {
    // A page whose weight was never measured must not look like a page that
    // weighs nothing.
    const analysis = analyzePerformance({
      audit: { ok: false, failure: { code: "timeout", message: "too slow" } },
    });

    expect(analysis.measurements.totalByteWeight).toBeNull();
    expect(analysis.measurements.lcpMs).toBeNull();
  });

  it.each(PERFORMANCE_FAILURE_CODES)(
    "turns a %s failure into one could_not_determine finding",
    (code) => {
      const analysis = analyzePerformance({
        audit: { ok: false, failure: { code, message: "went wrong" } },
      });

      expect(analysis.findings).toHaveLength(1);
      expect(analysis.findings[0]?.status).toBe("could_not_determine");
      expect(analysis.findings[0]?.id).toBe(`performance.audit.${code}`);
      expect(analysis.findings[0]?.category).toBe("performance");
    },
  );

  it("never reports a pass when the audit did not run", () => {
    for (const code of PERFORMANCE_FAILURE_CODES) {
      const analysis = analyzePerformance({
        audit: { ok: false, failure: { code, message: "x" } },
      });

      expect(analysis.findings.every((finding) => finding.status !== "pass")).toBe(true);
    }
  });

  it("reports could_not_determine when no audit was supplied", () => {
    const analysis = analyzePerformance();

    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0]?.status).toBe("could_not_determine");
  });

  it("explains each failure in its own terms", () => {
    const explanations = PERFORMANCE_FAILURE_CODES.map(
      (code) =>
        analyzePerformance({ audit: { ok: false, failure: { code, message: "x" } } })
          .findings[0]?.explanation ?? "",
    );

    expect(explanations.every((text) => text.length > 0)).toBe(true);
    expect(new Set(explanations).size).toBeGreaterThan(1);
  });

  it("handles an unrecognised failure code", () => {
    const analysis = analyzePerformance({
      audit: {
        ok: false,
        failure: { code: "something_new" as PerformanceFailureCode, message: "x" },
      },
    });

    expect(analysis.findings[0]?.explanation.length).toBeGreaterThan(0);
  });

  it("reports an audit that produced nothing measurable", () => {
    const analysis = analyzePerformance({
      audit: { ok: true, report: { audits: {} }, elapsedMs: 1 },
    });

    expect(byId(analysis.findings, "performance.page_weight.measured")?.status).toBe(
      "could_not_determine",
    );
  });
});

describe("runLighthouse failure paths that need no browser", () => {
  it("refuses a malformed URL", async () => {
    const result = await runLighthouse("not a url");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("invalid_url");
  });

  it.each([
    ["a private address", "http://192.168.1.1/"],
    ["the metadata endpoint", "http://169.254.169.254/"],
    ["localhost", "http://localhost/"],
  ])("refuses %s", async (_label, url) => {
    const result = await runLighthouse(url);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("blocked");
  });

  it("never launches a browser for a URL it will refuse", async () => {
    const launcher = vi.fn();

    await runLighthouse("http://localhost/", { launcher });

    expect(launcher).not.toHaveBeenCalled();
  });

  it("reports a missing browser binary", async () => {
    const result = await runLighthouse("https://example.com/", {
      launcher: async () => {
        throw new Error("Executable doesn't exist");
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("browser_unavailable");
  });
});

describe("runLighthouse orchestration, with the engine stubbed", () => {
  function fakeBrowser() {
    return {
      version: () => "0.0.0-fake",
      close: vi.fn(async () => undefined),
    } as never;
  }

  it("passes the validated URL and a real port to the engine", async () => {
    const runner = vi.fn<LighthouseRunner>(async () => report());

    const result = await runLighthouse("https://example.com", {
      launcher: async () => fakeBrowser(),
      runner,
    });

    expect(result.ok).toBe(true);
    // Normalized by Phase 1 before it reaches the engine.
    expect(runner.mock.calls[0]?.[0]).toBe("https://example.com/");
    expect(typeof runner.mock.calls[0]?.[1]).toBe("number");
    expect(runner.mock.calls[0]?.[1]).toBeGreaterThan(0);
  });

  it("opens a debugging port for the engine", async () => {
    let launchArgs: readonly string[] = [];

    await runLighthouse("https://example.com/", {
      launcher: async (options) => {
        launchArgs = options.args ?? [];
        return fakeBrowser();
      },
      runner: async () => report(),
    });

    expect(launchArgs.some((arg) => arg.startsWith("--remote-debugging-port="))).toBe(
      true,
    );
    // The hardening flags survive; extraArgs are appended, not substituted.
    expect(launchArgs).toContain("--disable-dev-shm-usage");
    expect(launchArgs).not.toContain("--no-sandbox");
  });

  it("closes the browser when the engine succeeds", async () => {
    const close = vi.fn(async () => undefined);

    await runLighthouse("https://example.com/", {
      launcher: async () => ({ version: () => "x", close }) as never,
      runner: async () => report(),
    });

    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the browser when the engine throws", async () => {
    const close = vi.fn(async () => undefined);

    const result = await runLighthouse("https://example.com/", {
      launcher: async () => ({ version: () => "x", close }) as never,
      runner: async () => {
        throw new Error("engine exploded");
      },
    });

    expect(close).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("audit_failed");
  });

  it("reports a runtime error from the engine as audit_error", async () => {
    // The engine ran but says it could not measure the page — a different
    // event from the engine failing.
    const result = await runLighthouse("https://example.com/", {
      launcher: async () => fakeBrowser(),
      runner: async () => ({
        audits: {},
        runtimeError: { code: "NO_FCP", message: "The page did not paint" },
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("audit_error");
      expect(result.failure.message).toContain("did not paint");
    }
  });

  it("reports a null report rather than crashing", async () => {
    const result = await runLighthouse("https://example.com/", {
      launcher: async () => fakeBrowser(),
      runner: async () => null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("audit_failed");
  });

  it("times out an engine that never returns", async () => {
    const result = await runLighthouse("https://example.com/", {
      launcher: async () => fakeBrowser(),
      auditTimeoutMs: 100,
      runner: () => new Promise(() => undefined),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("timeout");
  });

  it("feeds a failure straight into the analyzer", async () => {
    const result = await runLighthouse("http://192.168.1.1/");
    const analysis = analyzePerformance({ audit: result });

    expect(analysis.findings[0]?.id).toBe("performance.audit.blocked");
    expect(analysis.measurements.lcpMs).toBeNull();
  });
});
