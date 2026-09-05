import { describe, expect, it } from "vitest";

import { deductionFor } from "@/lib/scoring";
import { ANALYSIS_CATEGORIES, FINDING_SEVERITIES } from "@/lib/types/finding";
import type { FindingSeverity, FindingStatus } from "@/lib/types/finding";

import {
  IMPACT_BANDS,
  IMPACT_LEVEL_ORDER,
  impactLevelFor,
  orderIndex,
  SEVERITY_ORDER,
  STATUS_ORDER,
  TIER_LABELS,
  tierFor,
} from "./tiers";

describe("priority tiers match docs/IMPLEMENTATION.md", () => {
  it.each([
    ["security", 1],
    ["performance", 1],
    ["accessibility", 2],
    ["mobile", 2],
    ["ux", 2],
    ["seo", 3],
    ["content", 3],
  ] as const)("puts a serious %s problem in tier %i", (category, tier) => {
    expect(tierFor(category, "serious")).toBe(tier);
  });

  it("labels the four tiers as the document names them", () => {
    expect(TIER_LABELS[1]).toBe("Severe technical problems");
    expect(TIER_LABELS[2]).toBe("Major usability problems");
    expect(TIER_LABELS[3]).toBe("Conversion and discoverability");
    expect(TIER_LABELS[4]).toBe("Minor polish");
  });

  it.each(ANALYSIS_CATEGORIES)(
    "treats a minor %s problem as polish, whatever its category",
    (category) => {
      // The document's fourth tier is named by size, not by kind, so it
      // overrides the category mapping.
      expect(tierFor(category, "minor")).toBe(4);
      expect(tierFor(category, "info")).toBe(4);
    },
  );

  it("gives every category a tier", () => {
    for (const category of ANALYSIS_CATEGORIES) {
      const tier = tierFor(category, "critical");
      expect(tier).toBeGreaterThanOrEqual(1);
      expect(tier).toBeLessThanOrEqual(4);
    }
  });
});

describe("impact bands", () => {
  it.each([
    ["critical", "fail", "high"],
    ["serious", "fail", "high"],
    ["critical", "warn", "medium"],
    ["serious", "warn", "medium"],
    ["moderate", "fail", "medium"],
    ["moderate", "warn", "medium"],
    ["minor", "fail", "low"],
    ["minor", "warn", "low"],
    ["info", "fail", "none"],
    ["info", "warn", "none"],
  ] as const)("bands a %s %s as %s impact", (severity, status, level) => {
    expect(impactLevelFor(severity, status)).toBe(level);
  });

  it.each(FINDING_SEVERITIES)("gives a passing %s finding no impact", (severity) => {
    expect(impactLevelFor(severity, "pass")).toBe("none");
  });

  it.each(FINDING_SEVERITIES)(
    "gives an undetermined %s finding no impact",
    (severity) => {
      // Not knowing is not a problem to weigh (ADR-021). These are still
      // recommended, as a review rather than a fix.
      expect(impactLevelFor(severity, "could_not_determine")).toBe("none");
    },
  );

  it("uses only boundaries that appear in the deduction table", () => {
    // No new thresholds are introduced by this layer (CLAUDE.md).
    const tableValues = new Set<number>();
    for (const severity of FINDING_SEVERITIES) {
      for (const status of ["fail", "warn"] as const) {
        tableValues.add(deductionFor(severity, status));
      }
    }

    for (const band of IMPACT_BANDS) {
      expect(
        tableValues.has(band.minDeduction),
        `${band.minDeduction} is not a value in the deduction table`,
      ).toBe(true);
    }
  });

  it("never bands a worse finding below a milder one", () => {
    const rank = (severity: FindingSeverity, status: FindingStatus) =>
      orderIndex(IMPACT_LEVEL_ORDER, impactLevelFor(severity, status));

    for (let index = 1; index < FINDING_SEVERITIES.length; index += 1) {
      const worse = FINDING_SEVERITIES[index - 1]!;
      const milder = FINDING_SEVERITIES[index]!;

      expect(rank(worse, "fail")).toBeLessThanOrEqual(rank(milder, "fail"));
      expect(rank(worse, "warn")).toBeLessThanOrEqual(rank(milder, "warn"));
    }
  });

  it("never bands a warning above the same severity failing", () => {
    for (const severity of FINDING_SEVERITIES) {
      const failRank = orderIndex(IMPACT_LEVEL_ORDER, impactLevelFor(severity, "fail"));
      const warnRank = orderIndex(IMPACT_LEVEL_ORDER, impactLevelFor(severity, "warn"));

      expect(failRank).toBeLessThanOrEqual(warnRank);
    }
  });
});

describe("orderings", () => {
  it("orders severities worst first", () => {
    expect(SEVERITY_ORDER).toEqual(["critical", "serious", "moderate", "minor", "info"]);
  });

  it("orders statuses most urgent first, with pass last", () => {
    expect(STATUS_ORDER).toEqual(["fail", "warn", "could_not_determine", "pass"]);
  });

  it("sorts an unknown value last rather than first", () => {
    // A silent zero would put an unrecognised value at the top of the report.
    expect(orderIndex(SEVERITY_ORDER, "nonsense" as FindingSeverity)).toBe(
      SEVERITY_ORDER.length,
    );
  });
});
