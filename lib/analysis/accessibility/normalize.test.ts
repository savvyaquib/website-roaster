import { describe, expect, it } from "vitest";

import type { Finding } from "@/lib/types/finding";

import {
  findingIdForRule,
  MAX_REPORTED_NODES,
  normalizeAxeResults,
  severityForImpact,
} from "./normalize";
import type { AxeAuditResults, AxeNode, AxeRule } from "./types";

function node(overrides: Partial<AxeNode> = {}): AxeNode {
  return {
    html: '<img src="a.png">',
    target: ["main > img"],
    failureSummary: "Fix any of the following: Element has no alt attribute",
    ...overrides,
  };
}

function rule(overrides: Partial<AxeRule> = {}): AxeRule {
  return {
    id: "image-alt",
    impact: "critical",
    tags: ["cat.text-alternatives", "wcag2a", "wcag111"],
    description: "Images must have alternative text",
    help: "Images must have alternate text",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
    nodes: [node()],
    ...overrides,
  };
}

function results(overrides: Partial<AxeAuditResults> = {}): AxeAuditResults {
  return { violations: [], incomplete: [], passes: [], ...overrides };
}

function byId(findings: readonly Finding[], id: string): Finding | undefined {
  return findings.find((finding) => finding.id === id);
}

describe("severityForImpact", () => {
  it.each([
    ["critical", "critical"],
    ["serious", "serious"],
    ["moderate", "moderate"],
    ["minor", "minor"],
  ] as const)("maps %s directly", (impact, expected) => {
    // The severity vocabularies match by design, so no lossy table is needed.
    expect(severityForImpact(impact)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(severityForImpact("CRITICAL")).toBe("critical");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an unrecognised value", "catastrophic"],
  ])("falls back to moderate for %s rather than discarding it", (_label, impact) => {
    // Guessing low would quietly demote a real problem the engine found.
    expect(severityForImpact(impact)).toBe("moderate");
  });
});

describe("finding identifiers", () => {
  it("preserves the engine rule id", () => {
    expect(findingIdForRule("color-contrast")).toBe("accessibility.axe.color-contrast");
  });

  it("keeps the rule id recoverable from a violation finding", () => {
    // Phase 7's acceptance criterion: findings trace back to audit evidence.
    const findings = normalizeAxeResults(
      results({ violations: [rule({ id: "label" })] }),
    );

    expect(findings[0]?.id).toBe("accessibility.axe.label");
  });

  it("distinguishes an undecided result from a violation of the same rule", () => {
    const findings = normalizeAxeResults(
      results({
        violations: [rule({ id: "label" })],
        incomplete: [rule({ id: "label" })],
      }),
    );

    expect(findings.map((finding) => finding.id)).toEqual([
      "accessibility.axe.label",
      "accessibility.axe.label.incomplete",
    ]);
  });
});

describe("violations", () => {
  const findings = normalizeAxeResults(results({ violations: [rule()] }));
  const finding = findings[0];

  it("becomes a failing accessibility finding", () => {
    expect(finding?.category).toBe("accessibility");
    expect(finding?.status).toBe("fail");
    expect(finding?.severity).toBe("critical");
  });

  it("uses the engine's description as the explanation", () => {
    expect(finding?.explanation).toBe("Images must have alternative text");
  });

  it("builds the recommendation from the engine's failure summary", () => {
    expect(finding?.recommendation).toContain("Element has no alt attribute");
  });

  it("links to the engine's documentation", () => {
    expect(finding?.recommendation).toContain(
      "https://dequeuniversity.com/rules/axe/4.13/image-alt",
    );
  });

  it("falls back to the help text when there is no failure summary", () => {
    const withoutSummary = normalizeAxeResults(
      results({ violations: [rule({ nodes: [node({ failureSummary: undefined })] })] }),
    );

    expect(withoutSummary[0]?.recommendation).toContain(
      "Images must have alternate text",
    );
  });

  it("reports the affected element count and its selector", () => {
    const summaries = finding?.evidence.map((item) => item.summary) ?? [];

    expect(summaries[0]).toContain("matched 1 element");
    expect(summaries[1]).toContain("main > img");
  });

  it("includes the element's HTML as evidence", () => {
    expect(finding?.evidence[1]?.detail).toContain("<img");
  });

  it("records the WCAG tags", () => {
    expect(finding?.evidence[0]?.detail).toContain("wcag2a");
  });

  it("marks evidence as measured and sourced from the audit engine", () => {
    expect(finding?.evidence.every((item) => item.kind === "measured")).toBe(true);
    expect(finding?.evidence.every((item) => item.source === "axe")).toBe(true);
  });
});

describe("many affected elements", () => {
  const manyNodes = Array.from({ length: 40 }, (_unused, index) =>
    node({ target: [`#element-${index}`] }),
  );
  const finding = normalizeAxeResults(
    results({ violations: [rule({ nodes: manyNodes })] }),
  )[0];

  it("reports the full count", () => {
    // The cap must never hide how big the problem is.
    expect(finding?.evidence[0]?.summary).toContain("40 element(s)");
  });

  it("lists only a bounded number of elements", () => {
    const elementEvidence =
      finding?.evidence.filter((item) => item.summary.startsWith("Affected element")) ??
      [];

    expect(elementEvidence).toHaveLength(MAX_REPORTED_NODES);
  });

  it("truncates a long HTML snippet", () => {
    const huge = normalizeAxeResults(
      results({ violations: [rule({ nodes: [node({ html: "<div>".repeat(500) })] })] }),
    )[0];

    expect((huge?.evidence[1]?.detail ?? "").length).toBeLessThan(200);
  });
});

describe("incomplete results", () => {
  const finding = normalizeAxeResults(results({ incomplete: [rule()] }))[0];

  it("becomes could_not_determine, never a pass", () => {
    // Automation genuinely cannot settle some checks. Reporting those as passes
    // would be the most misleading thing this phase could do (ADR-021).
    expect(finding?.status).toBe("could_not_determine");
  });

  it("says a human needs to look", () => {
    expect(finding?.explanation).toContain("needs a human");
    expect(finding?.recommendation).toContain("by hand");
  });

  it("keeps the severity the engine assigned", () => {
    expect(finding?.severity).toBe("critical");
  });

  it("keeps the affected elements", () => {
    expect(finding?.evidence.some((item) => item.summary.includes("main > img"))).toBe(
      true,
    );
  });
});

describe("passes", () => {
  const passes = [rule({ id: "b-rule" }), rule({ id: "a-rule" }), rule({ id: "c-rule" })];
  const finding = byId(
    normalizeAxeResults(results({ passes })),
    "accessibility.axe.passes",
  );

  it("collapses into a single finding rather than one per rule", () => {
    // A typical page passes forty or more rules; one finding each would bury
    // the failures.
    expect(finding).toBeDefined();
    expect(normalizeAxeResults(results({ passes }))).toHaveLength(1);
  });

  it("reports how many passed and which", () => {
    expect(finding?.evidence[0]?.summary).toContain("3 automated accessibility check");
    expect(finding?.evidence[0]?.detail).toBe("a-rule, b-rule, c-rule");
  });

  it("does not claim the page is accessible", () => {
    expect(finding?.explanation).toContain("not a statement that the page is accessible");
  });

  it("is omitted when nothing passed", () => {
    expect(
      byId(
        normalizeAxeResults(results({ violations: [rule()] })),
        "accessibility.axe.passes",
      ),
    ).toBeUndefined();
  });
});

describe("ordering", () => {
  it("puts the most severe violations first", () => {
    const findings = normalizeAxeResults(
      results({
        violations: [
          rule({ id: "minor-rule", impact: "minor" }),
          rule({ id: "critical-rule", impact: "critical" }),
          rule({ id: "moderate-rule", impact: "moderate" }),
          rule({ id: "serious-rule", impact: "serious" }),
        ],
      }),
    );

    expect(findings.map((finding) => finding.severity)).toEqual([
      "critical",
      "serious",
      "moderate",
      "minor",
    ]);
  });

  it("orders equally severe rules by identifier, so runs are comparable", () => {
    const findings = normalizeAxeResults(
      results({
        violations: [
          rule({ id: "zebra", impact: "serious" }),
          rule({ id: "alpha", impact: "serious" }),
        ],
      }),
    );

    expect(findings.map((finding) => finding.id)).toEqual([
      "accessibility.axe.alpha",
      "accessibility.axe.zebra",
    ]);
  });

  it("puts violations, then undecided checks, then the pass summary", () => {
    const findings = normalizeAxeResults(
      results({
        violations: [rule({ id: "v" })],
        incomplete: [rule({ id: "i" })],
        passes: [rule({ id: "p" })],
      }),
    );

    expect(findings.map((finding) => finding.status)).toEqual([
      "fail",
      "could_not_determine",
      "pass",
    ]);
  });

  it("is deterministic", () => {
    const audit = results({
      violations: [rule({ id: "b" }), rule({ id: "a" })],
      incomplete: [rule({ id: "d" })],
      passes: [rule({ id: "e" })],
    });

    expect(normalizeAxeResults(audit)).toEqual(normalizeAxeResults(audit));
  });
});

describe("unusual engine output", () => {
  it("handles an empty audit", () => {
    expect(normalizeAxeResults(results())).toEqual([]);
  });

  it("handles a rule with no affected elements", () => {
    const findings = normalizeAxeResults(results({ violations: [rule({ nodes: [] })] }));

    expect(findings[0]?.evidence[0]?.summary).toContain("0 element(s)");
    expect(findings[0]?.recommendation).toContain("Images must have alternate text");
  });

  it("handles an element with no selector", () => {
    const findings = normalizeAxeResults(
      results({ violations: [rule({ nodes: [node({ target: [] })] })] }),
    );

    expect(findings[0]?.evidence[1]?.summary).toContain("no selector reported");
  });

  it("handles a rule with no tags", () => {
    const findings = normalizeAxeResults(results({ violations: [rule({ tags: [] })] }));

    expect(findings[0]?.evidence[0]?.detail).toContain("dequeuniversity");
  });

  it("joins nested iframe selectors", () => {
    const findings = normalizeAxeResults(
      results({
        violations: [rule({ nodes: [node({ target: ["#frame", "button"] })] })],
      }),
    );

    expect(findings[0]?.evidence[1]?.summary).toContain("#frame, button");
  });
});

describe("the finding contract", () => {
  const findings = normalizeAxeResults(
    results({
      violations: [rule({ id: "a" }), rule({ id: "b", impact: "minor" })],
      incomplete: [rule({ id: "c" })],
      passes: [rule({ id: "d" })],
    }),
  );

  it("gives every finding evidence, an explanation and a recommendation", () => {
    for (const finding of findings) {
      expect(finding.evidence.length, `${finding.id} has no evidence`).toBeGreaterThan(0);
      expect(finding.explanation.length).toBeGreaterThan(0);
      expect(
        (finding.recommendation ?? "").length,
        `${finding.id} has no recommendation`,
      ).toBeGreaterThan(0);
    }
  });

  it("emits only accessibility findings", () => {
    expect(findings.every((finding) => finding.category === "accessibility")).toBe(true);
  });

  it("uses unique ids", () => {
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(findings.length);
  });

  it("produces no score", () => {
    for (const finding of findings) {
      expect(finding).not.toHaveProperty("score");
    }
  });
});
