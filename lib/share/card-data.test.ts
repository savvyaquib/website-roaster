import { describe, expect, it } from "vitest";

import type { AnalysisJob } from "@/lib/jobs";
import { JOB_SCHEMA_VERSION } from "@/lib/jobs";
import type { AnalysisStatus } from "@/lib/types/analysis";

import {
  MAX_CARD_CATEGORIES,
  MAX_HOST_LENGTH,
  MAX_PUNCHLINE_LENGTH,
  selectRoastLine,
  shareCardData,
  shareDescription,
  shortenHost,
} from "./card-data";

function categoryScore(category: string, score: number | null) {
  return {
    category: category as never,
    status: (score === null ? "not_assessed" : "scored") as never,
    score,
    grade: (score === null ? null : score >= 80 ? "A" : score >= 60 ? "D" : "F") as never,
    method: "deductions" as const,
    findingCount: 1,
    deductions: [],
    totalDeducted: 0,
    metrics: [],
    notAssessedReason: score === null ? "No findings were produced." : null,
    explanation: "x",
  };
}

function job(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  const now = "2026-01-01T00:00:00.000Z";

  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "completed",
    url: "https://example.com/pricing",
    submittedUrl: "https://example.com/pricing",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
    error: null,
    schemaVersion: JOB_SCHEMA_VERSION,
    report: {
      url: "https://example.com/pricing",
      finalUrl: "https://example.com/pricing",
      httpStatus: 200,
      findings: [],
      score: {
        scoringVersion: 1,
        overall: {
          score: 85,
          grade: "B",
          weighting: [],
          assessedCategories: [],
          notAssessedCategories: [],
          explanation: "x",
        },
        categories: [
          categoryScore("performance", null),
          categoryScore("seo", 73),
          categoryScore("security", 55),
          categoryScore("content", 90),
          categoryScore("ux", 97),
        ],
      } as never,
      recommendations: {
        recommendations: [],
        weightBasis: "declared",
        summary: {},
      } as never,
      roast: {
        lines: [
          {
            finding: { id: "security.https.absent" },
            observation: "The page was served over plain HTTP.",
            punchline: "Plain HTTP, in this decade, is period costume.",
          },
        ],
        source: "deterministic",
        fallbackReason: null,
        note: null,
        meta: null,
      } as never,
      interpretation: null,
      interpretationUnavailableReason: null,
      notRun: ["accessibility", "performance", "mobile"],
      durationMs: 33,
    },
    ...overrides,
  };
}

describe("what the card carries", () => {
  const data = shareCardData(job());

  it("names the site by host, not by full URL", () => {
    // A path is noise on a card; the host is what a reader recognises.
    expect(data.host).toBe("example.com");
  });

  it("carries the overall score and grade", () => {
    expect(data.score).toBe(85);
    expect(data.grade).toBe("B");
  });

  it("carries a roast line", () => {
    expect(data.roast?.punchline).toContain("period costume");
    expect(data.roast?.observation).toContain("plain HTTP");
  });

  it("says nothing about status when the analysis completed", () => {
    expect(data.statusNote).toBeNull();
  });
});

describe("which categories it shows", () => {
  it("shows only categories that were assessed", () => {
    // A card is too small to explain "not assessed", and a bare zero would be
    // a lie (ADR-021), so an unassessed category is simply left off.
    const data = shareCardData(job());

    expect(data.categories.map((category) => category.label)).toEqual([
      "Search",
      "Security",
      "Content",
      "Usability",
    ]);
  });

  it("caps at four, and says how many it left out", () => {
    const withMany = job();
    const report = withMany.report!;
    const score = report.score as unknown as { categories: unknown[] };
    score.categories = [
      categoryScore("seo", 70),
      categoryScore("security", 60),
      categoryScore("content", 80),
      categoryScore("ux", 90),
      categoryScore("mobile", 65),
      categoryScore("accessibility", 75),
    ] as never;

    const data = shareCardData(withMany);

    expect(data.categories).toHaveLength(MAX_CARD_CATEGORIES);
    expect(data.hiddenCategoryCount).toBe(2);
  });

  it("hides nothing when everything fits", () => {
    expect(shareCardData(job()).hiddenCategoryCount).toBe(0);
  });

  it("handles a report where nothing was assessed", () => {
    const bare = job();
    (bare.report!.score as unknown as { categories: unknown[] }).categories = [
      categoryScore("seo", null),
    ] as never;

    const data = shareCardData(bare);

    expect(data.categories).toEqual([]);
    expect(data.hiddenCategoryCount).toBe(0);
  });
});

describe("choosing the roast line", () => {
  it("takes the highest-ranked line", () => {
    const chosen = selectRoastLine([
      { observation: "a", punchline: "first" },
      { observation: "b", punchline: "second" },
    ]);

    expect(chosen?.punchline).toBe("first");
  });

  it("skips a line too long to set, rather than cutting off the joke", () => {
    // A punchline with its ending removed is not a punchline.
    const chosen = selectRoastLine([
      { observation: "a", punchline: "x".repeat(MAX_PUNCHLINE_LENGTH + 1) },
      { observation: "b", punchline: "a short one" },
    ]);

    expect(chosen?.punchline).toBe("a short one");
  });

  it("truncates only when every line is too long", () => {
    const chosen = selectRoastLine([
      { observation: "a", punchline: "y".repeat(MAX_PUNCHLINE_LENGTH + 50) },
    ]);

    expect(chosen?.punchline.length).toBe(MAX_PUNCHLINE_LENGTH);
    expect(chosen?.punchline.endsWith("…")).toBe(true);
  });

  it("accepts a line exactly at the limit", () => {
    const exact = "z".repeat(MAX_PUNCHLINE_LENGTH);

    expect(selectRoastLine([{ observation: "a", punchline: exact }])?.punchline).toBe(
      exact,
    );
  });

  it("returns nothing when there is nothing to roast", () => {
    expect(selectRoastLine([])).toBeNull();
  });
});

describe("long hosts", () => {
  it("leaves a normal host alone", () => {
    expect(shortenHost("example.com")).toBe("example.com");
  });

  it("keeps the end, which is the part that identifies a site", () => {
    const long = "some-startup-with-a-longish-name.example.io";
    const short = shortenHost(long);

    expect(short.length).toBeLessThanOrEqual(MAX_HOST_LENGTH);
    expect(short).toContain("…");
    expect(short.endsWith("example.io")).toBe(true);
  });

  it("accepts a host exactly at the limit", () => {
    const exact = "a".repeat(MAX_HOST_LENGTH);

    expect(shortenHost(exact)).toBe(exact);
  });

  it("is applied to the card's host", () => {
    const long = job({
      url: "https://some-startup-with-a-really-long-name.example.io/",
    });

    expect(shareCardData(long).host.length).toBeLessThanOrEqual(MAX_HOST_LENGTH);
  });
});

describe("an analysis with no report", () => {
  it.each([
    ["blocked", "Address refused"],
    ["invalid_url", "Not a usable URL"],
    ["timeout", "Timed out"],
    ["failed", "Analysis failed"],
  ] as const)("says what happened for %s", (status, note) => {
    // A shared link that previews as a blank card is worse than one that says
    // the analysis did not finish.
    const data = shareCardData(
      job({ status: status as AnalysisStatus, report: null, url: null }),
    );

    expect(data.statusNote).toBe(note);
    expect(data.score).toBeNull();
    expect(data.categories).toEqual([]);
    expect(data.roast).toBeNull();
  });

  it("falls back to what the user submitted when there is no validated URL", () => {
    const refused = job({
      report: null,
      url: null,
      submittedUrl: "not a url",
      status: "invalid_url",
    });

    expect(shareCardData(refused).host).toBe("not a url");
  });
});

describe("the link preview description", () => {
  it("leads with the roast, which is the reason to click", () => {
    expect(shareDescription(shareCardData(job()))).toContain("period costume");
  });

  it("falls back to the score when there is no roast", () => {
    const clean = job();
    (clean.report!.roast as unknown as { lines: unknown[] }).lines = [];

    expect(shareDescription(shareCardData(clean))).toContain("scored 85");
  });

  it("says the analysis did not finish when it did not", () => {
    const blocked = shareCardData(job({ status: "blocked", report: null, url: null }));

    expect(shareDescription(blocked)).toContain("did not finish");
  });

  it("is never empty", () => {
    for (const status of ["completed", "blocked", "failed"] as const) {
      const data = shareCardData(
        job(status === "completed" ? {} : { status, report: null, url: null }),
      );

      expect(shareDescription(data).length).toBeGreaterThan(10);
    }
  });
});

describe("stability", () => {
  it("produces the same card for the same job", () => {
    // A link must preview the same way every time somebody posts it.
    expect(shareCardData(job())).toEqual(shareCardData(job()));
  });
});
