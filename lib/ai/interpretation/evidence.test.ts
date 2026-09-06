import { describe, expect, it } from "vitest";

import { analyzeContent, extractContent } from "@/lib/analysis/content";
import { extractPageData } from "@/lib/analysis/dom";
import { analyzeUx, collectUxSignals } from "@/lib/analysis/ux";
import { buildRecommendations } from "@/lib/recommendations";
import { scoreAnalysis } from "@/lib/scoring";
import type { Finding, FindingStatus } from "@/lib/types/finding";

import { assembleEvidence, DEFAULT_EVIDENCE_LIMITS } from "./evidence";

const HTML = `<!doctype html><html lang="en"><head><title>Ship faster</title>
<meta name="description" content="We help teams ship."></head><body>
<nav><a href="/a">A</a><a href="/b">B</a></nav>
<main><h1>Ship faster</h1><p>We help engineering teams ship sooner.</p>
<h4>Skipped a level</h4><a href="/signup">Get started</a></main>
<footer><p>© 2026</p></footer></body></html>`;

const URL = "https://example.com/";

function realFindings(): Finding[] {
  return [
    ...analyzeUx({ signals: collectUxSignals(HTML, URL) }),
    ...analyzeContent({ inventory: extractContent(HTML, URL) }),
  ];
}

function finding(id: string, status: FindingStatus): Finding {
  return {
    id,
    category: "seo",
    severity: "moderate",
    status,
    evidence: [
      { kind: "measured", source: "dom", summary: "Observed.", detail: "detail" },
      { kind: "heuristic", source: "derived", summary: "Inferred." },
      { kind: "measured", source: "dom", summary: "Third." },
      { kind: "measured", source: "dom", summary: "Fourth." },
      { kind: "measured", source: "dom", summary: "Fifth." },
    ],
    explanation: "Why it matters.",
    recommendation: "What to do.",
  };
}

function assemble(findings: Finding[], extra = {}) {
  const score = scoreAnalysis({ findings });

  return assembleEvidence({
    url: URL,
    findings,
    score,
    recommendations: buildRecommendations({ findings, score }),
    ...extra,
  });
}

type Payload = Record<string, never>;

describe("what reaches the model", () => {
  const findings = realFindings();
  const { evidence } = assemble(findings);
  const payload = evidence as unknown as Record<string, unknown>;

  it("carries the URL under review", () => {
    expect(payload.url).toBe(URL);
  });

  it("carries the score and the per-category grades", () => {
    const score = payload.score as Record<string, unknown>;

    expect(score).toHaveProperty("overall");
    expect(score).toHaveProperty("categories");
    expect(score).toHaveProperty("scoringVersion");
  });

  it("carries technical findings as problems and strengths", () => {
    expect((payload.problems as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(payload.strengths)).toBe(true);
  });

  it("carries UX heuristics, which are findings like any other", () => {
    const problems = payload.problems as { id: string; category: string }[];

    expect(problems.some((problem) => problem.category === "ux")).toBe(true);
  });

  it("marks each evidence item measured or heuristic", () => {
    // The model is told to respect the distinction, so it has to be able to see
    // it (ADR-009).
    const problems = payload.problems as { evidence: { kind: string }[] }[];
    const kinds = new Set(problems.flatMap((p) => p.evidence.map((e) => e.kind)));

    expect(kinds.has("measured") || kinds.has("heuristic")).toBe(true);
  });

  it("carries page content when supplied", () => {
    const { evidence } = assemble(findings, {
      content: extractContent(HTML, URL),
      page: extractPageData(HTML, URL),
    });
    const withContent = evidence as unknown as Record<string, unknown>;

    expect(withContent).toHaveProperty("content");
    expect(withContent).toHaveProperty("page");
    expect((withContent.content as Record<string, unknown>).headline).toBe("Ship faster");
    expect((withContent.page as Record<string, unknown>).title).toBe("Ship faster");
  });

  it("names undetermined checks without describing them", () => {
    const undetermined = [finding("seo.a.b", "could_not_determine")];
    const { evidence } = assemble([...findings, ...undetermined]);
    const payload = evidence as unknown as Record<string, unknown>;

    // A check that established nothing is neither problem nor strength, and
    // must not be presented as either (ADR-021). The real analyzers emit
    // several of these on their own — ux.assessment.limits always — so this
    // asserts the injected one joins them rather than replacing them.
    const named = payload.checksThatCouldNotBeDetermined as string[];

    expect(named).toContain("seo.a.b");
    expect(named).toContain("ux.assessment.limits");
    expect(JSON.stringify(payload.problems)).not.toContain("seo.a.b");
    expect(JSON.stringify(payload.strengths)).not.toContain("seo.a.b");
  });

  it("serialises to JSON without losing anything", () => {
    expect(() => JSON.stringify(evidence)).not.toThrow();
  });
});

describe("what does not reach the model", () => {
  it("carries no secrets, headers or internal state", () => {
    const { evidence } = assemble(realFindings(), {
      content: extractContent(HTML, URL),
      page: extractPageData(HTML, URL),
    });

    const serialised = JSON.stringify(evidence).toLowerCase();

    // ADR-014: normalized evidence, not application state. The payload is built
    // field by field, so this asserts the construction rather than a filter.
    for (const forbidden of [
      "apikey",
      "api_key",
      "authorization",
      "cookie",
      "set-cookie",
      "process.env",
      "127.0.0.1",
      "localhost",
    ]) {
      expect(serialised, `evidence contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("carries no functions or class instances", () => {
    const { evidence } = assemble(realFindings());

    expect(JSON.parse(JSON.stringify(evidence))).toEqual(evidence);
  });
});

describe("bounds", () => {
  const many = Array.from({ length: 100 }, (_, index) =>
    finding(`seo.problem.${index}`, "fail"),
  );
  const manyPasses = Array.from({ length: 100 }, (_, index) =>
    finding(`seo.pass.${index}`, "pass"),
  );

  it("caps the problems it sends", () => {
    const { evidence } = assemble(many);
    const payload = evidence as unknown as Record<string, unknown>;

    expect((payload.problems as unknown[]).length).toBe(
      DEFAULT_EVIDENCE_LIMITS.maxProblemFindings,
    );
  });

  it("caps the passes it sends", () => {
    const { evidence } = assemble(manyPasses);
    const payload = evidence as unknown as Record<string, unknown>;

    expect((payload.strengths as unknown[]).length).toBe(
      DEFAULT_EVIDENCE_LIMITS.maxPassingFindings,
    );
  });

  it("caps evidence items per finding", () => {
    const { evidence } = assemble([finding("seo.one.two", "fail")]);
    const payload = evidence as unknown as Record<string, unknown>;
    const problem = (payload.problems as { evidence: unknown[] }[])[0]!;

    expect(problem.evidence.length).toBe(DEFAULT_EVIDENCE_LIMITS.maxEvidencePerFinding);
  });

  it("clips long text rather than sending it whole", () => {
    const long: Finding = {
      ...finding("seo.long.text", "fail"),
      explanation: "x".repeat(5000),
    };
    const { evidence } = assemble([long]);
    const payload = evidence as unknown as Record<string, unknown>;
    const problem = (payload.problems as { explanation: string }[])[0]!;

    expect(problem.explanation.length).toBeLessThanOrEqual(
      DEFAULT_EVIDENCE_LIMITS.maxTextLength,
    );
  });

  it("says when it truncated, so the model knows it sees a subset", () => {
    const { evidence } = assemble(many);
    const coverage = (evidence as unknown as Record<string, Record<string, unknown>>)
      .coverage!;

    expect(coverage.truncated).toBe(true);
    expect(coverage.problemsFound).toBe(100);
    expect(coverage.problemsShown).toBe(DEFAULT_EVIDENCE_LIMITS.maxProblemFindings);
  });

  it("says when it truncated nothing", () => {
    const { evidence } = assemble([finding("seo.one.two", "fail")]);
    const coverage = (evidence as unknown as Record<string, Record<string, unknown>>)
      .coverage!;

    expect(coverage.truncated).toBe(false);
  });

  it("honours overridden limits", () => {
    const { evidence } = assemble(many, { limits: { maxProblemFindings: 3 } });
    const payload = evidence as unknown as Record<string, unknown>;

    expect((payload.problems as unknown[]).length).toBe(3);
  });

  it("drops the least important first when it caps", () => {
    // Ranked order decides what survives, so a cap never discards the worst
    // problem because an analyzer happened to run last.
    const findings = realFindings();
    const { evidence } = assemble(findings, { limits: { maxProblemFindings: 2 } });
    const payload = evidence as unknown as Record<string, unknown>;
    const shown = (payload.problems as { deterministicRank: number }[]).map(
      (problem) => problem.deterministicRank,
    );

    expect(shown).toEqual([1, 2]);
  });
});

describe("the lookup tables it returns", () => {
  it("maps every id it sent, and nothing it did not", () => {
    const findings = realFindings();
    const { evidence, findingsById } = assemble(findings, {
      limits: { maxProblemFindings: 2, maxPassingFindings: 1 },
    });
    const payload = evidence as unknown as Payload as Record<string, { id: string }[]>;

    const sent = [
      ...payload.problems!.map((problem) => problem.id),
      ...payload.strengths!.map((strength) => strength.id),
    ];

    expect([...findingsById.keys()].sort()).toEqual([...sent].sort());
  });

  it("carries the deterministic rank for each ranked finding", () => {
    const findings = realFindings();
    const { ranksByFindingId } = assemble(findings);

    expect(ranksByFindingId.size).toBeGreaterThan(0);
    expect([...ranksByFindingId.values()]).toContain(1);
  });

  it("works with no ranking supplied", () => {
    const findings = realFindings();
    const { ranksByFindingId, findingsById } = assembleEvidence({
      url: URL,
      findings,
      score: scoreAnalysis({ findings }),
    });

    expect(ranksByFindingId.size).toBe(0);
    expect(findingsById.size).toBeGreaterThan(0);
  });
});

describe("determinism", () => {
  it("produces the same payload for the same analysis", () => {
    const findings = realFindings();

    expect(assemble(findings).evidence).toEqual(assemble(findings).evidence);
  });
});
