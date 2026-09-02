import { describe, expect, it, vi } from "vitest";

import { analyzeAccessibility } from "./analyze-accessibility";
import { runAxe } from "./run-axe";
import {
  ACCESSIBILITY_FAILURE_CODES,
  type AccessibilityFailureCode,
  type AxeAuditResults,
  type AxeRule,
} from "./types";

function rule(overrides: Partial<AxeRule> = {}): AxeRule {
  return {
    id: "image-alt",
    impact: "critical",
    tags: ["wcag2a"],
    description: "Images must have alternative text",
    help: "Images must have alternate text",
    helpUrl: "https://example.test/rules/image-alt",
    nodes: [{ html: "<img>", target: ["img"] }],
    ...overrides,
  };
}

function results(overrides: Partial<AxeAuditResults> = {}): AxeAuditResults {
  return { violations: [], incomplete: [], passes: [], ...overrides };
}

describe("a successful audit", () => {
  it("returns the normalized findings", () => {
    const findings = analyzeAccessibility({
      audit: { ok: true, results: results({ violations: [rule()] }), elapsedMs: 10 },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("accessibility.axe.image-alt");
    expect(findings[0]?.status).toBe("fail");
  });

  it("reports an audit that evaluated nothing rather than staying silent", () => {
    const findings = analyzeAccessibility({
      audit: { ok: true, results: results(), elapsedMs: 5 },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("accessibility.axe.no_results");
    expect(findings[0]?.status).toBe("could_not_determine");
  });
});

describe("failure handling", () => {
  it("reports could_not_determine when no audit was supplied", () => {
    // Dropping the section would let a reader assume accessibility was fine.
    const findings = analyzeAccessibility();

    expect(findings).toHaveLength(1);
    expect(findings[0]?.status).toBe("could_not_determine");
  });

  it.each(ACCESSIBILITY_FAILURE_CODES)(
    "turns a %s failure into a could_not_determine finding",
    (code) => {
      const findings = analyzeAccessibility({
        audit: { ok: false, failure: { code, message: "something went wrong" } },
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]?.status).toBe("could_not_determine");
      expect(findings[0]?.category).toBe("accessibility");
      expect(findings[0]?.id).toBe(`accessibility.audit.${code}`);
    },
  );

  it("never reports a pass when the audit did not run", () => {
    for (const code of ACCESSIBILITY_FAILURE_CODES) {
      const findings = analyzeAccessibility({
        audit: { ok: false, failure: { code, message: "x" } },
      });

      expect(findings.every((finding) => finding.status !== "pass")).toBe(true);
    }
  });

  it("explains each failure in its own terms", () => {
    const explanations = ACCESSIBILITY_FAILURE_CODES.map(
      (code) =>
        analyzeAccessibility({
          audit: { ok: false, failure: { code, message: "x" } },
        })[0]?.explanation ?? "",
    );

    expect(explanations.every((text) => text.length > 0)).toBe(true);
    // A blocked URL and a crashed browser are different events and read
    // differently.
    expect(new Set(explanations).size).toBeGreaterThan(1);
  });

  it("carries the underlying message as evidence", () => {
    const findings = analyzeAccessibility({
      audit: {
        ok: false,
        failure: { code: "engine_injection_failed", message: "CSP blocked the script" },
      },
    });

    expect(findings[0]?.evidence[0]?.detail).toBe("CSP blocked the script");
  });

  it("mentions a strict CSP for an injection failure, which is the usual cause", () => {
    const findings = analyzeAccessibility({
      audit: { ok: false, failure: { code: "engine_injection_failed", message: "x" } },
    });

    expect(findings[0]?.explanation).toContain("Content-Security-Policy");
  });

  it("gives every failure finding a recommendation", () => {
    for (const code of ACCESSIBILITY_FAILURE_CODES) {
      const finding = analyzeAccessibility({
        audit: { ok: false, failure: { code, message: "x" } },
      })[0];

      expect((finding?.recommendation ?? "").length).toBeGreaterThan(0);
      expect(finding?.evidence.length).toBeGreaterThan(0);
    }
  });

  it("handles an unrecognised failure code without losing the section", () => {
    const findings = analyzeAccessibility({
      audit: {
        ok: false,
        failure: { code: "something_new" as AccessibilityFailureCode, message: "x" },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.explanation.length).toBeGreaterThan(0);
  });
});

describe("runAxe failure paths that need no browser", () => {
  it("refuses a malformed URL", async () => {
    const audit = await runAxe("not a url");

    expect(audit.ok).toBe(false);
    if (!audit.ok) expect(audit.failure.code).toBe("invalid_url");
  });

  it("refuses a private address under the production policy", async () => {
    const audit = await runAxe("http://192.168.1.1/");

    expect(audit.ok).toBe(false);
    if (!audit.ok) expect(audit.failure.code).toBe("blocked");
  });

  it("refuses the metadata endpoint", async () => {
    const audit = await runAxe("http://169.254.169.254/");

    expect(audit.ok).toBe(false);
    if (!audit.ok) expect(audit.failure.code).toBe("blocked");
  });

  it("never launches a browser for a URL it will refuse", async () => {
    const launcher = vi.fn();

    await runAxe("http://localhost/", { launcher });

    expect(launcher).not.toHaveBeenCalled();
  });

  it("reports a missing browser binary", async () => {
    const audit = await runAxe("https://example.com/", {
      launcher: async () => {
        throw new Error("Executable doesn't exist at /nowhere/chrome");
      },
    });

    expect(audit.ok).toBe(false);
    if (!audit.ok) {
      expect(audit.failure.code).toBe("browser_unavailable");
      expect(audit.failure.message).toMatch(/playwright install/);
    }
  });

  it("feeds a runAxe failure straight into the analyzer", async () => {
    const audit = await runAxe("http://192.168.1.1/");
    const findings = analyzeAccessibility({ audit });

    expect(findings[0]?.status).toBe("could_not_determine");
    expect(findings[0]?.id).toBe("accessibility.audit.blocked");
  });
});
