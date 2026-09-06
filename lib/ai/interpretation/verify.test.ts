import { describe, expect, it } from "vitest";

import type { JsonValue } from "@/lib/ai/types";
import type { Finding, FindingStatus } from "@/lib/types/finding";

import type { InterpretationDraft } from "./types";
import { PROHIBITED_PHRASES, verifyInterpretation } from "./verify";

function finding(id: string, status: FindingStatus): Finding {
  return {
    id,
    category: "seo",
    severity: status === "pass" ? "info" : "serious",
    status,
    evidence: [{ kind: "measured", source: "dom", summary: "Observed something." }],
    explanation: "An explanation.",
    recommendation: "A recommendation.",
  };
}

const findingsById = new Map<string, Finding>([
  ["seo.title.missing", finding("seo.title.missing", "fail")],
  ["seo.description.long", finding("seo.description.long", "warn")],
  ["seo.canonical.ok", finding("seo.canonical.ok", "pass")],
  ["security.csp.unknown", finding("security.csp.unknown", "could_not_determine")],
]);

const evidence: JsonValue = {
  url: "https://example.com/",
  score: { overall: { score: 64 } },
  problems: [
    { id: "seo.title.missing", severity: "serious" },
    { id: "seo.description.long", severity: "minor" },
  ],
  metrics: { lcpMs: 2400, totalByteWeight: 1800000, imageSavings: "48%" },
};

function draft(overrides: Partial<InterpretationDraft> = {}): InterpretationDraft {
  return {
    executiveSummary:
      "This page covers the basics but leaves search engines guessing about what it is for.",
    strengths: [{ findingId: "seo.canonical.ok", whyItHelps: "Duplicates stay merged." }],
    problems: [
      {
        findingId: "seo.title.missing",
        whyItMatters: "Nothing tells a search result what this page is.",
        recommendation: "Add a title describing the page in under 60 characters.",
      },
    ],
    ...overrides,
  };
}

function verify(overrides: Partial<InterpretationDraft> = {}) {
  return verifyInterpretation({ draft: draft(overrides), evidence, findingsById });
}

// ---------------------------------------------------------------------------

describe("a well-behaved answer", () => {
  it("passes", () => {
    expect(verify()).toEqual([]);
  });

  it("passes with no strengths at all", () => {
    // Returning nothing is the honest answer when the evidence supports none.
    expect(verify({ strengths: [] })).toEqual([]);
  });
});

describe("invented technical findings", () => {
  it("refuses a problem referencing a finding that was never supplied", () => {
    const violations = verify({
      problems: [
        {
          findingId: "seo.invented.problem",
          whyItMatters: "It sounds bad.",
          recommendation: "Fix it.",
        },
      ],
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("unknown_finding");
    expect(violations[0]?.location).toBe("problems[0].findingId");
    expect(violations[0]?.excerpt).toContain("seo.invented.problem");
  });

  it("refuses a strength referencing a finding that was never supplied", () => {
    const violations = verify({
      strengths: [{ findingId: "made.up.pass", whyItHelps: "Great work." }],
    });

    expect(violations[0]?.kind).toBe("unknown_finding");
  });

  it("reports every invented reference, not just the first", () => {
    const violations = verify({
      problems: [
        { findingId: "a.b.c", whyItMatters: "x", recommendation: "y" },
        { findingId: "d.e.f", whyItMatters: "x", recommendation: "y" },
      ],
    });

    expect(violations).toHaveLength(2);
  });
});

describe("contradicting the evidence", () => {
  it("refuses a passing check presented as a problem", () => {
    const violations = verify({
      problems: [
        {
          findingId: "seo.canonical.ok",
          whyItMatters: "The canonical is broken.",
          recommendation: "Fix the canonical.",
        },
      ],
    });

    expect(violations[0]?.kind).toBe("contradicts_status");
    expect(violations[0]?.detail).toContain("passed");
  });

  it("refuses a failing check presented as a strength", () => {
    const violations = verify({
      strengths: [{ findingId: "seo.title.missing", whyItHelps: "The title is great." }],
    });

    expect(violations[0]?.kind).toBe("contradicts_status");
    expect(violations[0]?.detail).toContain("did not pass");
  });

  it("refuses an undetermined check presented as a problem", () => {
    // ADR-021: a check that established nothing establishes no problem either.
    const violations = verify({
      problems: [
        {
          findingId: "security.csp.unknown",
          whyItMatters: "The CSP is missing.",
          recommendation: "Add one.",
        },
      ],
    });

    expect(violations[0]?.kind).toBe("contradicts_status");
    expect(violations[0]?.detail).toContain("could not be determined");
  });

  it("refuses an undetermined check presented as a strength", () => {
    const violations = verify({
      strengths: [{ findingId: "security.csp.unknown", whyItHelps: "Good CSP." }],
    });

    expect(violations[0]?.kind).toBe("contradicts_status");
  });
});

describe("invented metrics", () => {
  it("refuses a measurement that appears nowhere in the evidence", () => {
    const violations = verify({
      executiveSummary: "The page takes 9.7s to load, which is far too slow for anyone.",
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("invented_measurement");
    expect(violations[0]?.detail).toContain("9.7s");
  });

  it("accepts a measurement that is in the evidence", () => {
    // 2400 is in the evidence as lcpMs.
    expect(
      verify({ executiveSummary: "Largest paint lands at 2400ms, inside target." }),
    ).toEqual([]);
  });

  it("accepts a measurement written with different spacing or punctuation", () => {
    expect(
      verify({ executiveSummary: "Image savings of 48 % are available here now." }),
    ).toEqual([]);
  });

  it("does not treat a bare count as a measurement", () => {
    // "3 problems" is prose, not a claim about the page's behaviour.
    expect(
      verify({
        executiveSummary: "There are 3 problems worth fixing and 2 things done well.",
      }),
    ).toEqual([]);
  });

  it("checks recommendations and strengths, not only the summary", () => {
    const violations = verify({
      problems: [
        {
          findingId: "seo.title.missing",
          whyItMatters: "Nothing describes the page.",
          recommendation: "Cut the 4.5MB of images down first.",
        },
      ],
    });

    expect(violations[0]?.kind).toBe("invented_measurement");
    expect(violations[0]?.location).toBe("problems[0].recommendation");
  });

  it.each(["9.7s", "830ms", "12MB", "640px", "93%"])(
    "catches an invented %s",
    (measurement) => {
      const violations = verify({
        executiveSummary: `The page reports ${measurement} on this measurement here.`,
      });

      expect(violations.some((v) => v.kind === "invented_measurement")).toBe(true);
    },
  );
});

describe("unsupported security claims", () => {
  it.each(PROHIBITED_PHRASES.securityAssurances)("refuses %s", (phrase) => {
    // CLAUDE.md: the AI must never claim a website is secure.
    const violations = verify({
      executiveSummary: `Overall this site ${phrase} and the basics are handled well.`,
    });

    expect(violations.some((v) => v.kind === "unsupported_security_claim")).toBe(true);
  });

  it.each(PROHIBITED_PHRASES.vulnerabilityNames)(
    "refuses naming %s when no finding raised it",
    (phrase) => {
      const violations = verify({
        executiveSummary: `The review suggests ${phrase} is a concern on this page.`,
      });

      expect(violations.some((v) => v.kind === "unsupported_security_claim")).toBe(true);
    },
  );

  it("allows a vulnerability name a supplied finding raised first", () => {
    // If an analyzer named it, discussing it is interpretation, not invention.
    const withEvidence: JsonValue = {
      problems: [{ id: "security.xss.reflected", explanation: "Possible xss vector." }],
    };

    const violations = verifyInterpretation({
      draft: draft({
        executiveSummary: "The reported xss vector deserves attention before anything.",
      }),
      evidence: withEvidence,
      findingsById,
    });

    expect(violations.filter((v) => v.kind === "unsupported_security_claim")).toEqual([]);
  });

  it("catches the claim wherever it appears", () => {
    const violations = verify({
      problems: [
        {
          findingId: "seo.title.missing",
          whyItMatters: "Otherwise the site is secure and needs no attention.",
          recommendation: "Add a title.",
        },
      ],
    });

    expect(violations[0]?.location).toBe("problems[0].whyItMatters");
  });

  it("is not fooled by capitalisation or extra spacing", () => {
    expect(
      verify({
        executiveSummary: "This  site   IS  SECURE, so relax about all that.",
      }).some((v) => v.kind === "unsupported_security_claim"),
    ).toBe(true);
  });
});

describe("unsupported SEO claims", () => {
  it.each(PROHIBITED_PHRASES.seoPromises)("refuses %s", (phrase) => {
    const violations = verify({
      executiveSummary: `Do this and you ${phrase} before very long at all.`,
    });

    expect(violations.some((v) => v.kind === "unsupported_seo_claim")).toBe(true);
  });

  it("allows describing what a change addresses", () => {
    expect(
      verify({
        executiveSummary:
          "A descriptive title gives search engines something to show in results.",
      }),
    ).toEqual([]);
  });

  it("catches a promise inside a recommendation", () => {
    const violations = verify({
      problems: [
        {
          findingId: "seo.title.missing",
          whyItMatters: "Nothing describes the page.",
          recommendation: "Add a title and you will rank for your brand name.",
        },
      ],
    });

    expect(violations[0]?.kind).toBe("unsupported_seo_claim");
    expect(violations[0]?.location).toBe("problems[0].recommendation");
  });
});

describe("empty answers", () => {
  it("refuses a summary too short to say anything", () => {
    const violations = verify({ executiveSummary: "It is fine." });

    expect(violations[0]?.kind).toBe("empty_content");
  });
});

describe("the verifier itself", () => {
  it("reports several kinds of violation at once", () => {
    const violations = verify({
      executiveSummary: "This site is secure and loads in 9.7s, guaranteed to rank well.",
      problems: [
        { findingId: "does.not.exist", whyItMatters: "Bad.", recommendation: "Fix." },
      ],
    });

    const kinds = new Set(violations.map((violation) => violation.kind));

    expect(kinds).toContain("unknown_finding");
    expect(kinds).toContain("invented_measurement");
    expect(kinds).toContain("unsupported_security_claim");
    expect(kinds).toContain("unsupported_seo_claim");
  });

  it("is deterministic", () => {
    const input = { draft: draft(), evidence, findingsById };

    expect(verifyInterpretation(input)).toEqual(verifyInterpretation(input));
  });

  it("locates every violation precisely enough to act on", () => {
    const violations = verify({
      strengths: [{ findingId: "nope", whyItHelps: "Good." }],
      problems: [
        { findingId: "also.nope", whyItMatters: "Bad.", recommendation: "Fix." },
      ],
    });

    expect(violations.map((violation) => violation.location)).toEqual([
      "problems[0].findingId",
      "strengths[0].findingId",
    ]);
  });

  it("truncates the excerpt rather than echoing a long answer", () => {
    const violations = verify({
      problems: [
        {
          findingId: "unknown.id",
          whyItMatters: "x".repeat(2000),
          recommendation: "y",
        },
      ],
    });

    expect((violations[0]?.excerpt ?? "").length).toBeLessThan(200);
  });
});
