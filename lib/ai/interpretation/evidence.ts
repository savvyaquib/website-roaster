/**
 * Assembling the evidence a model is allowed to see.
 *
 * Source of truth: docs/DECISIONS.md ADR-003, ADR-014, ADR-055.
 *
 * ADR-014 says the model receives normalized evidence, not application state.
 * This module is where that line is drawn, and it is drawn by construction: the
 * result is a `JsonValue` built field by field from analyzer output, so there is
 * no path by which a live object, a secret, a header, an internal hostname or
 * anything else nobody chose to include can reach a provider.
 *
 * ## Everything is bounded
 *
 * A large page produces a lot of findings, and an unbounded prompt is a cost
 * and latency problem before it is anything else. Every list here has a cap and
 * every string has a length limit, and what was dropped is reported in the
 * evidence itself — so the model is told it is seeing a subset rather than
 * silently reasoning about a partial page as though it were the whole one.
 */

import type { JsonValue } from "@/lib/ai/types";
import type { ContentInventory } from "@/lib/analysis/content";
import type { PageData } from "@/lib/analysis/dom";
import type { ScoreReport } from "@/lib/scoring";
import type { RecommendationReport } from "@/lib/recommendations";
import type { Finding } from "@/lib/types/finding";

export interface EvidenceLimits {
  /** Findings that failed or warned. The model's raw material for problems. */
  readonly maxProblemFindings: number;
  /** Passing findings, so the model can name genuine strengths. */
  readonly maxPassingFindings: number;
  /** Evidence items quoted per finding. */
  readonly maxEvidencePerFinding: number;
  /** Calls to action listed from the content inventory. */
  readonly maxCtas: number;
  /** Characters of any single free-text field. */
  readonly maxTextLength: number;
}

export const DEFAULT_EVIDENCE_LIMITS: EvidenceLimits = {
  maxProblemFindings: 40,
  maxPassingFindings: 15,
  maxEvidencePerFinding: 4,
  maxCtas: 10,
  maxTextLength: 400,
};

/** Everything the interpretation layer can draw on. */
export interface InterpretationInput {
  readonly url: string;
  readonly findings: readonly Finding[];
  readonly score: ScoreReport;
  /** Phase 13's ranking. Supplied so the model can agree with it, or not. */
  readonly recommendations?: RecommendationReport;
  readonly page?: PageData;
  readonly content?: ContentInventory;
  readonly limits?: Partial<EvidenceLimits>;
}

/** The assembled evidence, plus the ids the model is allowed to reference. */
export interface AssembledEvidence {
  readonly evidence: JsonValue;
  /** Every finding id in the evidence, by id, for verification afterwards. */
  readonly findingsById: ReadonlyMap<string, Finding>;
  /** Deterministic rank per finding id, when a ranked list was supplied. */
  readonly ranksByFindingId: ReadonlyMap<string, number>;
}

function clip(text: string, maxLength: number): string {
  const collapsed = text.split(/\s+/).join(" ").trim();

  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 1)}…`;
}

function findingToJson(finding: Finding, limits: EvidenceLimits): JsonValue {
  return {
    id: finding.id,
    category: finding.category,
    severity: finding.severity,
    status: finding.status,
    explanation: clip(finding.explanation, limits.maxTextLength),
    ...(finding.recommendation === undefined
      ? {}
      : {
          deterministicRecommendation: clip(finding.recommendation, limits.maxTextLength),
        }),
    evidence: finding.evidence.slice(0, limits.maxEvidencePerFinding).map((item) => ({
      kind: item.kind,
      source: item.source,
      summary: clip(item.summary, limits.maxTextLength),
      ...(item.detail === undefined
        ? {}
        : { detail: clip(item.detail, limits.maxTextLength) }),
    })),
  };
}

function scoreToJson(score: ScoreReport): JsonValue {
  return {
    scoringVersion: score.scoringVersion,
    overall: {
      score: score.overall.score,
      grade: score.overall.grade,
      assessedCategories: [...score.overall.assessedCategories],
      notAssessedCategories: [...score.overall.notAssessedCategories],
    },
    categories: score.categories.map((category) => ({
      category: category.category,
      score: category.score,
      grade: category.grade,
      status: category.status,
      ...(category.notAssessedReason === null
        ? {}
        : { notAssessedReason: category.notAssessedReason }),
    })),
  };
}

function contentToJson(content: ContentInventory, limits: EvidenceLimits): JsonValue {
  return {
    headline:
      content.hero.headline === null
        ? null
        : clip(content.hero.headline, limits.maxTextLength),
    supportingCopy:
      content.hero.supportingCopy === null
        ? null
        : clip(content.hero.supportingCopy, limits.maxTextLength),
    callsToAction: content.ctas.slice(0, limits.maxCtas).map((cta) => ({
      text: clip(cta.text, 80),
      element: cta.element,
      region: cta.region,
      // Carried so the model can tell an observed button from an inferred one
      // (ADR-050), which is the distinction it is told to respect.
      detection: cta.detection,
    })),
    sectionKinds: content.sections.map((section) => section.kind),
    wordCount: content.wordCount,
    paragraphCount: content.paragraphCount,
    headingCount: content.headingCount,
    hasFooter: content.footer.present,
    trustSignalKinds: content.trustSignals.map((signal) => signal.kind),
  };
}

function pageToJson(page: PageData, limits: EvidenceLimits): JsonValue {
  return {
    title: page.title === null ? null : clip(page.title, limits.maxTextLength),
    metaDescription:
      page.description === null ? null : clip(page.description, limits.maxTextLength),
    language: page.htmlLanguage,
    viewport: page.viewport,
    canonical: page.canonical,
    headingOutline: page.headings
      .slice(0, 20)
      .map((heading) => `h${heading.level}: ${clip(heading.text, 80)}`),
    linkCount: page.links.length,
    imageCount: page.images.length,
    formCount: page.forms.length,
    scriptCount: page.scripts.length,
    stylesheetCount: page.stylesheets.length,
  };
}

/**
 * Build the evidence payload.
 *
 * Deterministic and pure: the same analysis always produces the same prompt
 * input, which is what makes a disagreement between two runs a model
 * difference rather than an input difference.
 */
export function assembleEvidence(input: InterpretationInput): AssembledEvidence {
  const limits = { ...DEFAULT_EVIDENCE_LIMITS, ...input.limits };

  const ranksByFindingId = new Map<string, number>();
  for (const recommendation of input.recommendations?.recommendations ?? []) {
    ranksByFindingId.set(recommendation.findingId, recommendation.rank);
  }

  // Ranked findings first, so a cap drops the least important rather than
  // whatever happened to come last out of an analyzer.
  const problems = input.findings
    .filter((finding) => finding.status === "fail" || finding.status === "warn")
    .sort(
      (a, b) =>
        (ranksByFindingId.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (ranksByFindingId.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );

  const passing = input.findings.filter((finding) => finding.status === "pass");
  const undetermined = input.findings.filter(
    (finding) => finding.status === "could_not_determine",
  );

  const includedProblems = problems.slice(0, limits.maxProblemFindings);
  const includedPassing = passing.slice(0, limits.maxPassingFindings);

  const findingsById = new Map<string, Finding>();
  for (const finding of [...includedProblems, ...includedPassing]) {
    findingsById.set(finding.id, finding);
  }

  const evidence: JsonValue = {
    url: input.url,
    score: scoreToJson(input.score),

    problems: includedProblems.map((finding) => ({
      ...(findingToJson(finding, limits) as Record<string, JsonValue>),
      ...(ranksByFindingId.has(finding.id)
        ? { deterministicRank: ranksByFindingId.get(finding.id)! }
        : {}),
    })),

    strengths: includedPassing.map((finding) => findingToJson(finding, limits)),

    // Named, not detailed. A check that established nothing is not a problem
    // and not a strength, and the model must not treat it as either (ADR-021).
    checksThatCouldNotBeDetermined: undetermined.map((finding) => finding.id),

    ...(input.page === undefined ? {} : { page: pageToJson(input.page, limits) }),
    ...(input.content === undefined
      ? {}
      : { content: contentToJson(input.content, limits) }),

    coverage: {
      totalFindings: input.findings.length,
      problemsFound: problems.length,
      problemsShown: includedProblems.length,
      passesFound: passing.length,
      passesShown: includedPassing.length,
      truncated:
        problems.length > includedProblems.length ||
        passing.length > includedPassing.length,
    },
  };

  return { evidence, findingsById, ranksByFindingId };
}

/**
 * The evidence flattened to searchable text.
 *
 * Used by verification to ask whether a measurement the model stated appears
 * anywhere it was allowed to read.
 */
export function evidenceToSearchText(evidence: JsonValue): string {
  return JSON.stringify(evidence).toLowerCase();
}
