/**
 * Ordering tests.
 *
 * Each key of the sort is tested in isolation: two entries that differ on that
 * key alone, so a passing test says the key is doing the work rather than some
 * other key happening to agree with it.
 */

import { describe, expect, it } from "vitest";

import { scoreAnalysis } from "@/lib/scoring";
import type { ScoreReport } from "@/lib/scoring";
import type {
  AnalysisCategory,
  Finding,
  FindingSeverity,
  FindingStatus,
} from "@/lib/types/finding";

import { impactFor } from "./impact";
import { compareRecommendations, rankRecommendations, tierLabel } from "./rank";
import type { UnrankedRecommendation } from "./rank";
import { tierFor } from "./tiers";
import { deriveTitle } from "./title";

function entry(
  id: string,
  category: AnalysisCategory,
  severity: FindingSeverity,
  status: FindingStatus = "fail",
  score?: ScoreReport,
): UnrankedRecommendation {
  const finding: Finding = {
    id,
    category,
    severity,
    status,
    evidence: [{ kind: "measured", source: "dom", summary: `Observed ${id}.` }],
    explanation: "An explanation.",
    recommendation: "A recommendation.",
  };

  const tier = tierFor(category, severity);

  return {
    findingId: id,
    kind: status === "could_not_determine" ? "review" : "fix",
    title: deriveTitle(finding).title,
    titleSource: "evidence",
    impact: impactFor(finding, score),
    tier,
    tierLabel: tierLabel(tier),
    rankExplanation: "",
    finding,
  };
}

/** True when `first` sorts before `second`. */
function sortsFirst(
  first: UnrankedRecommendation,
  second: UnrankedRecommendation,
): boolean {
  return compareRecommendations(first, second) < 0;
}

describe("key 1 — impact level leads", () => {
  it("puts a high-impact problem above a medium one", () => {
    const high = entry("a", "seo", "serious", "fail");
    const medium = entry("b", "seo", "moderate", "fail");

    expect(sortsFirst(high, medium)).toBe(true);
  });

  it("puts a high-impact problem above a medium one worth more points", () => {
    // UX at 20% outweighs security at 5%, but a critical failure still leads a
    // moderate one. Severity is not for sale.
    const criticalSecurity = entry("a", "security", "critical", "fail");
    const moderateUx = entry("b", "ux", "moderate", "fail");

    expect(criticalSecurity.impact.points).toBeLessThan(moderateUx.impact.points!);
    expect(sortsFirst(criticalSecurity, moderateUx)).toBe(true);
  });

  it("puts anything actionable above something with no impact", () => {
    const low = entry("a", "content", "minor", "warn");
    const none = entry("b", "seo", "info", "fail");

    expect(sortsFirst(low, none)).toBe(true);
  });
});

describe("key 2 — severity", () => {
  it("puts a critical failure above a serious one in the same band", () => {
    // Both are high impact; severity separates them.
    const critical = entry("a", "seo", "critical", "fail");
    const serious = entry("b", "seo", "serious", "fail");

    expect(critical.impact.level).toBe(serious.impact.level);
    expect(sortsFirst(critical, serious)).toBe(true);
  });

  it("outranks points, so a heavier category cannot buy a lower severity up", () => {
    const criticalSecurity = entry("a", "security", "critical", "fail");
    const seriousUx = entry("b", "ux", "serious", "fail");

    expect(criticalSecurity.impact.points).toBeLessThan(seriousUx.impact.points!);
    expect(sortsFirst(criticalSecurity, seriousUx)).toBe(true);
  });
});

describe("key 3 — recoverable points", () => {
  it("puts the heavier category first when severity ties", () => {
    // This is where docs/SCORING.md's weights do their work: two identical
    // failures, and the one that moves the score more comes first.
    const seo = entry("a", "seo", "critical", "fail");
    const security = entry("b", "security", "critical", "fail");

    expect(seo.impact.points).toBe(3.75);
    expect(security.impact.points).toBe(1.25);
    expect(sortsFirst(seo, security)).toBe(true);
  });

  it("responds to redistribution rather than to the declared weight alone", () => {
    const findings: Finding[] = [
      { ...entry("a", "seo", "critical").finding },
      { ...entry("b", "mobile", "critical").finding },
    ];
    const score = scoreAnalysis({ findings });

    const seo = entry("a", "seo", "critical", "fail", score);
    const mobile = entry("b", "mobile", "critical", "fail", score);

    expect(seo.impact.categoryWeight).toBe(60);
    expect(mobile.impact.categoryWeight).toBe(40);
    expect(sortsFirst(seo, mobile)).toBe(true);
  });

  it("places an unpriceable performance finding after a priced one of equal severity", () => {
    // Placed, not scored. Treating null as zero would bury a real problem.
    const seo = entry("a", "seo", "critical", "fail");
    const performance = entry("b", "performance", "critical", "fail");

    expect(performance.impact.points).toBeNull();
    expect(sortsFirst(seo, performance)).toBe(true);
  });

  it("keeps an unpriceable performance finding above every milder problem", () => {
    const performance = entry("a", "performance", "critical", "fail");
    const moderate = entry("b", "ux", "moderate", "fail");

    expect(sortsFirst(performance, moderate)).toBe(true);
  });
});

describe("key 4 — status", () => {
  it("puts a failure above a warning of the same weight", () => {
    // moderate fail and critical warn both deduct 12 or fewer and land in the
    // medium band; the broken one comes first only once severity ties.
    const failing = entry("a", "seo", "moderate", "fail");
    const warning = entry("b", "seo", "moderate", "warn");

    expect(sortsFirst(failing, warning)).toBe(true);
  });

  it("puts an undetermined check last", () => {
    const warning = entry("a", "seo", "info", "warn");
    const undetermined = entry("b", "seo", "info", "could_not_determine");

    expect(sortsFirst(warning, undetermined)).toBe(true);
  });
});

describe("key 5 — the documented priority tier", () => {
  it("breaks a tie in favour of the earlier tier", () => {
    // Accessibility (tier 2) and SEO (tier 3) are both weighted at 15%, so an
    // equally severe failure in each is worth the same and every earlier key
    // ties. The tier is what separates them.
    //
    // The ids are chosen to disagree with the tier, so a pass here cannot be
    // key 6 doing the work by accident.
    const accessibility = entry("z.check", "accessibility", "serious", "fail");
    const seo = entry("a.check", "seo", "serious", "fail");

    expect(accessibility.impact.points).toBe(seo.impact.points);
    expect(accessibility.finding.severity).toBe(seo.finding.severity);
    expect(accessibility.tier).toBe(2);
    expect(seo.tier).toBe(3);

    expect(sortsFirst(accessibility, seo)).toBe(true);
  });

  it("is consulted only after points, which is the documented tension", () => {
    // docs/IMPLEMENTATION.md lists "severe technical problems" first, and
    // security is tier 1. But accessibility is weighted at 15% against
    // security's 5%, so points settle it before the tier is reached and the
    // tier-2 problem comes first. See ADR-053.
    const security = entry("a.check", "security", "serious", "fail");
    const accessibility = entry("z.check", "accessibility", "serious", "fail");

    expect(security.tier).toBeLessThan(accessibility.tier);
    expect(security.impact.points).toBeLessThan(accessibility.impact.points!);
    expect(sortsFirst(accessibility, security)).toBe(true);
  });
});

describe("key 6 — the ordering is total", () => {
  it("falls back to the finding id", () => {
    const first = entry("a.check", "seo", "serious", "fail");
    const second = entry("b.check", "seo", "serious", "fail");

    expect(sortsFirst(first, second)).toBe(true);
    expect(sortsFirst(second, first)).toBe(false);
  });

  it("compares an entry to itself as equal", () => {
    const only = entry("a", "seo", "serious", "fail");

    expect(compareRecommendations(only, only)).toBe(0);
  });

  it("is antisymmetric across a spread of entries", () => {
    const entries = [
      entry("a", "security", "critical", "fail"),
      entry("b", "seo", "critical", "warn"),
      entry("c", "performance", "serious", "fail"),
      entry("d", "ux", "minor", "warn"),
      entry("e", "content", "info", "could_not_determine"),
      entry("f", "accessibility", "moderate", "fail"),
    ];

    for (const first of entries) {
      for (const second of entries) {
        if (first === second) continue;
        expect(
          Math.sign(compareRecommendations(first, second)),
          `${first.findingId} vs ${second.findingId}`,
        ).toBe(-Math.sign(compareRecommendations(second, first)));
      }
    }
  });

  it("does not depend on the order the entries arrive in", () => {
    const entries = [
      entry("a", "security", "critical", "fail"),
      entry("b", "seo", "critical", "fail"),
      entry("c", "ux", "serious", "warn"),
      entry("d", "mobile", "moderate", "fail"),
      entry("e", "content", "minor", "warn"),
      entry("f", "accessibility", "info", "could_not_determine"),
    ];

    const forward = rankRecommendations(entries).map((item) => item.findingId);
    const backward = rankRecommendations([...entries].reverse()).map(
      (item) => item.findingId,
    );
    const shuffled = rankRecommendations([
      entries[3]!,
      entries[0]!,
      entries[5]!,
      entries[1]!,
      entries[4]!,
      entries[2]!,
    ]).map((item) => item.findingId);

    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });
});

describe("ranks", () => {
  it("numbers from 1, with no gaps", () => {
    const ranked = rankRecommendations([
      entry("a", "seo", "critical", "fail"),
      entry("b", "ux", "minor", "warn"),
      entry("c", "mobile", "serious", "fail"),
    ]);

    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it("does not mutate the list it was given", () => {
    const entries = [
      entry("b", "ux", "minor", "warn"),
      entry("a", "seo", "critical", "fail"),
    ];
    const original = entries.map((item) => item.findingId);

    rankRecommendations(entries);

    expect(entries.map((item) => item.findingId)).toEqual(original);
  });

  it("explains each position", () => {
    const ranked = rankRecommendations([
      entry("a", "seo", "critical", "fail"),
      entry("b", "ux", "minor", "warn"),
    ]);

    expect(ranked[0]?.rankExplanation).toContain("Ranked 1 of 2");
    expect(ranked[0]?.rankExplanation).toContain("high impact");
    expect(ranked[0]?.rankExplanation).toContain("critical severity");
    expect(ranked[0]?.rankExplanation).toContain("3.75 point(s)");
    expect(ranked[0]?.rankExplanation).toContain("Conversion and discoverability");
  });

  it("says when a position could not be priced", () => {
    const ranked = rankRecommendations([entry("a", "performance", "critical", "fail")]);

    expect(ranked[0]?.rankExplanation).toContain("cannot be priced");
  });

  it("ranks an empty list to an empty list", () => {
    expect(rankRecommendations([])).toEqual([]);
  });
});
