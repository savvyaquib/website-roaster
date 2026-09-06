import { describe, expect, it } from "vitest";

import { buildRecommendations } from "@/lib/recommendations";
import { scoreAnalysis } from "@/lib/scoring";
import type { Finding, FindingSeverity, FindingStatus } from "@/lib/types/finding";

import {
  DEFAULT_LINE_COUNT,
  observationFor,
  roastableFindings,
  selectRoastTargets,
} from "./select";

let counter = 0;

function finding(
  status: FindingStatus,
  severity: FindingSeverity = "serious",
  id?: string,
): Finding {
  counter += 1;
  return {
    id: id ?? `seo.check.${counter}`,
    category: "seo",
    severity,
    status,
    evidence: [{ kind: "measured", source: "dom", summary: "Something was observed." }],
    explanation: "An explanation.",
  };
}

describe("what may be roasted", () => {
  it("takes failures and warnings", () => {
    const findings = [finding("fail"), finding("warn")];

    expect(roastableFindings(findings)).toHaveLength(2);
  });

  it("never takes a passing check", () => {
    // A passing check is not funny, and calling one a problem would be the
    // fabrication ADR-015 rules out.
    expect(roastableFindings([finding("pass")])).toEqual([]);
  });

  it("never takes an undetermined check", () => {
    // It established nothing. There is no problem there to joke about.
    expect(roastableFindings([finding("could_not_determine")])).toEqual([]);
  });

  it("never takes an info-severity finding", () => {
    // These are neutral observations, not problems.
    expect(roastableFindings([finding("warn", "info")])).toEqual([]);
  });

  it("returns nothing for a clean site", () => {
    expect(roastableFindings([finding("pass"), finding("pass")])).toEqual([]);
  });
});

describe("which ones get roasted", () => {
  it("follows Phase 13's ranking when one is supplied", () => {
    const findings = [
      finding("warn", "minor", "seo.minor.thing"),
      finding("fail", "critical", "seo.critical.thing"),
    ];
    const recommendations = buildRecommendations({
      findings,
      score: scoreAnalysis({ findings }),
    });

    const targets = selectRoastTargets(findings, recommendations);

    // The roast is about the same problems the report leads with.
    expect(targets[0]?.id).toBe("seo.critical.thing");
  });

  it("falls back to severity when there is no ranking", () => {
    const findings = [
      finding("warn", "minor", "a.minor.thing"),
      finding("fail", "critical", "b.critical.thing"),
      finding("fail", "moderate", "c.moderate.thing"),
    ];

    expect(selectRoastTargets(findings, undefined).map((item) => item.id)).toEqual([
      "b.critical.thing",
      "c.moderate.thing",
      "a.minor.thing",
    ]);
  });

  it("breaks a tie on id, so the choice is stable", () => {
    const findings = [
      finding("fail", "serious", "z.same.severity"),
      finding("fail", "serious", "a.same.severity"),
    ];

    expect(selectRoastTargets(findings, undefined)[0]?.id).toBe("a.same.severity");
  });

  it("takes four lines by default", () => {
    const findings = Array.from({ length: 20 }, () => finding("fail"));

    expect(selectRoastTargets(findings, undefined)).toHaveLength(DEFAULT_LINE_COUNT);
  });

  it("honours a requested line count", () => {
    const findings = Array.from({ length: 20 }, () => finding("fail"));

    expect(selectRoastTargets(findings, undefined, 2)).toHaveLength(2);
  });

  it("handles a request for none, and a negative one", () => {
    const findings = Array.from({ length: 5 }, () => finding("fail"));

    expect(selectRoastTargets(findings, undefined, 0)).toEqual([]);
    expect(selectRoastTargets(findings, undefined, -3)).toEqual([]);
  });

  it("returns fewer than asked when there are fewer problems", () => {
    expect(selectRoastTargets([finding("fail")], undefined, 4)).toHaveLength(1);
  });

  it("does not mutate the findings it was given", () => {
    const findings = [
      finding("warn", "minor", "z.minor.thing"),
      finding("fail", "critical", "a.critical.thing"),
    ];
    const order = findings.map((item) => item.id);

    selectRoastTargets(findings, undefined);

    expect(findings.map((item) => item.id)).toEqual(order);
  });

  it("is deterministic", () => {
    const findings = Array.from({ length: 10 }, () => finding("fail"));

    expect(selectRoastTargets(findings, undefined)).toEqual(
      selectRoastTargets(findings, undefined),
    );
  });
});

describe("the observation", () => {
  it("states what was observed, from the finding's own evidence", () => {
    const subject = finding("fail");

    expect(observationFor(subject)).toBe("Something was observed.");
  });

  it("ends as a sentence", () => {
    const subject: Finding = {
      ...finding("fail"),
      evidence: [{ kind: "measured", source: "dom", summary: "No title was found" }],
    };

    expect(observationFor(subject)).toBe("No title was found.");
  });

  it("keeps an existing question mark", () => {
    const subject: Finding = {
      ...finding("fail"),
      evidence: [{ kind: "measured", source: "dom", summary: "Is this deliberate?" }],
    };

    expect(observationFor(subject)).toBe("Is this deliberate?");
  });

  it("never comes from a model", () => {
    // Reuses Phase 13's derivation over the finding's evidence, so the factual
    // half of a roast line is analyzer output either way.
    const subject: Finding = {
      ...finding("fail"),
      evidence: [{ kind: "measured", source: "dom", summary: "14 links in one region." }],
    };

    expect(observationFor(subject)).toContain("14 links");
  });

  it("is deterministic", () => {
    const subject = finding("fail");

    expect(observationFor(subject)).toBe(observationFor(subject));
  });
});
