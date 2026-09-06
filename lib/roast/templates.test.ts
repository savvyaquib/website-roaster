import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ANALYSIS_CATEGORIES, FINDING_SEVERITIES } from "@/lib/types/finding";
import type { Finding } from "@/lib/types/finding";

import { ABUSE_PATTERNS } from "./verify";
import {
  CATEGORY_PUNCHLINES,
  punchlineFor,
  SEVERITY_PUNCHLINES,
  SPECIFIC_PUNCHLINES,
} from "./templates";

const allPunchlines = [
  ...Object.values(SPECIFIC_PUNCHLINES),
  ...Object.values(CATEGORY_PUNCHLINES),
  ...Object.values(SEVERITY_PUNCHLINES),
];

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "seo.title.missing",
    category: "seo",
    severity: "serious",
    status: "fail",
    evidence: [{ kind: "measured", source: "dom", summary: "No title." }],
    explanation: "An explanation.",
    ...overrides,
  };
}

describe("every template is usable", () => {
  it("has something for every category", () => {
    for (const category of ANALYSIS_CATEGORIES) {
      expect(CATEGORY_PUNCHLINES[category]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("has something for every severity", () => {
    for (const severity of FINDING_SEVERITIES) {
      expect(SEVERITY_PUNCHLINES[severity]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("is short enough to read at a glance", () => {
    for (const punchline of allPunchlines) {
      expect(punchline.length, punchline).toBeLessThanOrEqual(140);
    }
  });

  it("reads as a finished sentence", () => {
    for (const punchline of allPunchlines) {
      expect(/[.!?"]$/.test(punchline), punchline).toBe(true);
    }
  });

  it("has no duplicates", () => {
    // Two findings sharing a joke makes a roast look broken.
    expect(new Set(allPunchlines).size).toBe(allPunchlines.length);
  });
});

describe("no template states a fact", () => {
  it("contains no measurement", () => {
    // The observation carries the facts. A template that repeated one could be
    // wrong about a page it has never seen.
    for (const punchline of allPunchlines) {
      expect(
        /\b\d+(?:[.,]\d+)?\s?(?:ms|s|kb|mb|gb|px|percent)\b|%/i.test(punchline),
        punchline,
      ).toBe(false);
    }
  });

  it("contains no digits at all", () => {
    for (const punchline of allPunchlines) {
      expect(/\d/.test(punchline), punchline).toBe(false);
    }
  });

  it("makes no security claim", () => {
    for (const punchline of allPunchlines) {
      const lower = punchline.toLowerCase();
      expect(lower.includes("is secure"), punchline).toBe(false);
      expect(lower.includes("vulnerable"), punchline).toBe(false);
      expect(lower.includes("hacked"), punchline).toBe(false);
    }
  });

  it("promises no ranking", () => {
    for (const punchline of allPunchlines) {
      const lower = punchline.toLowerCase();
      expect(lower.includes("will rank"), punchline).toBe(false);
      expect(lower.includes("guarantee"), punchline).toBe(false);
    }
  });
});

describe("no template is abusive", () => {
  it("contains no personal insult", () => {
    // ADR-015: non-abusive. The website is the target; a person never is.
    for (const punchline of allPunchlines) {
      const words = new Set(punchline.toLowerCase().split(/[^a-z'-]+/));

      for (const insult of ABUSE_PATTERNS.personalInsults) {
        const hit = insult.includes(" ")
          ? punchline.toLowerCase().includes(insult)
          : words.has(insult);

        expect(hit, `"${punchline}" contains "${insult}"`).toBe(false);
      }
    }
  });

  it("is not aimed at the reader", () => {
    for (const punchline of allPunchlines) {
      for (const pattern of ABUSE_PATTERNS.personalAttacks) {
        expect(pattern.test(punchline), `"${punchline}" matches ${pattern}`).toBe(false);
      }
    }
  });

  it("would pass its own verifier", () => {
    // The templates are held to the standard the model is held to.
    for (const punchline of allPunchlines) {
      expect(punchline.length).toBeLessThanOrEqual(240);
    }
  });
});

describe("specific templates point at findings that exist", () => {
  /**
   * Finding ids written literally in the analyzers.
   *
   * Guards against a typo silently disabling a template, and against an
   * analyzer renaming an id without the roast noticing.
   */
  function analyzerFindingIds(): Set<string> {
    const ids = new Set<string>();
    const root = path.join(process.cwd(), "lib", "analysis");

    function walk(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          for (const match of readFileSync(full, "utf8").matchAll(
            /"([a-z_]+\.[a-z_]+\.[a-z_]+)"/g,
          )) {
            ids.add(match[1]!);
          }
        }
      }
    }

    walk(root);
    return ids;
  }

  it("finds ids to check against", () => {
    expect(analyzerFindingIds().size).toBeGreaterThan(50);
  });

  it("names only real findings", () => {
    const known = analyzerFindingIds();

    const unknown = Object.keys(SPECIFIC_PUNCHLINES).filter((id) => {
      // Accessibility ids are built at runtime from the audit engine's rule
      // names, so they never appear literally in our source.
      if (id.startsWith("accessibility.axe.")) return false;
      return !known.has(id);
    });

    expect(unknown).toEqual([]);
  });
});

describe("punchlineFor", () => {
  it("prefers the specific template", () => {
    expect(punchlineFor(finding({ id: "seo.title.missing" }))).toBe(
      SPECIFIC_PUNCHLINES["seo.title.missing"],
    );
  });

  it("falls back to the category when there is no specific one", () => {
    expect(punchlineFor(finding({ id: "seo.unheard.of", category: "seo" }))).toBe(
      CATEGORY_PUNCHLINES.seo,
    );
  });

  it("falls back to severity when the category is unknown", () => {
    expect(
      punchlineFor(
        finding({
          id: "nonsense.unheard.of",
          category: "nonsense" as never,
          severity: "critical",
        }),
      ),
    ).toBe(SEVERITY_PUNCHLINES.critical);
  });

  it("always returns something", () => {
    for (const category of ANALYSIS_CATEGORIES) {
      for (const severity of FINDING_SEVERITIES) {
        expect(
          punchlineFor(finding({ id: "x.y.z", category, severity })).length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("is deterministic", () => {
    const subject = finding();

    expect(punchlineFor(subject)).toBe(punchlineFor(subject));
  });
});
