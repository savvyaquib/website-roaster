import { describe, expect, it } from "vitest";

import type { Evidence, Finding } from "@/lib/types/finding";

import { deriveTitle, MAX_TITLE_LENGTH } from "./title";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "seo.canonical.missing",
    category: "seo",
    severity: "minor",
    status: "warn",
    evidence: [
      {
        kind: "measured",
        source: "dom",
        summary: 'There is no <link rel="canonical"> tag.',
      },
    ],
    explanation: "Without a canonical URL, duplicates can be treated as separate pages.",
    recommendation: "Add a canonical link.",
    ...overrides,
  };
}

const evidence = (summary: string): Evidence[] => [
  { kind: "measured", source: "dom", summary },
];

describe("deriveTitle", () => {
  it("uses the first evidence summary", () => {
    expect(deriveTitle(finding())).toEqual({
      title: 'There is no <link rel="canonical"> tag',
      source: "evidence",
    });
  });

  it("drops a single trailing full stop", () => {
    expect(
      deriveTitle(finding({ evidence: evidence("The page has no H1.") })).title,
    ).toBe("The page has no H1");
  });

  it("keeps a question or exclamation mark", () => {
    // Removing it would change what the sentence is doing.
    expect(deriveTitle(finding({ evidence: evidence("Is this intended?") })).title).toBe(
      "Is this intended?",
    );
  });

  it("takes only the first sentence", () => {
    const long = "The title is 12 characters. Search results usually show about 60.";

    expect(deriveTitle(finding({ evidence: evidence(long) })).title).toBe(
      "The title is 12 characters",
    );
  });

  it("does not split on a decimal point or a domain name", () => {
    // A full stop only ends a sentence when whitespace or the end follows it.
    expect(
      deriveTitle(finding({ evidence: evidence("LCP was 3.5s on example.com.") })).title,
    ).toBe("LCP was 3.5s on example.com");
  });

  it("collapses newlines and runs of whitespace", () => {
    expect(
      deriveTitle(finding({ evidence: evidence("  The page\n\thas   no H1  ") })).title,
    ).toBe("The page has no H1");
  });

  it("capitalises a lowercase summary", () => {
    expect(
      deriveTitle(finding({ evidence: evidence("no viewport meta tag") })).title,
    ).toBe("No viewport meta tag");
  });

  it("truncates a long summary at a word boundary", () => {
    const long = `${"word ".repeat(40)}end.`;
    const { title } = deriveTitle(finding({ evidence: evidence(long) }));

    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("wor…");
  });

  it("truncates mid-word when a single word exceeds the cap", () => {
    const { title } = deriveTitle(finding({ evidence: evidence("x".repeat(200)) }));

    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
  });

  it("skips an empty evidence summary and uses the next one", () => {
    const { title, source } = deriveTitle(
      finding({
        evidence: [
          { kind: "measured", source: "dom", summary: "   " },
          { kind: "measured", source: "dom", summary: "The page has no H1." },
        ],
      }),
    );

    expect(title).toBe("The page has no H1");
    expect(source).toBe("evidence");
  });

  it("falls back to the explanation when there is no usable evidence", () => {
    const { title, source } = deriveTitle(
      finding({ evidence: [], explanation: "The page cannot be indexed. More detail." }),
    );

    expect(title).toBe("The page cannot be indexed");
    expect(source).toBe("explanation");
  });

  it("falls back to the identifier when there is neither", () => {
    const { title, source } = deriveTitle(
      finding({ id: "seo.robots_meta.noindex", evidence: [], explanation: "" }),
    );

    // The category prefix is dropped; the recommendation already carries it.
    expect(title).toBe("Robots meta noindex");
    expect(source).toBe("identifier");
  });

  it("never returns an empty title", () => {
    const { title } = deriveTitle(finding({ id: "x", evidence: [], explanation: "   " }));

    expect(title.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const subject = finding();

    expect(deriveTitle(subject)).toEqual(deriveTitle(subject));
  });
});
