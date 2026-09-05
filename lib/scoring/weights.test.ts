/**
 * Guards that the implemented model matches the documented one.
 *
 * `docs/SCORING.md` is the source of truth and this file is the only thing
 * stopping the code and the document drifting apart silently. Every value here
 * is asserted against the document as written, not against the implementation.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { gradeFor, GRADE_BANDS } from "./grade";
import { SCORING_VERSION } from "./version";
import {
  CATEGORY_WEIGHTS,
  deductionFor,
  DEDUCTIONS,
  METRIC_CURVES,
  normaliseMetric,
  PERFORMANCE_COMPONENTS,
} from "./weights";

const SCORING_DOC = readFileSync(path.join(process.cwd(), "docs", "SCORING.md"), "utf8");

describe("category weights match docs/SCORING.md", () => {
  it.each([
    ["performance", 20],
    ["ux", 20],
    ["seo", 15],
    ["accessibility", 15],
    ["content", 15],
    ["mobile", 10],
    ["security", 5],
  ] as const)("weights %s at %i%%", (category, weight) => {
    expect(CATEGORY_WEIGHTS[category]).toBe(weight);
  });

  it("sums to exactly 100", () => {
    const total = Object.values(CATEGORY_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);
  });

  it("covers every category the document lists, and no others", () => {
    expect(Object.keys(CATEGORY_WEIGHTS).sort()).toEqual([
      "accessibility",
      "content",
      "mobile",
      "performance",
      "security",
      "seo",
      "ux",
    ]);
  });

  it("still carries the weights ADR-037 flagged as unreviewed", () => {
    // Implemented as documented rather than as preferred. If these change, the
    // document, the ADR and the scoring version all change with them.
    expect(CATEGORY_WEIGHTS.security).toBe(5);
    expect(CATEGORY_WEIGHTS.ux).toBe(20);
  });
});

describe("the deduction table matches docs/SCORING.md", () => {
  it.each([
    ["critical", "fail", 25],
    ["critical", "warn", 12],
    ["serious", "fail", 15],
    ["serious", "warn", 8],
    ["moderate", "fail", 8],
    ["moderate", "warn", 4],
    ["minor", "fail", 3],
    ["minor", "warn", 1],
    ["info", "fail", 0],
    ["info", "warn", 0],
  ] as const)("deducts %s/%s by %i", (severity, status, points) => {
    expect(deductionFor(severity, status)).toBe(points);
  });

  it.each(["critical", "serious", "moderate", "minor", "info"] as const)(
    "deducts nothing for a passing %s finding",
    (severity) => {
      expect(deductionFor(severity, "pass")).toBe(0);
    },
  );

  it.each(["critical", "serious", "moderate", "minor", "info"] as const)(
    "deducts nothing when a %s check could not determine an answer",
    (severity) => {
      // ADR-021: not knowing is not the same as failing.
      expect(deductionFor(severity, "could_not_determine")).toBe(0);
    },
  );

  it("never returns a negative deduction", () => {
    for (const severity of Object.keys(DEDUCTIONS)) {
      for (const points of Object.values(
        DEDUCTIONS[severity as keyof typeof DEDUCTIONS],
      )) {
        expect(points).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("orders severities so worse always costs at least as much", () => {
    expect(deductionFor("critical", "fail")).toBeGreaterThan(
      deductionFor("serious", "fail"),
    );
    expect(deductionFor("serious", "fail")).toBeGreaterThan(
      deductionFor("moderate", "fail"),
    );
    expect(deductionFor("moderate", "fail")).toBeGreaterThan(
      deductionFor("minor", "fail"),
    );
  });

  it("always costs more to fail than to warn at the same severity", () => {
    for (const severity of ["critical", "serious", "moderate", "minor"] as const) {
      expect(deductionFor(severity, "fail")).toBeGreaterThan(
        deductionFor(severity, "warn"),
      );
    }
  });
});

describe("grade bands match docs/SCORING.md", () => {
  it.each([
    [100, "A"],
    [90, "A"],
    [89, "B"],
    [80, "B"],
    [79, "C"],
    [70, "C"],
    [69, "D"],
    [60, "D"],
    [59, "F"],
    [0, "F"],
  ] as const)("grades %i as %s", (score, grade) => {
    expect(gradeFor(score)).toBe(grade);
  });

  it("gives no grade when there is no score", () => {
    // An unassessed category graded F would be a verdict nobody reached.
    expect(gradeFor(null)).toBeNull();
  });

  it("has bands that meet without gaps or overlaps", () => {
    for (let index = 1; index < GRADE_BANDS.length; index += 1) {
      const higher = GRADE_BANDS[index - 1];
      const lower = GRADE_BANDS[index];
      expect(higher?.min).toBeGreaterThan(lower?.min ?? -1);
    }

    expect(GRADE_BANDS[GRADE_BANDS.length - 1]?.min).toBe(0);
  });
});

describe("metric curves match docs/SCORING.md", () => {
  it.each([
    ["lcp", 2500, 4000],
    ["tbt", 200, 600],
    ["cls", 0.1, 0.25],
  ] as const)("uses %s thresholds %s good / %s poor", (key, good, poor) => {
    expect(METRIC_CURVES[key].good).toBe(good);
    expect(METRIC_CURVES[key].poor).toBe(poor);
  });

  it("does not define a curve for INP", () => {
    // ADR-030: a lab run cannot produce it, so it must not be scored.
    expect(METRIC_CURVES).not.toHaveProperty("inp");
  });
});

describe("performance sub-weights match docs/SCORING.md", () => {
  it.each([
    ["lcp", 25],
    ["tbt", 20],
    ["cls", 15],
    ["pageWeight", 10],
    ["imageOptimization", 10],
    ["jsCost", 10],
    ["other", 10],
  ])("declares %s at %i%%", (key, weight) => {
    const component = PERFORMANCE_COMPONENTS.find((item) => item.key === key);
    expect(component?.declaredWeight).toBe(weight);
  });

  it("sums declared weights to exactly 100", () => {
    const total = PERFORMANCE_COMPONENTS.reduce(
      (sum, component) => sum + component.declaredWeight,
      0,
    );
    expect(total).toBe(100);
  });

  it("marks the four components the document leaves undefined", () => {
    // Recording the gap in data rather than inventing thresholds (CLAUDE.md).
    const undefinedKeys = PERFORMANCE_COMPONENTS.filter(
      (component) => component.curve === null,
    ).map((component) => component.key);

    expect(undefinedKeys.sort()).toEqual([
      "imageOptimization",
      "jsCost",
      "other",
      "pageWeight",
    ]);
  });

  it("gives every undefined component a reason", () => {
    for (const component of PERFORMANCE_COMPONENTS) {
      if (component.curve !== null) continue;
      expect(component.undefinedReason?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("gives every scorable component no exclusion reason", () => {
    for (const component of PERFORMANCE_COMPONENTS) {
      if (component.curve === null) continue;
      expect(component.undefinedReason).toBeNull();
    }
  });
});

describe("normaliseMetric", () => {
  it("scores 100 at or better than the good threshold", () => {
    expect(normaliseMetric(2500, METRIC_CURVES.lcp)).toBe(100);
    expect(normaliseMetric(1000, METRIC_CURVES.lcp)).toBe(100);
    expect(normaliseMetric(0, METRIC_CURVES.lcp)).toBe(100);
  });

  it("scores 0 at or worse than the poor threshold", () => {
    expect(normaliseMetric(4000, METRIC_CURVES.lcp)).toBe(0);
    expect(normaliseMetric(30_000, METRIC_CURVES.lcp)).toBe(0);
  });

  it("interpolates linearly between the two", () => {
    // Exactly halfway between 2500 and 4000.
    expect(normaliseMetric(3250, METRIC_CURVES.lcp)).toBe(50);
    // A quarter of the way in.
    expect(normaliseMetric(2875, METRIC_CURVES.lcp)).toBe(75);
  });

  it("handles the CLS curve, whose numbers are fractional", () => {
    expect(normaliseMetric(0.1, METRIC_CURVES.cls)).toBe(100);
    expect(normaliseMetric(0.25, METRIC_CURVES.cls)).toBe(0);
    expect(normaliseMetric(0.175, METRIC_CURVES.cls)).toBe(50);
  });

  it("returns null for an unmeasured metric rather than zero", () => {
    // Zero would read as a measurement of a page nobody measured.
    expect(normaliseMetric(null, METRIC_CURVES.lcp)).toBeNull();
  });

  it("returns null for a non-finite value", () => {
    expect(normaliseMetric(Number.NaN, METRIC_CURVES.lcp)).toBeNull();
    expect(normaliseMetric(Infinity, METRIC_CURVES.lcp)).toBeNull();
  });

  it("never returns a value outside 0 to 100", () => {
    for (const value of [-1000, 0, 2499, 2500, 3000, 3999, 4000, 100_000]) {
      const score = normaliseMetric(value, METRIC_CURVES.lcp);
      expect(score).not.toBeNull();
      expect(score!).toBeGreaterThanOrEqual(0);
      expect(score!).toBeLessThanOrEqual(100);
    }
  });

  it("refuses to score a degenerate or inverted curve", () => {
    // A curve whose `poor` is not worse than its `good` is a misconfiguration.
    // Producing a number from it would be confident nonsense, so it reports
    // that it could not score instead.
    expect(normaliseMetric(5, { good: 10, poor: 10, unit: "" })).toBeNull();
    expect(normaliseMetric(15, { good: 20, poor: 10, unit: "" })).toBeNull();
    expect(normaliseMetric(5, { good: 20, poor: 10, unit: "" })).toBeNull();
  });
});

describe("the scoring version", () => {
  it("matches the version recorded in docs/SCORING.md", () => {
    // ADR-013: an old score stays interpretable only if the two agree.
    const match = /\*\*Scoring version:\s*(\d+)\*\*/.exec(SCORING_DOC);

    expect(match, "docs/SCORING.md declares no scoring version").not.toBeNull();
    expect(Number(match?.[1])).toBe(SCORING_VERSION);
  });

  it("is a positive integer", () => {
    expect(Number.isInteger(SCORING_VERSION)).toBe(true);
    expect(SCORING_VERSION).toBeGreaterThan(0);
  });
});
