import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { analyzeContent, extractContent } from "@/lib/analysis/content";
import { analyzeUx, collectUxSignals } from "@/lib/analysis/ux";
import { scoreAnalysis } from "@/lib/scoring";
import type {
  AnalysisCategory,
  Finding,
  FindingSeverity,
  FindingStatus,
} from "@/lib/types/finding";

import {
  buildRecommendations,
  recommendationsAtLeast,
  topRecommendations,
} from "./build-recommendations";
import { MAX_TITLE_LENGTH } from "./title";

let counter = 0;

function finding(
  category: AnalysisCategory,
  severity: FindingSeverity,
  status: FindingStatus,
  id?: string,
): Finding {
  counter += 1;
  return {
    id: id ?? `${category}.check.${counter}`,
    category,
    severity,
    status,
    evidence: [
      {
        kind: "measured",
        source: "dom",
        summary: `A problem was observed in ${category}.`,
      },
    ],
    explanation: `Why the ${category} problem matters.`,
    recommendation: `Fix the ${category} problem.`,
  };
}

const mixedFindings: Finding[] = [
  finding("security", "critical", "fail", "security.https.absent"),
  finding("seo", "critical", "fail", "seo.title.missing"),
  finding("accessibility", "serious", "fail", "accessibility.axe.contrast"),
  finding("ux", "moderate", "warn", "ux.navigation.busy"),
  finding("mobile", "moderate", "fail", "mobile.overflow.horizontal"),
  finding("content", "minor", "warn", "content.footer.thin"),
  finding("seo", "info", "pass", "seo.canonical.ok"),
  finding("security", "moderate", "could_not_determine", "security.csp.unparsed"),
];

// ---------------------------------------------------------------------------
// What becomes a recommendation
// ---------------------------------------------------------------------------

describe("which findings become recommendations", () => {
  const report = buildRecommendations({ findings: mixedFindings });

  it("recommends every failing and warning finding", () => {
    const ids = report.recommendations.map((item) => item.findingId);

    expect(ids).toContain("security.https.absent");
    expect(ids).toContain("ux.navigation.busy");
    expect(ids).toContain("content.footer.thin");
  });

  it("never recommends a passing finding", () => {
    // Several analyzers attach advice to a pass. It belongs in a report, but it
    // is not a problem to prioritize.
    expect(report.recommendations.map((item) => item.findingId)).not.toContain(
      "seo.canonical.ok",
    );
    expect(report.summary.passingFindings).toBe(1);
  });

  it("recommends an undetermined check as a review, not a fix", () => {
    const review = report.recommendations.find(
      (item) => item.findingId === "security.csp.unparsed",
    );

    // Dropping these would hide exactly what ADR-021 exists to surface.
    expect(review?.kind).toBe("review");
    expect(report.summary.needsReview).toBe(1);
  });

  it("counts fixes and reviews separately", () => {
    expect(report.summary.fixes).toBe(6);
    expect(report.summary.needsReview).toBe(1);
    expect(report.summary.total).toBe(7);
  });

  it("returns an empty report for no findings", () => {
    const empty = buildRecommendations({ findings: [] });

    expect(empty.recommendations).toEqual([]);
    expect(empty.summary.total).toBe(0);
    expect(empty.summary.recoverablePoints).toBe(0);
  });

  it("returns an empty report when everything passed", () => {
    const clean = buildRecommendations({
      findings: [finding("seo", "info", "pass"), finding("ux", "info", "pass")],
    });

    expect(clean.recommendations).toEqual([]);
    expect(clean.summary.passingFindings).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Prioritization
// ---------------------------------------------------------------------------

describe("prioritization", () => {
  const report = buildRecommendations({ findings: mixedFindings });
  const order = report.recommendations.map((item) => item.findingId);

  it("puts the high-impact problems first", () => {
    expect(order.slice(0, 3)).toEqual([
      // Both critical failures lead; SEO at 15% outranks security at 5%.
      "seo.title.missing",
      "security.https.absent",
      "accessibility.axe.contrast",
    ]);
  });

  it("puts the undetermined check last", () => {
    expect(order[order.length - 1]).toBe("security.csp.unparsed");
  });

  it("never puts a lower impact level above a higher one", () => {
    const rank = { high: 0, medium: 1, low: 2, none: 3 };
    const levels = report.recommendations.map((item) => rank[item.impact.level]);

    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]!).toBeGreaterThanOrEqual(levels[index - 1]!);
    }
  });

  it("assigns consecutive ranks starting at 1", () => {
    expect(report.recommendations.map((item) => item.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("is deterministic across repeated runs", () => {
    expect(buildRecommendations({ findings: mixedFindings })).toEqual(report);
  });

  it("does not depend on the order the findings arrive in", () => {
    const reversed = buildRecommendations({ findings: [...mixedFindings].reverse() });

    expect(reversed.recommendations.map((item) => item.findingId)).toEqual(order);
  });

  it("ranks identically whether or not a score report is supplied, here", () => {
    // Every category is assessed in this fixture, so effective and declared
    // weights agree and the ordering must not move.
    const findings = [
      ...mixedFindings,
      finding("performance", "minor", "warn", "performance.render.blocking"),
    ];
    const score = scoreAnalysis({ findings });

    const withScore = buildRecommendations({ findings, score });
    const withoutScore = buildRecommendations({ findings });

    expect(withScore.recommendations.map((item) => item.findingId)).toEqual(
      withoutScore.recommendations.map((item) => item.findingId),
    );
  });

  it("reorders when redistribution changes what a fix is worth", () => {
    // Only mobile and security were assessed. Mobile's 10% becomes 66.67% and
    // security's 5% becomes 33.33%, so the mobile problem is worth more.
    const findings = [
      finding("security", "serious", "fail", "security.hsts.missing"),
      finding("mobile", "serious", "fail", "mobile.tap.small"),
    ];
    const score = scoreAnalysis({ findings });
    const report = buildRecommendations({ findings, score });

    expect(report.recommendations[0]?.findingId).toBe("mobile.tap.small");
    expect(report.recommendations[0]?.impact.points).toBe(10);
    expect(report.recommendations[1]?.impact.points).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// The required fields
// ---------------------------------------------------------------------------

describe("every recommendation carries what a reader needs", () => {
  const report = buildRecommendations({
    findings: mixedFindings,
    score: scoreAnalysis({ findings: mixedFindings }),
  });

  it("has a title, severity, impact, evidence, explanation and an action", () => {
    for (const recommendation of report.recommendations) {
      expect(recommendation.title.length).toBeGreaterThan(0);
      expect(recommendation.finding.severity).toBeTruthy();
      expect(recommendation.impact.level).toBeTruthy();
      expect(recommendation.finding.evidence.length).toBeGreaterThan(0);
      expect(recommendation.finding.explanation.length).toBeGreaterThan(0);
      expect(recommendation.finding.recommendation?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("reads severity, evidence and explanation from the finding rather than copying", () => {
    // ADR-029: a recommendation is a derived view. There is one copy of each of
    // these values in the system, so the two can never disagree.
    const recommendation = report.recommendations[0]!;

    expect(Object.keys(recommendation).sort()).toEqual([
      "finding",
      "findingId",
      "impact",
      "kind",
      "rank",
      "rankExplanation",
      "tier",
      "tierLabel",
      "title",
      "titleSource",
    ]);
  });

  it("joins back to the finding it came from", () => {
    for (const recommendation of report.recommendations) {
      expect(recommendation.findingId).toBe(recommendation.finding.id);
    }
  });

  it("says where its title came from", () => {
    for (const recommendation of report.recommendations) {
      expect(recommendation.titleSource).toBe("evidence");
      expect(recommendation.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    }
  });

  it("explains its own impact and its own position", () => {
    for (const recommendation of report.recommendations) {
      expect(recommendation.impact.explanation.length).toBeGreaterThan(0);
      expect(recommendation.rankExplanation).toContain(
        `Ranked ${recommendation.rank} of`,
      );
    }
  });

  it("labels its tier with the document's wording", () => {
    const labels = new Set(report.recommendations.map((item) => item.tierLabel));

    for (const label of labels) {
      expect([
        "Severe technical problems",
        "Major usability problems",
        "Conversion and discoverability",
        "Minor polish",
      ]).toContain(label);
    }
  });
});

// ---------------------------------------------------------------------------
// Traceability
// ---------------------------------------------------------------------------

describe("every recommendation traces back to evidence", () => {
  const score = scoreAnalysis({ findings: mixedFindings });
  const report = buildRecommendations({ findings: mixedFindings, score });

  it("reconstructs each impact from the deduction and weight it displays", () => {
    for (const recommendation of report.recommendations) {
      const { impact } = recommendation;
      if (impact.points === null) continue;

      const recomputed =
        Math.round(impact.categoryDeduction * (impact.categoryWeight ?? 0)) / 100;

      expect(recomputed, recommendation.findingId).toBeCloseTo(impact.points, 2);
    }
  });

  it("agrees with the score report about what each finding cost", () => {
    // The recommendation engine must not hold a second opinion about the
    // deduction a finding caused.
    for (const category of score.categories) {
      for (const deduction of category.deductions) {
        const recommendation = report.recommendations.find(
          (item) => item.findingId === deduction.findingId,
        );

        expect(recommendation?.impact.categoryDeduction).toBe(deduction.deduction);
      }
    }
  });

  it("sums recoverable points to the report total", () => {
    const summed = report.recommendations.reduce(
      (total, item) => total + (item.impact.points ?? 0),
      0,
    );

    expect(Math.round(summed * 100) / 100).toBe(report.summary.recoverablePoints);
  });

  it("counts the recommendations it could not price", () => {
    const findings = [...mixedFindings, finding("performance", "serious", "fail")];
    const withPerformance = buildRecommendations({ findings });

    expect(withPerformance.summary.unquantified).toBe(1);
  });

  it("records which weights the points were priced against", () => {
    expect(report.weightBasis).toBe("effective");
    expect(buildRecommendations({ findings: mixedFindings }).weightBasis).toBe(
      "declared",
    );
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe("the summary", () => {
  const report = buildRecommendations({ findings: mixedFindings });

  it("counts by impact level", () => {
    const summed = Object.values(report.summary.byLevel).reduce((a, b) => a + b, 0);

    expect(summed).toBe(report.summary.total);
    expect(report.summary.byLevel.high).toBe(3);
  });

  it("counts by tier", () => {
    const summed = Object.values(report.summary.byTier).reduce((a, b) => a + b, 0);

    expect(summed).toBe(report.summary.total);
  });

  it("counts by category", () => {
    expect(report.summary.byCategory.security).toBe(2);
    expect(report.summary.byCategory.seo).toBe(1);
    expect(report.summary.byCategory.performance).toBeUndefined();
  });
});

describe("selecting from a ranked list", () => {
  const report = buildRecommendations({ findings: mixedFindings });

  it("takes the top N from the front of the ranking", () => {
    expect(topRecommendations(report, 3).map((item) => item.findingId)).toEqual(
      report.recommendations.slice(0, 3).map((item) => item.findingId),
    );
  });

  it("handles a count beyond the end, and a negative one", () => {
    expect(topRecommendations(report, 500)).toHaveLength(report.summary.total);
    expect(topRecommendations(report, -1)).toHaveLength(0);
  });

  it("filters by impact level using the same banding as the ranking", () => {
    const high = recommendationsAtLeast(report, "high");

    expect(high).toHaveLength(report.summary.byLevel.high);
    for (const recommendation of high) {
      expect(recommendation.impact.level).toBe("high");
    }
  });

  it("includes everything at or above the requested level", () => {
    const medium = recommendationsAtLeast(report, "medium");

    expect(medium).toHaveLength(
      report.summary.byLevel.high + report.summary.byLevel.medium,
    );
  });
});

// ---------------------------------------------------------------------------
// Against real analyzer output
// ---------------------------------------------------------------------------

describe("over findings from the real analyzers", () => {
  const html = `
    <!doctype html>
    <html>
      <head><title>Ship faster</title></head>
      <body>
        <nav><a href="/a">A</a><a href="/b">B</a></nav>
        <main>
          <h1>Ship faster</h1>
          <p>We help teams ship.</p>
          <h4>Skipped a level</h4>
          <a href="/signup">Get started</a>
        </main>
      </body>
    </html>
  `;
  const url = "https://example.com/";

  const findings = [
    ...analyzeUx({ signals: collectUxSignals(html, url) }),
    ...analyzeContent({ inventory: extractContent(html, url) }),
  ];

  const report = buildRecommendations({ findings });

  it("produces findings to work from", () => {
    // Guards the fixture: an empty analyzer result would make the rest of this
    // block pass while proving nothing.
    expect(findings.length).toBeGreaterThan(0);
    expect(report.summary.total).toBeGreaterThan(0);
  });

  it("gives every one a usable title from its own evidence", () => {
    for (const recommendation of report.recommendations) {
      expect(recommendation.title.length).toBeGreaterThan(0);
      expect(recommendation.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(recommendation.title.endsWith(".")).toBe(false);
      expect(recommendation.title[0]).toBe(recommendation.title[0]?.toUpperCase());
    }
  });

  it("never invents a title from the identifier when evidence exists", () => {
    // Every analyzer emits evidence, so the last-resort branch should be dead
    // in practice. If this fails, a finding is missing the evidence the model
    // requires.
    for (const recommendation of report.recommendations) {
      expect(recommendation.titleSource).toBe("evidence");
    }
  });

  it("orders real findings by impact without ties left to input order", () => {
    const ranks = report.recommendations.map((item) => item.rank);

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("caps UX recommendations below high impact", () => {
    // ADR-051 caps UX severity below `serious`, so no counted heuristic can
    // reach the top band. That guarantee has to survive this layer.
    for (const recommendation of report.recommendations) {
      if (recommendation.finding.category !== "ux") continue;
      expect(recommendation.impact.level).not.toBe("high");
    }
  });
});

// ---------------------------------------------------------------------------
// Engine properties
// ---------------------------------------------------------------------------

describe("the engine's contract", () => {
  it("uses no AI", () => {
    // Phase 14 interprets this list. It does not produce it.
    const source = readFileSync(
      new globalThis.URL("./build-recommendations.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/openai|anthropic|gemini|\bllm\b|prompt|fetch\(/i);
  });

  it("performs no I/O and reads no clock", () => {
    for (const file of ["./build-recommendations.ts", "./rank.ts", "./impact.ts"]) {
      const source = readFileSync(new globalThis.URL(file, import.meta.url), "utf8");

      expect(source).not.toMatch(/Date\.now|new Date|Math\.random|node:fs|node:http/);
    }
  });

  it("holds no second copy of the scoring model", () => {
    // The weights and the deduction table are imported from lib/scoring. A
    // literal weight table here could disagree with the score (ADR-052).
    const source = readFileSync(
      new globalThis.URL("./impact.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('from "@/lib/scoring"');
    expect(source).not.toMatch(/performance:\s*20|security:\s*5/);
  });

  it("does not mutate the findings it was given", () => {
    const findings = mixedFindings.map((item) => ({ ...item }));
    const snapshot = JSON.stringify(findings);

    buildRecommendations({ findings });

    expect(JSON.stringify(findings)).toBe(snapshot);
  });
});
