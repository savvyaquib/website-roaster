import { describe, expect, it } from "vitest";

import type { PerformanceMeasurements } from "@/lib/analysis/performance";
import type {
  AnalysisCategory,
  Evidence,
  Finding,
  FindingSeverity,
  FindingStatus,
} from "@/lib/types/finding";

import { scoreAnalysis, scoreCategories, scoreOverall } from "./score-analysis";
import { scoreCategoryFromFindings, wasAssessed } from "./score-category";
import { scorePerformance } from "./score-performance";
import { SCORING_VERSION } from "./version";
import { CATEGORY_WEIGHTS, SCORED_CATEGORIES } from "./weights";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const evidence: Evidence[] = [
  { kind: "measured", source: "dom", summary: "Something was observed." },
];

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
    evidence,
    explanation: "An explanation.",
    recommendation: "A recommendation.",
  };
}

/** One passing finding for every category except performance. */
function allPassing(): Finding[] {
  return SCORED_CATEGORIES.filter((category) => category !== "performance").map(
    (category) => finding(category, "info", "pass"),
  );
}

function measurements(
  overrides: Partial<PerformanceMeasurements> = {},
): PerformanceMeasurements {
  return {
    lcpMs: 2000,
    inpMs: null,
    inpUnavailableReason: "Field metric.",
    clsScore: 0.05,
    tbtMs: 100,
    fcpMs: 800,
    speedIndexMs: 1500,
    timeToInteractiveMs: 2200,
    serverResponseMs: 120,
    totalByteWeight: 900_000,
    requestCount: 40,
    resourceBreakdown: [],
    javaScriptBootupMs: 300,
    mainThreadWorkMs: 900,
    unusedJavaScriptBytes: 100_000,
    imagePotentialSavingsBytes: 50_000,
    renderBlockingWastedMs: 100,
    renderBlockingCount: 2,
    engineName: "lighthouse",
    engineVersion: "13.4.1",
    measuredUrl: "https://example.com/",
    ...overrides,
  };
}

function categoryScore(
  report: ReturnType<typeof scoreAnalysis>,
  category: AnalysisCategory,
) {
  return report.categories.find((entry) => entry.category === category);
}

// ---------------------------------------------------------------------------
// Perfect results
// ---------------------------------------------------------------------------

describe("a perfect analysis", () => {
  const report = scoreAnalysis({
    findings: allPassing(),
    performance: measurements(),
  });

  it("scores every category 100", () => {
    for (const category of report.categories) {
      expect(category.score, `${category.category} did not score 100`).toBe(100);
    }
  });

  it("scores overall 100 with an A", () => {
    expect(report.overall.score).toBe(100);
    expect(report.overall.grade).toBe("A");
  });

  it("assesses every category", () => {
    expect(report.overall.assessedCategories).toHaveLength(SCORED_CATEGORIES.length);
    expect(report.overall.notAssessedCategories).toEqual([]);
  });

  it("uses the declared weights when nothing is excluded", () => {
    for (const entry of report.overall.weighting) {
      expect(entry.effectiveWeight).toBe(CATEGORY_WEIGHTS[entry.category]);
    }
  });

  it("records the scoring version", () => {
    expect(report.scoringVersion).toBe(SCORING_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Poor results
// ---------------------------------------------------------------------------

describe("a poor analysis", () => {
  const findings: Finding[] = [
    finding("security", "critical", "fail"),
    finding("security", "serious", "fail"),
    finding("seo", "critical", "fail"),
    finding("seo", "serious", "fail"),
    finding("seo", "moderate", "warn"),
    finding("accessibility", "critical", "fail"),
    finding("mobile", "serious", "fail"),
    finding("content", "moderate", "fail"),
    finding("ux", "minor", "warn"),
  ];

  const report = scoreAnalysis({
    findings,
    performance: measurements({ lcpMs: 5000, tbtMs: 900, clsScore: 0.4 }),
  });

  it("scores the worst metrics at zero", () => {
    // Every metric past its poor threshold.
    expect(categoryScore(report, "performance")?.score).toBe(0);
  });

  it("deducts as the table says", () => {
    // critical fail 25 + serious fail 15 = 40, from 100.
    expect(categoryScore(report, "security")?.score).toBe(60);
    // 25 + 15 + 4 = 44.
    expect(categoryScore(report, "seo")?.score).toBe(56);
  });

  it("produces a low overall score", () => {
    expect(report.overall.score).toBeLessThan(70);
    expect(report.overall.score).toBeGreaterThan(0);
  });

  it("never produces a negative category score", () => {
    const brutal = Array.from({ length: 20 }, () => finding("seo", "critical", "fail"));

    // 20 x 25 = 500 points of deductions against a starting 100.
    const score = scoreCategoryFromFindings("seo", brutal);
    expect(score.score).toBe(0);
    expect(score.totalDeducted).toBe(500);
    expect(score.explanation).toContain("clamped");
  });

  it("never produces a negative overall score", () => {
    const report = scoreAnalysis({
      findings: SCORED_CATEGORIES.filter((c) => c !== "performance").flatMap((category) =>
        Array.from({ length: 10 }, () => finding(category, "critical", "fail")),
      ),
      performance: measurements({ lcpMs: 99_999, tbtMs: 99_999, clsScore: 9 }),
    });

    expect(report.overall.score).toBe(0);
    expect(report.overall.grade).toBe("F");
  });
});

// ---------------------------------------------------------------------------
// Missing evidence and analyzer failures
// ---------------------------------------------------------------------------

describe("missing evidence", () => {
  it("does not assess a category with no findings", () => {
    const score = scoreCategoryFromFindings("seo", []);

    expect(score.status).toBe("not_assessed");
    expect(score.score).toBeNull();
    expect(score.grade).toBeNull();
  });

  it("does not assess a category where every check was undetermined", () => {
    // The analyzer ran but established nothing. Scoring it 100 would reward a
    // site for being unmeasurable (ADR-021).
    const score = scoreCategoryFromFindings("security", [
      finding("security", "info", "could_not_determine"),
      finding("security", "moderate", "could_not_determine"),
    ]);

    expect(score.status).toBe("not_assessed");
    expect(score.score).toBeNull();
  });

  it("assesses a category where at least one check reached a verdict", () => {
    const score = scoreCategoryFromFindings("security", [
      finding("security", "info", "could_not_determine"),
      finding("security", "moderate", "fail"),
    ]);

    expect(score.status).toBe("scored");
    expect(score.score).toBe(92);
  });

  it("scores a category of only undetermined-plus-pass findings normally", () => {
    const score = scoreCategoryFromFindings("mobile", [
      finding("mobile", "info", "could_not_determine"),
      finding("mobile", "info", "pass"),
    ]);

    expect(score.status).toBe("scored");
    expect(score.score).toBe(100);
  });

  it("never scores an unassessed category as zero", () => {
    const report = scoreAnalysis({ findings: [], performance: undefined });

    for (const category of report.categories) {
      expect(category.score, `${category.category} was scored`).toBeNull();
      expect(category.status).toBe("not_assessed");
    }
  });

  it("gives every unassessed category a reason", () => {
    const report = scoreAnalysis({ findings: [] });

    for (const category of report.categories) {
      expect((category.notAssessedReason ?? "").length).toBeGreaterThan(0);
    }
  });

  it("has no overall score when nothing could be assessed", () => {
    const report = scoreAnalysis({ findings: [] });

    expect(report.overall.score).toBeNull();
    expect(report.overall.grade).toBeNull();
    expect(report.overall.explanation).toContain("not a score of zero");
  });

  it("wasAssessed is false only when nothing reached a verdict", () => {
    expect(wasAssessed([])).toBe(false);
    expect(wasAssessed([finding("seo", "info", "could_not_determine")])).toBe(false);
    expect(wasAssessed([finding("seo", "info", "pass")])).toBe(true);
    expect(wasAssessed([finding("seo", "minor", "warn")])).toBe(true);
  });
});

describe("analyzer failures", () => {
  it("excludes a failed analyzer and redistributes its weight", () => {
    // Accessibility produced only could-not-determine, exactly as the phase
    // does when axe cannot run.
    const findings = [
      ...SCORED_CATEGORIES.filter(
        (category) => category !== "performance" && category !== "accessibility",
      ).map((category) => finding(category, "info", "pass")),
      finding("accessibility", "info", "could_not_determine"),
    ];

    const report = scoreAnalysis({ findings, performance: measurements() });

    expect(report.overall.notAssessedCategories).toEqual(["accessibility"]);

    // The document's worked example: with accessibility's 15 removed, 85
    // remains, so performance's 20 becomes 20/85 = 23.53%.
    const performance = report.overall.weighting.find(
      (entry) => entry.category === "performance",
    );
    expect(performance?.effectiveWeight).toBeCloseTo(23.53, 1);

    const accessibility = report.overall.weighting.find(
      (entry) => entry.category === "accessibility",
    );
    expect(accessibility?.effectiveWeight).toBe(0);
    expect(accessibility?.contribution).toBe(0);
  });

  it("still reaches 100 overall when every assessed category is perfect", () => {
    // Redistribution must not cost a site points for something we could not
    // measure.
    const findings = [
      ...SCORED_CATEGORIES.filter(
        (category) => category !== "performance" && category !== "security",
      ).map((category) => finding(category, "info", "pass")),
    ];

    const report = scoreAnalysis({ findings, performance: measurements() });

    expect(report.overall.notAssessedCategories).toEqual(["security"]);
    expect(report.overall.score).toBe(100);
  });

  it("excludes performance when the audit did not run", () => {
    const report = scoreAnalysis({ findings: allPassing(), performance: undefined });

    const performance = categoryScore(report, "performance");
    expect(performance?.status).toBe("not_assessed");
    expect(performance?.notAssessedReason).toContain("No performance measurements");
    expect(report.overall.score).toBe(100);
  });

  it("scores every other category when one analyzer fails", () => {
    const findings = [
      ...SCORED_CATEGORIES.filter(
        (category) => category !== "performance" && category !== "ux",
      ).map((category) => finding(category, "moderate", "fail")),
      finding("ux", "info", "could_not_determine"),
    ];

    const report = scoreAnalysis({ findings, performance: measurements() });

    for (const category of report.categories) {
      if (category.category === "ux") {
        expect(category.status).toBe("not_assessed");
        continue;
      }
      expect(category.status).toBe("scored");
    }
  });
});

// ---------------------------------------------------------------------------
// Boundary values
// ---------------------------------------------------------------------------

describe("boundary values", () => {
  it.each([
    [0, "F"],
    [59, "F"],
    [60, "D"],
    [69, "D"],
    [70, "C"],
    [79, "C"],
    [80, "B"],
    [89, "B"],
    [90, "A"],
    [100, "A"],
  ] as const)("grades a category scoring %i as %s", (target, grade) => {
    // Build deductions summing to exactly 100 - target using minor fails (-3)
    // and warns (-1), so the boundary is hit precisely.
    const needed = 100 - target;
    const findings: Finding[] = [
      ...Array.from({ length: Math.floor(needed / 3) }, () =>
        finding("seo", "minor", "fail"),
      ),
      ...Array.from({ length: needed % 3 }, () => finding("seo", "minor", "warn")),
      finding("seo", "info", "pass"),
    ];

    const score = scoreCategoryFromFindings("seo", findings);
    expect(score.score).toBe(target);
    expect(score.grade).toBe(grade);
  });

  it("scores a metric exactly at its good threshold as 100", () => {
    const score = scorePerformance(
      measurements({ lcpMs: 2500, tbtMs: 200, clsScore: 0.1 }),
    );

    expect(score.score).toBe(100);
  });

  it("scores a metric exactly at its poor threshold as 0", () => {
    const score = scorePerformance(
      measurements({ lcpMs: 4000, tbtMs: 600, clsScore: 0.25 }),
    );

    expect(score.score).toBe(0);
  });

  it("handles a single finding of every severity and status combination", () => {
    for (const severity of [
      "critical",
      "serious",
      "moderate",
      "minor",
      "info",
    ] as const) {
      for (const status of ["pass", "warn", "fail", "could_not_determine"] as const) {
        const score = scoreCategoryFromFindings("seo", [
          finding("seo", severity, status),
          finding("seo", "info", "pass"),
        ]);

        expect(score.score).not.toBeNull();
        expect(score.score!).toBeGreaterThanOrEqual(0);
        expect(score.score!).toBeLessThanOrEqual(100);
      }
    }
  });

  it("produces integer scores everywhere", () => {
    const report = scoreAnalysis({
      findings: [
        finding("seo", "moderate", "warn"),
        finding("security", "minor", "fail"),
        finding("ux", "minor", "warn"),
        finding("content", "serious", "warn"),
        finding("mobile", "moderate", "fail"),
        finding("accessibility", "critical", "warn"),
      ],
      performance: measurements({ lcpMs: 3111, tbtMs: 333, clsScore: 0.17 }),
    });

    expect(Number.isInteger(report.overall.score)).toBe(true);
    for (const category of report.categories) {
      expect(Number.isInteger(category.score)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Weighting
// ---------------------------------------------------------------------------

describe("weighting", () => {
  it("weights a category by exactly its declared share", () => {
    // Only security scores badly; everything else is perfect. Security is 5%,
    // so a zero there should cost 5 points overall.
    const findings = [
      ...SCORED_CATEGORIES.filter(
        (category) => category !== "performance" && category !== "security",
      ).map((category) => finding(category, "info", "pass")),
      ...Array.from({ length: 5 }, () => finding("security", "critical", "fail")),
    ];

    const report = scoreAnalysis({ findings, performance: measurements() });

    expect(categoryScore(report, "security")?.score).toBe(0);
    expect(report.overall.score).toBe(95);
  });

  it("weights UX four times as heavily as security", () => {
    // The asymmetry ADR-037 flags, demonstrated rather than described.
    const withBadUx = scoreAnalysis({
      findings: [
        ...SCORED_CATEGORIES.filter(
          (category) => category !== "performance" && category !== "ux",
        ).map((category) => finding(category, "info", "pass")),
        ...Array.from({ length: 5 }, () => finding("ux", "critical", "fail")),
      ],
      performance: measurements(),
    });

    expect(withBadUx.overall.score).toBe(80);
  });

  it("redistributes proportionally, preserving the ratio between categories", () => {
    const findings = [
      ...SCORED_CATEGORIES.filter(
        (category) => category !== "performance" && category !== "content",
      ).map((category) => finding(category, "info", "pass")),
      finding("content", "info", "could_not_determine"),
    ];

    const report = scoreAnalysis({ findings, performance: measurements() });

    const weightFor = (category: AnalysisCategory) =>
      report.overall.weighting.find((entry) => entry.category === category)
        ?.effectiveWeight ?? 0;

    // Performance is 20 and mobile is 10 before redistribution; the 2:1 ratio
    // survives it, to within the two-decimal rounding the report displays.
    expect(weightFor("performance") / weightFor("mobile")).toBeCloseTo(2, 2);
  });

  it("gives effective weights summing to about 100 when anything is assessed", () => {
    const findings = [
      finding("seo", "info", "pass"),
      finding("security", "info", "pass"),
    ];

    const report = scoreAnalysis({ findings });
    const total = report.overall.weighting.reduce(
      (sum, entry) => sum + entry.effectiveWeight,
      0,
    );

    // Rounded to two decimals per entry, so a hair of drift is expected.
    expect(total).toBeGreaterThan(99.9);
    expect(total).toBeLessThan(100.1);
  });

  it("gives a single assessed category the whole weight", () => {
    const report = scoreAnalysis({
      findings: [finding("mobile", "moderate", "fail")],
    });

    const mobile = report.overall.weighting.find((entry) => entry.category === "mobile");

    expect(mobile?.effectiveWeight).toBe(100);
    expect(report.overall.score).toBe(92);
  });
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe("performance normalisation", () => {
  const score = scorePerformance(
    measurements({ lcpMs: 3250, tbtMs: 400, clsScore: 0.175 }),
  );

  it("keeps the raw value alongside the normalised one", () => {
    // ADR-012: the measurement is never overwritten by its score.
    const lcp = score.metrics.find((metric) => metric.key === "lcp");

    expect(lcp?.rawValue).toBe(3250);
    expect(lcp?.normalisedScore).toBe(50);
    expect(lcp?.unit).toBe("ms");
  });

  it("scores every metric at the midpoint to 50", () => {
    expect(score.score).toBe(50);
  });

  it("excludes the components whose thresholds are undefined", () => {
    const excluded = score.metrics.filter((metric) => metric.excludedReason !== null);

    expect(excluded.map((metric) => metric.key).sort()).toEqual([
      "imageOptimization",
      "jsCost",
      "other",
      "pageWeight",
    ]);
    for (const metric of excluded) {
      expect(metric.effectiveWeight).toBe(0);
      expect(metric.contribution).toBe(0);
    }
  });

  it("redistributes the excluded weight across the three defined metrics", () => {
    // 25 + 20 + 15 = 60 declared, redistributed to 100.
    const lcp = score.metrics.find((metric) => metric.key === "lcp");
    const tbt = score.metrics.find((metric) => metric.key === "tbt");
    const cls = score.metrics.find((metric) => metric.key === "cls");

    expect(lcp?.effectiveWeight).toBeCloseTo(41.67, 1);
    expect(tbt?.effectiveWeight).toBeCloseTo(33.33, 1);
    expect(cls?.effectiveWeight).toBeCloseTo(25, 1);
  });

  it("excludes a metric that was not measured", () => {
    const partial = scorePerformance(measurements({ clsScore: null }));
    const cls = partial.metrics.find((metric) => metric.key === "cls");

    expect(cls?.excludedReason).toContain("not measured");
    expect(cls?.effectiveWeight).toBe(0);
    expect(partial.status).toBe("scored");
  });

  it("does not assess performance when no metric could be scored", () => {
    const none = scorePerformance(
      measurements({ lcpMs: null, tbtMs: null, clsScore: null }),
    );

    expect(none.status).toBe("not_assessed");
    expect(none.score).toBeNull();
  });

  it("never scores INP, whatever the measurements claim", () => {
    // ADR-030: it cannot come from a lab run, so it must not reach the score.
    const withInp = scorePerformance(measurements({ inpMs: 250 }));

    expect(withInp.metrics.some((metric) => metric.key === "inp")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Traceability
// ---------------------------------------------------------------------------

describe("every score traces back to evidence", () => {
  const findings: Finding[] = [
    finding("seo", "critical", "fail", "seo.title.missing"),
    finding("seo", "moderate", "warn", "seo.description.too_long"),
    finding("seo", "info", "pass", "seo.canonical.ok"),
    finding("security", "serious", "fail", "security.cookies.missing_secure"),
    finding("accessibility", "minor", "warn", "accessibility.axe.region"),
    finding("mobile", "moderate", "fail", "mobile.overflow.horizontal"),
    finding("content", "minor", "fail", "content.footer.missing"),
    finding("ux", "minor", "warn", "ux.navigation.busy"),
  ];

  const report = scoreAnalysis({ findings, performance: measurements() });

  it("reconstructs every deduction-scored category from its recorded deductions", () => {
    for (const category of report.categories) {
      if (category.method !== "deductions" || category.status !== "scored") continue;

      const recomputed = Math.max(
        0,
        100 - category.deductions.reduce((sum, item) => sum + item.deduction, 0),
      );

      expect(recomputed, `${category.category} does not reconstruct`).toBe(
        category.score,
      );
    }
  });

  it("names a real finding for every deduction", () => {
    const knownIds = new Set(findings.map((item) => item.id));

    for (const category of report.categories) {
      for (const deduction of category.deductions) {
        expect(knownIds.has(deduction.findingId)).toBe(true);
      }
    }
  });

  it("records the severity and status that produced each deduction", () => {
    const seo = categoryScore(report, "seo");
    const titleDeduction = seo?.deductions.find(
      (item) => item.findingId === "seo.title.missing",
    );

    expect(titleDeduction).toEqual({
      findingId: "seo.title.missing",
      severity: "critical",
      status: "fail",
      deduction: 25,
    });
  });

  it("reconstructs performance from its recorded metric contributions", () => {
    const performance = categoryScore(report, "performance");
    const recomputed = Math.round(
      (performance?.metrics ?? []).reduce((sum, metric) => sum + metric.contribution, 0),
    );

    expect(recomputed).toBe(performance?.score);
  });

  it("reconstructs the overall score from the displayed category scores", () => {
    // Computed from rounded category scores on purpose, so a reader can
    // reproduce it by hand from the report rather than from hidden precision.
    const recomputed = Math.round(
      report.overall.weighting.reduce((sum, entry) => sum + entry.contribution, 0),
    );

    expect(recomputed).toBe(report.overall.score);
  });

  it("computes each contribution from the score and weight it displays", () => {
    for (const entry of report.overall.weighting) {
      if (entry.effectiveWeight === 0) continue;

      const expected =
        Math.round((((entry.score ?? 0) * entry.effectiveWeight) / 100) * 100) / 100;
      expect(entry.contribution).toBeCloseTo(expected, 2);
    }
  });

  it("explains every category in plain language", () => {
    for (const category of report.categories) {
      expect(category.explanation.length).toBeGreaterThan(0);
      expect(category.explanation).toContain(category.category);
    }
  });

  it("explains the overall score, naming the categories that fed it", () => {
    expect(report.overall.explanation).toContain("Overall");
    for (const category of report.overall.assessedCategories) {
      expect(report.overall.explanation).toContain(category);
    }
  });

  it("counts every finding, including the ones that deducted nothing", () => {
    // The report shows what a site got right, not only what it got wrong.
    const seo = categoryScore(report, "seo");

    expect(seo?.findingCount).toBe(3);
    expect(seo?.deductions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Engine properties
// ---------------------------------------------------------------------------

describe("the engine's contract", () => {
  it("is deterministic", () => {
    const input = { findings: allPassing(), performance: measurements() };

    expect(scoreAnalysis(input)).toEqual(scoreAnalysis(input));
  });

  it("does not depend on the order findings arrive in", () => {
    const findings = [
      finding("seo", "critical", "fail", "a"),
      finding("seo", "minor", "warn", "b"),
      finding("seo", "moderate", "fail", "c"),
    ];

    const forward = scoreCategoryFromFindings("seo", findings);
    const backward = scoreCategoryFromFindings("seo", [...findings].reverse());

    expect(forward.score).toBe(backward.score);
    expect(forward.totalDeducted).toBe(backward.totalDeducted);
  });

  it("scores every category in the documented set", () => {
    const report = scoreAnalysis({ findings: allPassing(), performance: measurements() });

    expect(report.categories.map((category) => category.category)).toEqual([
      ...SCORED_CATEGORIES,
    ]);
  });

  it("ignores a finding for a category it does not score", () => {
    const stray = {
      ...finding("seo", "critical", "fail"),
      category: "nonsense" as AnalysisCategory,
    };

    const report = scoreAnalysis({ findings: [...allPassing(), stray] });

    expect(categoryScore(report, "seo")?.score).toBe(100);
  });

  it("uses no AI", async () => {
    // ADR-002: a score an opinion produced cannot be explained.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new globalThis.URL("./score-analysis.ts", import.meta.url), "utf8"),
    );

    expect(source).not.toMatch(/openai|anthropic|gemini|\bllm\b|prompt|fetch\(/i);
  });

  it("performs no I/O and reads no clock", async () => {
    const sources = await Promise.all(
      ["./score-analysis.ts", "./score-category.ts", "./score-performance.ts"].map(
        async (file) =>
          import("node:fs").then((fs) =>
            fs.readFileSync(new globalThis.URL(file, import.meta.url), "utf8"),
          ),
      ),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/Date\.now|new Date|Math\.random|node:fs|node:http/);
    }
  });

  it("returns the same categories from scoreCategories as from scoreAnalysis", () => {
    const input = { findings: allPassing(), performance: measurements() };

    expect(scoreCategories(input)).toEqual(scoreAnalysis(input).categories);
  });

  it("scoreOverall agrees with scoreAnalysis", () => {
    const input = { findings: allPassing(), performance: measurements() };
    const categories = scoreCategories(input);

    expect(scoreOverall(categories)).toEqual(scoreAnalysis(input).overall);
  });
});
