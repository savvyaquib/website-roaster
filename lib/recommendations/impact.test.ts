import { describe, expect, it } from "vitest";

import { CATEGORY_WEIGHTS, deductionFor, scoreAnalysis } from "@/lib/scoring";
import type { AnalysisCategory, Finding, FindingSeverity } from "@/lib/types/finding";
import { ANALYSIS_CATEGORIES, FINDING_SEVERITIES } from "@/lib/types/finding";

import { impactFor, weightBasisFor } from "./impact";

let counter = 0;

function finding(
  category: AnalysisCategory,
  severity: FindingSeverity,
  status: Finding["status"] = "fail",
): Finding {
  counter += 1;
  return {
    id: `${category}.check.${counter}`,
    category,
    severity,
    status,
    evidence: [{ kind: "measured", source: "dom", summary: "Observed." }],
    explanation: "An explanation.",
    recommendation: "A recommendation.",
  };
}

describe("recoverable points", () => {
  it("multiplies the deduction by the declared weight when there is no score", () => {
    // A critical SEO failure costs 25 category points; SEO is declared at 15%.
    const impact = impactFor(finding("seo", "critical"), undefined);

    expect(impact.categoryDeduction).toBe(25);
    expect(impact.categoryWeight).toBe(15);
    expect(impact.points).toBe(3.75);
    expect(impact.weightBasis).toBe("declared");
  });

  it("uses the effective weight when a score report is supplied", () => {
    // Only SEO and security were assessed, so SEO carries 15/20 of the score.
    const findings = [finding("seo", "critical"), finding("security", "serious")];
    const score = scoreAnalysis({ findings });

    const impact = impactFor(findings[0]!, score);

    expect(impact.weightBasis).toBe("effective");
    expect(impact.categoryWeight).toBe(75);
    expect(impact.points).toBe(18.75);
  });

  it("is worth more when other categories could not be measured", () => {
    // The same finding, priced twice. Redistribution is not cosmetic.
    const seo = finding("seo", "serious");
    const withoutScore = impactFor(seo, undefined);
    const withScore = impactFor(seo, scoreAnalysis({ findings: [seo] }));

    expect(withoutScore.points).toBe(2.25);
    expect(withScore.points).toBe(15);
  });

  it("prices a finding in a category the score excluded at zero", () => {
    // Accessibility established nothing, so it carries no weight and nothing
    // there moves the overall score.
    const undetermined = finding("accessibility", "critical", "could_not_determine");
    const score = scoreAnalysis({
      findings: [undetermined, finding("seo", "moderate")],
    });

    const impact = impactFor(undetermined, score);

    expect(impact.categoryWeight).toBe(0);
    expect(impact.points).toBe(0);
  });

  it.each(ANALYSIS_CATEGORIES.filter((category) => category !== "performance"))(
    "prices every %s severity against the deduction table",
    (category) => {
      for (const severity of FINDING_SEVERITIES) {
        const impact = impactFor(finding(category, severity), undefined);
        const expected =
          (deductionFor(severity, "fail") * CATEGORY_WEIGHTS[category]) / 100;

        expect(impact.points).toBeCloseTo(expected, 2);
      }
    },
  );

  it("gives a passing finding no recoverable points", () => {
    expect(impactFor(finding("seo", "critical", "pass"), undefined).points).toBe(0);
  });
});

describe("performance cannot be priced from a finding", () => {
  const impact = impactFor(finding("performance", "critical"), undefined);

  it("returns null points rather than zero", () => {
    // docs/SCORING.md rule 4: metric findings are scored by curves, not by the
    // deduction table. Zero would claim a fix is worth nothing.
    expect(impact.points).toBeNull();
    expect(impact.categoryWeight).toBeNull();
    expect(impact.weightBasis).toBe("not_applicable");
  });

  it("still rates how bad it is", () => {
    expect(impact.level).toBe("high");
  });

  it("says why in words", () => {
    expect(impact.explanation).toContain("metric curves");
    expect(impact.explanation).toContain("not zero");
  });

  it("stays unpriced even when a score report is supplied", () => {
    const withScore = impactFor(
      finding("performance", "serious"),
      scoreAnalysis({ findings: [finding("seo", "minor")] }),
    );

    expect(withScore.points).toBeNull();
  });
});

describe("impact explanations", () => {
  it("states the arithmetic that produced the number", () => {
    const impact = impactFor(finding("mobile", "serious"), undefined);

    expect(impact.explanation).toContain("15 point(s)");
    expect(impact.explanation).toContain("10%");
    expect(impact.explanation).toContain("1.5 point(s)");
  });

  it("names which weight was used", () => {
    expect(impactFor(finding("ux", "minor"), undefined).explanation).toContain(
      "declared",
    );
    expect(
      impactFor(
        finding("ux", "minor"),
        scoreAnalysis({ findings: [finding("ux", "minor")] }),
      ).explanation,
    ).toContain("effective");
  });
});

describe("weightBasisFor", () => {
  it("reports which weights a report was priced against", () => {
    expect(weightBasisFor(undefined)).toBe("declared");
    expect(weightBasisFor(scoreAnalysis({ findings: [] }))).toBe("effective");
  });
});
