/**
 * Component tests.
 *
 * These render to static markup with `react-dom/server` — no browser, no DOM
 * environment, no testing library, no new dependency. That covers what actually
 * matters here: that the words are right, that an absence is stated rather than
 * blanked, and that a screen reader is given something to read.
 *
 * What it cannot cover is layout and interaction. Those are checked by building
 * and looking, and the honest limitation is recorded rather than papered over
 * with a test that only proves a component returned some HTML.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AiInterpretation } from "@/lib/ai/interpretation";
import type { Recommendation } from "@/lib/recommendations";
import type { Roast } from "@/lib/roast";
import type { Finding } from "@/lib/types/finding";

import { FindingRow, RecommendationRow, StrengthRow } from "./findings";
import { Interpretation, RoastPanel, Screenshots } from "./narrative";
import { Empty, Section } from "./primitives";
import { CategoryBar, OverallScore } from "./score-scale";

const render = renderToStaticMarkup;

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "seo.title.missing",
    category: "seo",
    severity: "serious",
    status: "fail",
    evidence: [
      { kind: "measured", source: "dom", summary: "The page has no <title>." },
      { kind: "heuristic", source: "derived", summary: "This looks unintentional." },
    ],
    explanation: "Search results have nothing to show for this page.",
    recommendation: "Add a title describing the page in under 60 characters.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

describe("the overall score", () => {
  it("shows the number and the grade", () => {
    const html = render(
      <OverallScore
        score={72}
        grade="C"
        explanation="Overall 72/100 from 4 categories."
      />,
    );

    expect(html).toContain("72");
    expect(html).toContain(">C<");
    expect(html).toContain("Overall 72/100 from 4 categories.");
  });

  it("describes itself to a screen reader", () => {
    const html = render(<OverallScore score={72} grade="C" explanation="x" />);

    expect(html).toContain('aria-label="Overall score 72 out of 100, grade C."');
  });

  it("shows no score rather than a zero when nothing was assessed", () => {
    // A zero would be a verdict nobody reached (ADR-021).
    const html = render(
      <OverallScore
        score={null}
        grade={null}
        explanation="No category could be assessed."
      />,
    );

    expect(html).toContain("--");
    expect(html).not.toContain(">0<");
    expect(html).toContain("nothing could be assessed");
  });

  it("marks where the grades change", () => {
    const html = render(<OverallScore score={72} grade="C" explanation="x" />);

    for (const boundary of ["60", "70", "80", "90"]) {
      expect(html).toContain(`>${boundary}<`);
    }
  });
});

describe("a category score", () => {
  it("shows the score and grade on the shared scale", () => {
    const html = render(
      <CategoryBar label="Search" score={64} grade="D" notAssessedReason={null} />,
    );

    expect(html).toContain("Search");
    expect(html).toContain("64 D");
    expect(html).toContain('aria-label="Search: 64 out of 100, grade D."');
  });

  it("says not assessed, and why, instead of showing zero", () => {
    const html = render(
      <CategoryBar
        label="Performance"
        score={null}
        grade={null}
        notAssessedReason="No performance measurements were supplied."
      />,
    );

    expect(html).toContain("Not assessed");
    expect(html).toContain("No performance measurements were supplied.");
    expect(html).toContain("n/a");
    expect(html).not.toContain(">0<");
  });

  it("draws an unassessed track differently from an empty one", () => {
    const assessed = render(
      <CategoryBar label="Search" score={0} grade="F" notAssessedReason={null} />,
    );
    const unassessed = render(
      <CategoryBar label="Search" score={null} grade={null} notAssessedReason="Nope." />,
    );

    // A hatched fill, so the two are not confusable at a glance.
    expect(unassessed).toContain("repeating-linear-gradient");
    expect(assessed).not.toContain("repeating-linear-gradient");
  });

  it("gives a zero score a visible bar", () => {
    const html = render(
      <CategoryBar label="Security" score={0} grade="F" notAssessedReason={null} />,
    );

    expect(html).toContain("width:1%");
  });
});

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

describe("a finding", () => {
  it("shows its evidence", () => {
    const html = render(<FindingRow finding={finding()} title="The page has no title" />);

    expect(html).toContain("The page has no &lt;title&gt;.");
    expect(html).toContain("What was observed (2)");
  });

  it("distinguishes what was measured from what was inferred", () => {
    // ADR-009: an inference must never be presented as a fact.
    const html = render(<FindingRow finding={finding()} title="x" />);

    expect(html).toContain("measured");
    expect(html).toContain("inferred");
  });

  it("shows the finding id, so a report can be traced", () => {
    const html = render(<FindingRow finding={finding()} title="x" />);

    expect(html).toContain("seo.title.missing");
  });

  it("shows the outcome and severity in words, not only in colour", () => {
    const html = render(<FindingRow finding={finding()} title="x" />);

    expect(html).toContain("Failed");
    expect(html).toContain("Serious");
  });

  it("is a native disclosure, so it works with a keyboard", () => {
    const html = render(<FindingRow finding={finding()} title="x" />);

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
  });

  it("shows an evidence detail when there is one", () => {
    const html = render(
      <FindingRow
        finding={finding({
          evidence: [
            {
              kind: "measured",
              source: "http",
              summary: "The header is set.",
              detail: "max-age=31536000",
            },
          ],
        })}
        title="x"
      />,
    );

    expect(html).toContain("max-age=31536000");
  });
});

describe("a recommendation", () => {
  const recommendation: Recommendation = {
    findingId: "seo.title.missing",
    rank: 1,
    kind: "fix",
    title: "The page has no title",
    titleSource: "evidence",
    impact: {
      level: "high",
      points: 3.75,
      categoryDeduction: 25,
      categoryWeight: 15,
      weightBasis: "declared",
      explanation: "A serious seo finding.",
    },
    tier: 3,
    tierLabel: "Conversion and discoverability",
    rankExplanation: "Ranked 1 of 8.",
    finding: finding(),
  };

  it("shows its rank, action and what fixing it is worth", () => {
    const html = render(<RecommendationRow recommendation={recommendation} />);

    expect(html).toContain(">1<");
    expect(html).toContain("Add a title describing the page");
    expect(html).toContain("high impact");
    expect(html).toContain("returns 3.75 points");
  });

  it("says when the score effect cannot be priced", () => {
    const html = render(
      <RecommendationRow
        recommendation={{
          ...recommendation,
          impact: { ...recommendation.impact, points: null, categoryWeight: null },
        }}
      />,
    );

    // Null is not zero: performance is scored by curves, not deductions.
    expect(html).toContain("cannot be priced");
    expect(html).not.toContain("returns 0 points");
  });
});

describe("a strength", () => {
  it("is titled by what was observed", () => {
    const html = render(
      <StrengthRow
        finding={finding({
          status: "pass",
          severity: "info",
          evidence: [
            { kind: "measured", source: "dom", summary: "A canonical URL is declared." },
          ],
        })}
      />,
    );

    expect(html).toContain("A canonical URL is declared");
    expect(html).toContain("Passed");
  });

  it("does not print a severity beside a pass", () => {
    // "Passed / Info" on every passing check is noise that buries the real
    // problems.
    const html = render(
      <StrengthRow finding={finding({ status: "pass", severity: "info" })} />,
    );

    expect(html).not.toContain("Info");
  });
});

// ---------------------------------------------------------------------------
// Interpretation and roast
// ---------------------------------------------------------------------------

describe("the interpretation", () => {
  const interpretation: AiInterpretation = {
    executiveSummary: "The page states its purpose but leaves the basics unfinished.",
    strengths: [
      { finding: finding({ status: "pass" }), whyItHelps: "It keeps things tidy." },
    ],
    problems: [
      {
        finding: finding(),
        whyItMatters: "Nobody can tell what this page is from a search result.",
        recommendation: "Write a title.",
        deterministicRank: 1,
      },
    ],
    meta: {
      provider: "gemini",
      model: "gemini-2.0-flash",
      task: "interpretation",
      latencyMs: 900,
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      finishReason: "STOP",
    },
  };

  it("shows the summary, the problems and the strengths", () => {
    const html = render(
      <Interpretation interpretation={interpretation} unavailableReason={null} />,
    );

    expect(html).toContain("leaves the basics unfinished");
    expect(html).toContain("Nobody can tell what this page is");
    expect(html).toContain("It keeps things tidy.");
  });

  it("says which model wrote it, and that it was checked", () => {
    const html = render(
      <Interpretation interpretation={interpretation} unavailableReason={null} />,
    );

    expect(html).toContain("gemini-2.0-flash");
    expect(html).toContain("checked against them");
  });

  it("explains its absence rather than disappearing", () => {
    // A section that silently vanishes is indistinguishable from one that had
    // nothing to say.
    const html = render(
      <Interpretation
        interpretation={null}
        unavailableReason="AI interpretation is not configured."
      />,
    );

    expect(html).toContain("AI interpretation is not configured.");
    expect(html).toContain("the report is complete without it");
  });
});

describe("the roast", () => {
  const roast: Roast = {
    lines: [
      {
        finding: finding(),
        observation: "The page has no title.",
        punchline: "A confident silence where the introduction should be.",
      },
    ],
    source: "deterministic",
    fallbackReason: "AI_API_KEY is not set.",
    note: null,
    meta: null,
  };

  it("shows the observation and the punchline", () => {
    const html = render(<RoastPanel roast={roast} />);

    expect(html).toContain("The page has no title.");
    expect(html).toContain("A confident silence");
  });

  it("says when it was written without AI", () => {
    const html = render(<RoastPanel roast={roast} />);

    expect(html).toContain("without AI");
    expect(html).toContain("AI_API_KEY is not set.");
  });

  it("says nothing about the source when a model wrote it", () => {
    const html = render(
      <RoastPanel roast={{ ...roast, source: "ai", fallbackReason: null }} />,
    );

    expect(html).toContain("Written from the findings above.");
    expect(html).not.toContain("without AI");
  });

  it("shows the note when there was nothing to roast", () => {
    const html = render(
      <RoastPanel
        roast={{ ...roast, lines: [], note: "No failing or warning checks were found." }}
      />,
    );

    expect(html).toContain("No failing or warning checks were found.");
  });
});

describe("screenshots", () => {
  it("names why there are none", () => {
    const html = render(
      <Screenshots notRun={["accessibility", "performance", "mobile"]} />,
    );

    expect(html).toContain("No screenshots were captured");
    expect(html).toContain("browser pass");
    expect(html).toContain("accessibility, performance, mobile");
  });

  it("still says something when nothing was skipped", () => {
    const html = render(<Screenshots notRun={[]} />);

    expect(html).toContain("No screenshots were captured");
  });
});

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe("sections", () => {
  it("puts the count beside the heading", () => {
    const html = render(
      <Section title="Top issues" count={5}>
        <p>x</p>
      </Section>,
    );

    expect(html).toContain("Top issues");
    expect(html).toContain(">5<");
    expect(html).toContain("<h2");
  });

  it("renders without a count or description", () => {
    const html = render(
      <Section title="The roast">
        <p>x</p>
      </Section>,
    );

    expect(html).toContain("The roast");
  });

  it("uses no all-caps label styling", () => {
    const html = render(
      <Section title="Strengths" count={0} description="Everything that passed.">
        <Empty>Nothing passed.</Empty>
      </Section>,
    );

    expect(html).not.toContain("uppercase");
    expect(html).not.toContain("tracking-widest");
  });
});
