import { describe, expect, it } from "vitest";

import type { Finding } from "@/lib/types/finding";

import { analyzeUx } from "./analyze-ux";
import { collectUxSignals } from "./collect-signals";
import {
  BUSY_NAVIGATION_LINKS,
  HIGH_REPETITION,
  LONG_FORM_FIELDS,
  MANY_PRIMARY_ACTIONS,
} from "./thresholds";
import type { UxSignals } from "./types";

const PAGE_URL = "https://example.com/";

/** Signals for a page with nothing remarkable, so a test can vary one thing. */
function signals(overrides: Partial<UxSignals> = {}): UxSignals {
  return {
    url: PAGE_URL,
    navigation: {
      regionCount: 1,
      totalLinks: 5,
      maxLinksInOneRegion: 5,
      maxNestingDepth: 1,
      duplicateDestinations: 0,
    },
    actions: {
      buttons: 2,
      buttonStyledLinks: 1,
      primaryStyled: 1,
      submitControls: 1,
      candidateActions: 3,
    },
    density: {
      interactiveElements: 12,
      links: 9,
      wordCount: 500,
      interactivePer100Words: 2.4,
      linksPer100Words: 1.8,
    },
    headings: {
      countsByLevel: [1, 3, 2, 0, 0, 0],
      total: 6,
      h1Count: 1,
      skippedLevels: 0,
      deepestLevel: 3,
      firstLevel: 1,
    },
    hierarchy: {
      maxDomDepth: 8,
      landmarkCount: 4,
      hasMainLandmark: true,
      paragraphCount: 12,
      listCount: 2,
      headingToParagraphRatio: 0.5,
    },
    forms: {
      formCount: 1,
      totalFields: 3,
      maxFieldsInOneForm: 3,
      requiredFields: 2,
      formsWithoutSubmit: 0,
    },
    repetition: {
      repeatedBlocks: [{ signature: "div.card", count: 3 }],
      maxRepetition: 3,
      repeatedLinkTexts: [],
    },
    ...overrides,
  };
}

function analyze(overrides: Partial<UxSignals> = {}): Finding[] {
  return analyzeUx({ signals: signals(overrides) });
}

function byId(findings: readonly Finding[], id: string): Finding | undefined {
  return findings.find((finding) => finding.id === id);
}

/** Every finding this phase can emit, gathered by varying one signal at a time. */
const everyFinding: Finding[] = [
  ...analyze(),
  ...analyze({
    navigation: {
      regionCount: 0,
      totalLinks: 0,
      maxLinksInOneRegion: 0,
      maxNestingDepth: 0,
      duplicateDestinations: 0,
    },
  }),
  ...analyze({
    navigation: {
      regionCount: 2,
      totalLinks: 30,
      maxLinksInOneRegion: BUSY_NAVIGATION_LINKS + 5,
      maxNestingDepth: 5,
      duplicateDestinations: 3,
    },
  }),
  ...analyze({
    actions: {
      buttons: 0,
      buttonStyledLinks: 0,
      primaryStyled: 0,
      submitControls: 0,
      candidateActions: 0,
    },
  }),
  ...analyze({
    actions: {
      buttons: 6,
      buttonStyledLinks: 6,
      primaryStyled: 0,
      submitControls: 1,
      candidateActions: MANY_PRIMARY_ACTIONS + 4,
    },
  }),
  ...analyze({
    actions: {
      buttons: 2,
      buttonStyledLinks: 1,
      primaryStyled: 0,
      submitControls: 1,
      candidateActions: 3,
    },
  }),
  ...analyze({
    density: {
      interactiveElements: 60,
      links: 55,
      wordCount: 200,
      interactivePer100Words: 30,
      linksPer100Words: 27.5,
    },
  }),
  ...analyze({
    density: {
      interactiveElements: 3,
      links: 2,
      wordCount: 10,
      interactivePer100Words: 30,
      linksPer100Words: 20,
    },
  }),
  ...analyze({
    headings: {
      countsByLevel: [0, 0, 0, 0, 0, 0],
      total: 0,
      h1Count: 0,
      skippedLevels: 0,
      deepestLevel: null,
      firstLevel: null,
    },
  }),
  ...analyze({
    headings: {
      countsByLevel: [1, 0, 2, 0, 0, 0],
      total: 3,
      h1Count: 1,
      skippedLevels: 1,
      deepestLevel: 3,
      firstLevel: 1,
    },
  }),
  ...analyze({
    headings: {
      countsByLevel: [1, 0, 0, 0, 0, 0],
      total: 1,
      h1Count: 1,
      skippedLevels: 0,
      deepestLevel: 1,
      firstLevel: 1,
    },
    density: {
      interactiveElements: 5,
      links: 4,
      wordCount: 900,
      interactivePer100Words: 0.6,
      linksPer100Words: 0.4,
    },
  }),
  ...analyze({
    hierarchy: {
      maxDomDepth: 30,
      landmarkCount: 1,
      hasMainLandmark: false,
      paragraphCount: 4,
      listCount: 0,
      headingToParagraphRatio: 1.5,
    },
  }),
  ...analyze({
    forms: {
      formCount: 0,
      totalFields: 0,
      maxFieldsInOneForm: 0,
      requiredFields: 0,
      formsWithoutSubmit: 0,
    },
  }),
  ...analyze({
    forms: {
      formCount: 1,
      totalFields: 14,
      maxFieldsInOneForm: LONG_FORM_FIELDS + 6,
      requiredFields: 10,
      formsWithoutSubmit: 0,
    },
  }),
  ...analyze({
    forms: {
      formCount: 1,
      totalFields: 3,
      maxFieldsInOneForm: 3,
      requiredFields: 1,
      formsWithoutSubmit: 1,
    },
  }),
  ...analyze({
    repetition: {
      repeatedBlocks: [{ signature: "div.card", count: HIGH_REPETITION + 10 }],
      maxRepetition: HIGH_REPETITION + 10,
      repeatedLinkTexts: [{ signature: "read more", count: 20 }],
    },
  }),
];

describe("the phase contract", () => {
  it("emits only ux findings", () => {
    expect(everyFinding.every((finding) => finding.category === "ux")).toBe(true);
  });

  it("gives every finding evidence, an explanation and a recommendation", () => {
    for (const finding of everyFinding) {
      expect(finding.evidence.length, `${finding.id} has no evidence`).toBeGreaterThan(0);
      expect(finding.explanation.length).toBeGreaterThan(0);
      expect(
        (finding.recommendation ?? "").length,
        `${finding.id} has no recommendation`,
      ).toBeGreaterThan(0);
    }
  });

  it("produces no score", () => {
    for (const finding of everyFinding) {
      expect(finding).not.toHaveProperty("score");
    }
  });

  it("uses unique ids within one analysis", () => {
    const ids = analyze().map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic", () => {
    expect(analyze()).toEqual(analyze());
  });

  it("uses no AI", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new globalThis.URL("./analyze-ux.ts", import.meta.url), "utf8"),
    );

    expect(source).not.toMatch(/openai|anthropic|gemini|\bllm\b|fetch\(/i);
  });
});

describe("every finding names the signal behind it", () => {
  // The requirement this phase turns on: a heuristic that does not say what it
  // was inferred from cannot be checked, argued with, or trusted.

  it("carries a measured evidence item on every finding", () => {
    for (const finding of everyFinding) {
      expect(
        finding.evidence.some((item) => item.kind === "measured"),
        `${finding.id} states no observable signal`,
      ).toBe(true);
    }
  });

  it("carries a heuristic evidence item on every finding", () => {
    // Nothing this phase concludes is a fact about quality, so every finding
    // must say where the inference is.
    for (const finding of everyFinding) {
      expect(
        finding.evidence.some((item) => item.kind === "heuristic"),
        `${finding.id} presents an inference as a measurement`,
      ).toBe(true);
    }
  });

  it("puts a number in the measured evidence", () => {
    for (const finding of everyFinding) {
      const measured = finding.evidence.filter((item) => item.kind === "measured");
      const text = measured
        .map((item) => `${item.summary} ${item.detail ?? ""}`)
        .join(" ");

      expect(/\d/.test(text), `${finding.id} cites no measurement`).toBe(true);
    }
  });

  it("never rates a heuristic as critical or serious", () => {
    // An inference must not weigh as much as a measured security failure.
    for (const finding of everyFinding) {
      expect(["critical", "serious"]).not.toContain(finding.severity);
    }
  });
});

describe("navigation", () => {
  it("says nothing when no navigation region exists", () => {
    const finding = byId(
      analyze({
        navigation: {
          regionCount: 0,
          totalLinks: 0,
          maxLinksInOneRegion: 0,
          maxNestingDepth: 0,
          duplicateDestinations: 0,
        },
      }),
      "ux.navigation.none_identified",
    );

    expect(finding?.status).toBe("could_not_determine");
  });

  it("warns about a busy menu and cites the count", () => {
    const findings = analyze({
      navigation: {
        regionCount: 1,
        totalLinks: 20,
        maxLinksInOneRegion: 20,
        maxNestingDepth: 1,
        duplicateDestinations: 0,
      },
    });

    const finding = byId(findings, "ux.navigation.busy");
    expect(finding?.status).toBe("warn");
    expect(finding?.evidence[0]?.summary).toContain("20");
    expect(finding?.evidence[1]?.summary).toContain(String(BUSY_NAVIGATION_LINKS));
  });

  it("warns about deep nesting", () => {
    const findings = analyze({
      navigation: {
        regionCount: 1,
        totalLinks: 8,
        maxLinksInOneRegion: 8,
        maxNestingDepth: 5,
        duplicateDestinations: 0,
      },
    });

    expect(byId(findings, "ux.navigation.deeply_nested")?.status).toBe("warn");
  });

  it("mentions that duplicate destinations are often deliberate", () => {
    const findings = analyze({
      navigation: {
        regionCount: 1,
        totalLinks: 8,
        maxLinksInOneRegion: 8,
        maxNestingDepth: 1,
        duplicateDestinations: 2,
      },
    });

    const finding = byId(findings, "ux.navigation.duplicate_destinations");
    expect(finding?.explanation).toContain("normal for a logo");
  });
});

describe("primary actions", () => {
  it("warns when many actions compete", () => {
    const findings = analyze({
      actions: {
        buttons: 6,
        buttonStyledLinks: 6,
        primaryStyled: 2,
        submitControls: 1,
        candidateActions: 12,
      },
    });

    const finding = byId(findings, "ux.actions.many_competing");
    expect(finding?.status).toBe("warn");
    expect(finding?.evidence[1]?.summary).toContain("pricing page");
  });

  it("admits its emphasis detection is class-based", () => {
    const findings = analyze({
      actions: {
        buttons: 2,
        buttonStyledLinks: 0,
        primaryStyled: 0,
        submitControls: 1,
        candidateActions: 2,
      },
    });

    const finding = byId(findings, "ux.actions.none_emphasised");
    expect(finding?.evidence[1]?.summary).toContain("class names");
  });

  it("says detection could miss an unconventional control", () => {
    const findings = analyze({
      actions: {
        buttons: 0,
        buttonStyledLinks: 0,
        primaryStyled: 0,
        submitControls: 0,
        candidateActions: 0,
      },
    });

    expect(byId(findings, "ux.actions.none_identified")?.explanation).toContain(
      "does not recognise",
    );
  });
});

describe("density", () => {
  it("declines to report a ratio on a page with too few words", () => {
    const findings = analyze({
      density: {
        interactiveElements: 3,
        links: 2,
        wordCount: 10,
        interactivePer100Words: 30,
        linksPer100Words: 20,
      },
    });

    expect(byId(findings, "ux.density.not_meaningful")?.status).toBe(
      "could_not_determine",
    );
  });

  it("warns on high density but says a hub page should look like that", () => {
    const findings = analyze({
      density: {
        interactiveElements: 60,
        links: 55,
        wordCount: 200,
        interactivePer100Words: 30,
        linksPer100Words: 27.5,
      },
    });

    const finding = byId(findings, "ux.density.high");
    expect(finding?.status).toBe("warn");
    expect(finding?.evidence[1]?.summary).toContain("hub or category page");
  });
});

describe("hierarchy", () => {
  it("warns when a page has no headings", () => {
    const findings = analyze({
      headings: {
        countsByLevel: [0, 0, 0, 0, 0, 0],
        total: 0,
        h1Count: 0,
        skippedLevels: 0,
        deepestLevel: null,
        firstLevel: null,
      },
    });

    expect(byId(findings, "ux.hierarchy.no_headings")?.status).toBe("warn");
  });

  it("warns about skipped levels and cites how many", () => {
    const findings = analyze({
      headings: {
        countsByLevel: [1, 0, 2, 0, 0, 0],
        total: 3,
        h1Count: 1,
        skippedLevels: 1,
        deepestLevel: 3,
        firstLevel: 1,
      },
    });

    const finding = byId(findings, "ux.hierarchy.skipped_levels");
    expect(finding?.evidence[1]?.summary).toContain("1 time");
  });

  it("only calls a long page flat, not a short one", () => {
    const flatShort = analyze({
      headings: {
        countsByLevel: [1, 0, 0, 0, 0, 0],
        total: 1,
        h1Count: 1,
        skippedLevels: 0,
        deepestLevel: 1,
        firstLevel: 1,
      },
      // A short page with one heading is fine; only length makes flatness a
      // problem, so the word count has to come down with it.
      density: {
        interactiveElements: 5,
        links: 4,
        wordCount: 120,
        interactivePer100Words: 4.2,
        linksPer100Words: 3.3,
      },
    });

    expect(byId(flatShort, "ux.hierarchy.flat")).toBeUndefined();

    const flatLong = analyze({
      headings: {
        countsByLevel: [1, 0, 0, 0, 0, 0],
        total: 1,
        h1Count: 1,
        skippedLevels: 0,
        deepestLevel: 1,
        firstLevel: 1,
      },
      density: {
        interactiveElements: 5,
        links: 4,
        wordCount: 900,
        interactivePer100Words: 0.6,
        linksPer100Words: 0.4,
      },
    });

    expect(byId(flatLong, "ux.hierarchy.flat")?.status).toBe("warn");
  });

  it("notes a missing main landmark without overstating it", () => {
    const findings = analyze({
      hierarchy: {
        maxDomDepth: 8,
        landmarkCount: 2,
        hasMainLandmark: false,
        paragraphCount: 4,
        listCount: 1,
        headingToParagraphRatio: 1,
      },
    });

    const finding = byId(findings, "ux.hierarchy.no_main_landmark");
    expect(finding?.evidence[1]?.summary).toContain(
      "perfectly clear to a sighted reader",
    );
  });

  it("warns about deep nesting", () => {
    const findings = analyze({
      hierarchy: {
        maxDomDepth: 30,
        landmarkCount: 4,
        hasMainLandmark: true,
        paragraphCount: 4,
        listCount: 1,
        headingToParagraphRatio: 1,
      },
    });

    expect(byId(findings, "ux.hierarchy.deep_dom")?.status).toBe("warn");
  });
});

describe("forms and repetition", () => {
  it("warns about a long form and allows that some must be", () => {
    const findings = analyze({
      forms: {
        formCount: 1,
        totalFields: 14,
        maxFieldsInOneForm: 14,
        requiredFields: 10,
        formsWithoutSubmit: 0,
      },
    });

    const finding = byId(findings, "ux.forms.long");
    expect(finding?.evidence[1]?.summary).toContain("application form");
  });

  it("flags a form with no submit control as something to check", () => {
    const findings = analyze({
      forms: {
        formCount: 1,
        totalFields: 3,
        maxFieldsInOneForm: 3,
        requiredFields: 1,
        formsWithoutSubmit: 1,
      },
    });

    const finding = byId(findings, "ux.forms.no_submit_control");
    expect(finding?.evidence[2]?.summary).toContain("prompt to check");
  });

  it("treats heavy repetition as a listing rather than a defect", () => {
    const findings = analyze({
      repetition: {
        repeatedBlocks: [{ signature: "div.card", count: 40 }],
        maxRepetition: 40,
        repeatedLinkTexts: [{ signature: "read more", count: 40 }],
      },
    });

    const finding = byId(findings, "ux.repetition.dominant_component");
    expect(finding?.status).toBe("warn");
    expect(finding?.explanation).toContain("exactly right");
  });
});

describe("the limits of counting", () => {
  it("always states what counting cannot reach", () => {
    const finding = byId(analyze(), "ux.assessment.limits");

    expect(finding?.status).toBe("could_not_determine");
    expect(finding?.explanation).toContain("None of it establishes whether the page is");
  });

  it("names the things it did not observe", () => {
    const finding = byId(analyze(), "ux.assessment.limits");
    const text = finding?.evidence.map((item) => item.summary).join(" ") ?? "";

    expect(text).toContain("Visual hierarchy");
    expect(text).toContain("clarity of language");
  });

  it("appears even on a page with no problems", () => {
    expect(byId(analyze(), "ux.assessment.limits")).toBeDefined();
  });
});

describe("end to end from HTML", () => {
  const html = `<!doctype html><html lang="en"><head><title>T</title></head>
  <body>
    <nav><ul><li><a href="/a">A</a></li><li><a href="/b">B</a><ul><li><a href="/c">C</a></li></ul></li></ul></nav>
    <main>
      <h1>Heading</h1>
      <p>Some words that make up the body copy of this page for counting.</p>
      <h2>Section</h2>
      <button class="btn primary">Do it</button>
      <form><input name="a"><input name="b"><button type="submit">Send</button></form>
      <div class="card"><span>1</span><span>x</span></div>
      <div class="card"><span>2</span><span>y</span></div>
    </main>
  </body></html>`;

  it("produces findings from real markup", () => {
    const findings = analyzeUx({ signals: collectUxSignals(html, PAGE_URL) });

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.category === "ux")).toBe(true);
  });

  it("keeps the measured/heuristic pairing on real markup too", () => {
    const findings = analyzeUx({ signals: collectUxSignals(html, PAGE_URL) });

    for (const finding of findings) {
      expect(finding.evidence.some((item) => item.kind === "measured")).toBe(true);
      expect(finding.evidence.some((item) => item.kind === "heuristic")).toBe(true);
    }
  });
});
