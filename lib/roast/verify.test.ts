import { describe, expect, it } from "vitest";

import type { JsonValue } from "@/lib/ai/types";
import type { Finding, FindingStatus } from "@/lib/types/finding";

import type { RoastDraft } from "./types";
import { ABUSE_PATTERNS, verifyRoast } from "./verify";

function finding(id: string, status: FindingStatus = "fail"): Finding {
  return {
    id,
    category: "seo",
    severity: "serious",
    status,
    evidence: [{ kind: "measured", source: "dom", summary: "Observed." }],
    explanation: "An explanation.",
  };
}

const selectedById = new Map<string, Finding>([
  ["seo.title.missing", finding("seo.title.missing")],
  ["ux.navigation.busy", finding("ux.navigation.busy")],
]);

const evidence: JsonValue = {
  findings: [
    { id: "seo.title.missing", observation: "The page has no title." },
    { id: "ux.navigation.busy", observation: "14 links were found in one region." },
  ],
};

function draft(lines: RoastDraft["lines"]): RoastDraft {
  return { lines };
}

function verify(lines: RoastDraft["lines"]) {
  return verifyRoast({ draft: draft(lines), selectedById, evidence });
}

const good = [
  {
    findingId: "seo.title.missing",
    punchline: "A bold choice: a page that declines to introduce itself.",
  },
  {
    findingId: "ux.navigation.busy",
    punchline: "Every link received an invitation. Nobody checked the room's capacity.",
  },
];

describe("a well-behaved roast", () => {
  it("passes", () => {
    expect(verify(good)).toEqual([]);
  });

  it("passes with a single line", () => {
    expect(verify([good[0]!])).toEqual([]);
  });

  it("passes with no lines", () => {
    expect(verify([])).toEqual([]);
  });
});

describe("the roast may not choose its own subject", () => {
  it("refuses a finding it was not given", () => {
    // Even a real finding, if this roast was not asked about it: choosing the
    // subject is where fabrication starts.
    const violations = verify([
      { findingId: "security.https.absent", punchline: "Period costume." },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("unknown_finding");
    expect(violations[0]?.detail).toContain("may not choose its own subject");
  });

  it("refuses an invented finding id", () => {
    const violations = verify([
      { findingId: "seo.entirely.invented", punchline: "A joke about nothing." },
    ]);

    expect(violations[0]?.kind).toBe("unknown_finding");
  });

  it("names the offending line", () => {
    const violations = verify([good[0]!, { findingId: "nope", punchline: "Ha." }]);

    expect(violations[0]?.location).toBe("lines[1].findingId");
  });
});

describe("abuse", () => {
  it.each(ABUSE_PATTERNS.personalInsults)("refuses %s", (insult) => {
    // ADR-015: non-abusive. Aim at the decision, not the decider.
    const violations = verify([
      { findingId: "seo.title.missing", punchline: `This is ${insult} work, frankly.` },
    ]);

    expect(violations.some((v) => v.kind === "abusive_tone")).toBe(true);
  });

  it.each([
    "You are clearly not a designer.",
    "You're going to want to sit down for this one.",
    "Whoever built this had other priorities.",
    "The person who signed this off owes someone an apology.",
  ])("refuses a line aimed at a person: %s", (punchline) => {
    const violations = verify([{ findingId: "seo.title.missing", punchline }]);

    expect(violations.some((v) => v.kind === "abusive_tone")).toBe(true);
  });

  it("allows second-person possessive, which is about the page", () => {
    // "Your navigation" is the site. "You are" is the person.
    expect(
      verify([
        {
          findingId: "seo.title.missing",
          punchline: "Your homepage keeps its name to itself, which is one approach.",
        },
      ]),
    ).toEqual([]);
  });

  it("does not fire on a word that merely contains an insult", () => {
    // "assumption" contains "ass"; "dumbbell" contains "dumb". Whole words only.
    expect(
      verify([
        {
          findingId: "seo.title.missing",
          punchline: "The page runs on assumption rather than explanation.",
        },
      ]),
    ).toEqual([]);
  });

  it("catches an insult regardless of case", () => {
    const violations = verify([
      { findingId: "seo.title.missing", punchline: "Frankly STUPID markup choices." },
    ]);

    expect(violations.some((v) => v.kind === "abusive_tone")).toBe(true);
  });
});

describe("repetition", () => {
  it("refuses the same joke twice", () => {
    const violations = verify([
      { findingId: "seo.title.missing", punchline: "The same joke, twice." },
      { findingId: "ux.navigation.busy", punchline: "The same joke, twice." },
    ]);

    expect(violations.some((v) => v.kind === "repeated_punchline")).toBe(true);
  });

  it("catches a repeat differing only in punctuation or case", () => {
    const violations = verify([
      { findingId: "seo.title.missing", punchline: "The same joke, twice." },
      { findingId: "ux.navigation.busy", punchline: "the same joke twice!" },
    ]);

    expect(violations.some((v) => v.kind === "repeated_punchline")).toBe(true);
  });

  it("allows two different jokes", () => {
    expect(verify(good)).toEqual([]);
  });
});

describe("it reuses Phase 14's prose checks", () => {
  it("refuses an invented measurement", () => {
    const violations = verify([
      {
        findingId: "seo.title.missing",
        punchline: "Loading in 9.4s is a commitment to the slow web.",
      },
    ]);

    expect(violations.some((v) => v.kind === "invented_measurement")).toBe(true);
  });

  it("allows a number that is in the evidence", () => {
    expect(
      verify([
        {
          findingId: "ux.navigation.busy",
          punchline: "All 14 links, competing for the same square inch.",
        },
      ]),
    ).toEqual([]);
  });

  it("refuses a security assurance", () => {
    const violations = verify([
      {
        findingId: "seo.title.missing",
        punchline: "At least the site is secure, which is something.",
      },
    ]);

    expect(violations.some((v) => v.kind === "unsupported_security_claim")).toBe(true);
  });

  it("refuses a ranking promise", () => {
    const violations = verify([
      {
        findingId: "seo.title.missing",
        punchline: "Add one and you will rank by Friday.",
      },
    ]);

    expect(violations.some((v) => v.kind === "unsupported_seo_claim")).toBe(true);
  });
});

describe("the verifier", () => {
  it("reports several kinds at once", () => {
    const violations = verify([
      { findingId: "made.up", punchline: "You are stupid and it loads in 9.4s." },
    ]);

    const kinds = new Set(violations.map((violation) => violation.kind));

    expect(kinds).toContain("unknown_finding");
    expect(kinds).toContain("abusive_tone");
    expect(kinds).toContain("invented_measurement");
  });

  it("is deterministic", () => {
    const input = { draft: draft(good), selectedById, evidence };

    expect(verifyRoast(input)).toEqual(verifyRoast(input));
  });

  it("truncates a long excerpt", () => {
    const violations = verify([{ findingId: "made.up", punchline: "x".repeat(2000) }]);

    expect((violations[0]?.excerpt ?? "").length).toBeLessThan(200);
  });
});
