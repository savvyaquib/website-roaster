import { describe, expect, it } from "vitest";

import { GRADE_BANDS, gradeFor } from "@/lib/scoring";
import { ANALYSIS_STATUSES } from "@/lib/types/analysis";
import {
  ANALYSIS_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
} from "@/lib/types/finding";

import {
  BAND_MARKS,
  categoryLabel,
  formatDuration,
  hostOf,
  severityLabel,
  statusCopy,
  statusLabel,
  TEXT_TONE,
  toneForGrade,
  toneForScore,
  toneForSeverity,
  TRACK_TONE,
} from "./format";

describe("tone follows the scoring model", () => {
  it.each([
    [100, "good"],
    [90, "good"],
    [80, "good"],
    [79, "fair"],
    [60, "fair"],
    [59, "poor"],
    [0, "poor"],
  ] as const)("gives %i the tone %s", (score, tone) => {
    expect(toneForScore(score)).toBe(tone);
  });

  it("never colours an unassessed score as poor", () => {
    // Null is not zero, and must not look like a failure (ADR-021).
    expect(toneForScore(null)).toBe("unknown");
    expect(toneForGrade(null)).toBe("unknown");
  });

  it("agrees with the grade the scoring engine assigns", () => {
    for (let score = 0; score <= 100; score += 1) {
      expect(toneForScore(score)).toBe(toneForGrade(gradeFor(score)));
    }
  });

  it("treats a non-finite score as unassessed rather than as zero", () => {
    expect(toneForScore(Number.NaN)).toBe("unknown");
  });

  it.each(FINDING_SEVERITIES)("gives %s a tone", (severity) => {
    expect(["good", "fair", "poor", "unknown"]).toContain(toneForSeverity(severity));
  });

  it("never colours an info finding as a problem", () => {
    expect(toneForSeverity("info")).toBe("unknown");
  });

  it("has a class for every tone", () => {
    for (const tone of ["good", "fair", "poor", "unknown"] as const) {
      expect(TEXT_TONE[tone].length).toBeGreaterThan(0);
      expect(TRACK_TONE[tone].length).toBeGreaterThan(0);
    }
  });
});

describe("the band marks", () => {
  it("are the documented grade boundaries", () => {
    expect(BAND_MARKS.map((band) => band.at)).toEqual([60, 70, 80, 90]);
  });

  it("come from the scoring engine, not from numbers typed here", () => {
    const declared = GRADE_BANDS.map((band) => band.min)
      .filter((min) => min > 0)
      .sort((a, b) => a - b);

    expect(BAND_MARKS.map((band) => band.at)).toEqual(declared);
  });

  it("omit zero, which is the start of the scale rather than a boundary", () => {
    expect(BAND_MARKS.some((band) => band.at === 0)).toBe(false);
  });
});

describe("labels", () => {
  it.each(ANALYSIS_CATEGORIES)("names the %s category in plain words", (category) => {
    const label = categoryLabel(category);

    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toContain("_");
  });

  it("prefers a reader's word to the internal one", () => {
    expect(categoryLabel("seo")).toBe("Search");
    expect(categoryLabel("ux")).toBe("Usability");
  });

  it("passes an unknown category through rather than losing it", () => {
    expect(categoryLabel("something-new")).toBe("something-new");
  });

  it.each(FINDING_STATUSES)("names the %s outcome without an underscore", (status) => {
    expect(statusLabel(status)).not.toContain("_");
  });

  it.each(FINDING_SEVERITIES)("capitalises %s", (severity) => {
    expect(severityLabel(severity)[0]).toBe(severityLabel(severity)[0]?.toUpperCase());
  });
});

describe("status copy", () => {
  it.each(ANALYSIS_STATUSES)("says something specific about %s", (status) => {
    const copy = statusCopy(status);

    expect(copy.heading.length).toBeGreaterThan(0);
    expect(copy.detail.length).toBeGreaterThan(10);
  });

  it("gives every status its own heading", () => {
    const headings = ANALYSIS_STATUSES.map((status) => statusCopy(status).heading);

    // Seven states exist because they mean seven different things (ADR-011).
    expect(new Set(headings).size).toBe(headings.length);
  });

  it("tells a person what to do about a URL they can fix", () => {
    expect(statusCopy("invalid_url").detail).toContain("http");
  });

  it("explains a refusal without blaming the user", () => {
    expect(statusCopy("blocked").detail).toContain("private, local or internal");
  });
});

describe("formatting", () => {
  it.each([
    [0, "0ms"],
    [450, "450ms"],
    [999, "999ms"],
    [1000, "1.0s"],
    [2400, "2.4s"],
    [9900, "9.9s"],
    [10_000, "10s"],
    [61_500, "62s"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it("reads a host out of a URL", () => {
    expect(hostOf("https://example.com/a/b?c=d")).toBe("example.com");
    expect(hostOf("https://example.com:8443/")).toBe("example.com:8443");
  });

  it("returns the input when it is not a URL, rather than throwing", () => {
    expect(hostOf("not a url")).toBe("not a url");
  });
});
