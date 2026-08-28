import { describe, expect, it } from "vitest";

import {
  ANALYSIS_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  isAnalysisCategory,
  type Finding,
} from "./finding";

describe("analysis categories", () => {
  it("matches the seven categories in docs/SCORING.md", () => {
    expect([...ANALYSIS_CATEGORIES]).toEqual([
      "performance",
      "seo",
      "accessibility",
      "mobile",
      "security",
      "content",
      "ux",
    ]);
  });

  it.each(ANALYSIS_CATEGORIES)("accepts %s", (category) => {
    expect(isAnalysisCategory(category)).toBe(true);
  });

  it.each([
    ["an unknown category", "branding"],
    ["a differently cased category", "SEO"],
    ["a non-string", 1],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(isAnalysisCategory(value)).toBe(false);
  });
});

describe("finding vocabulary", () => {
  it("keeps the four accessibility severities so axe results need no remapping", () => {
    for (const severity of ["critical", "serious", "moderate", "minor"] as const) {
      expect(FINDING_SEVERITIES).toContain(severity);
    }
  });

  it("carries a could_not_determine status distinct from pass (ADR-021)", () => {
    expect(FINDING_STATUSES).toContain("could_not_determine");
    expect(FINDING_STATUSES).toContain("pass");
  });
});

describe("Finding shape", () => {
  it("describes a failure with traceable evidence", () => {
    const finding: Finding = {
      id: "seo.title.missing",
      category: "seo",
      severity: "serious",
      status: "fail",
      evidence: [
        {
          kind: "measured",
          source: "dom",
          summary: "No <title> element was present in the document head.",
        },
      ],
      explanation:
        "Search engines and browser tabs use the title element to identify the page.",
      recommendation: "Add a descriptive <title> element of roughly 50-60 characters.",
    };

    expect(finding.evidence).toHaveLength(1);
    expect(finding.evidence[0]?.kind).toBe("measured");
  });

  it("allows a finding with no recommendation when nothing needs doing", () => {
    const finding: Finding = {
      id: "security.https.enabled",
      category: "security",
      severity: "info",
      status: "pass",
      evidence: [
        {
          kind: "measured",
          source: "http",
          summary: "The final URL was served over HTTPS.",
          detail: "https://example.com/",
        },
      ],
      explanation: "The page was served over an encrypted connection.",
    };

    expect(finding.recommendation).toBeUndefined();
  });

  it("marks inferred signals as heuristic (ADR-009)", () => {
    const finding: Finding = {
      id: "ux.cta.ambiguous",
      category: "ux",
      severity: "minor",
      status: "warn",
      evidence: [
        {
          kind: "heuristic",
          source: "derived",
          summary: "Four elements matched primary call-to-action patterns.",
        },
      ],
      explanation: "Competing primary actions can make the intended next step unclear.",
      recommendation: "Consider promoting a single primary action above the fold.",
    };

    expect(finding.evidence[0]?.kind).toBe("heuristic");
  });
});
