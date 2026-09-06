/**
 * Checking a model answer against the evidence it was given.
 *
 * Source of truth: CLAUDE.md § AI RULES, docs/DECISIONS.md ADR-003, ADR-021,
 * ADR-046, ADR-055.
 *
 * ## Why this exists even though the prompt says all of it
 *
 * The prompt asks the model not to invent things. This decides whether it did.
 * A prohibition nobody checks is a hope, and Phase 14's brief says to validate
 * model output before using it — which has to mean more than "it parsed".
 *
 * Four things are checked, in rising order of how much they rely on judgement:
 *
 * 1. **Every referenced finding exists.** Deterministic and total. This alone
 *    makes an invented technical finding impossible to publish.
 * 2. **No reference contradicts its finding's status.** A failing check cannot
 *    be a strength; a passing one cannot be a problem.
 * 3. **Every measurement stated appears in the evidence.** A number carrying a
 *    unit — `2.4s`, `340ms`, `1.2MB`, `48%` — is a claim about this page, and
 *    it must be traceable to something supplied.
 * 4. **No prohibited claim.** Security assurances and ranking promises, which
 *    CLAUDE.md forbids outright.
 *
 * ## An answer with any violation is discarded whole
 *
 * Not repaired, not partially used. A model that invented a finding or declared
 * the site secure has shown it is not working from the evidence, and keeping
 * the paragraphs that happen to validate would mean trusting a source we just
 * caught being unreliable. The deterministic report is always there, so the
 * cost of refusing is a missing section rather than a missing report.
 *
 * Pure. No network, no clock, no provider knowledge.
 */

import { previewText } from "@/lib/ai/errors";
import type { JsonValue } from "@/lib/ai/types";
import type { Finding } from "@/lib/types/finding";

import { evidenceToSearchText } from "./evidence";
import type { InterpretationDraft, Violation } from "./types";

/**
 * Claims that a site is secure, safe or unexploitable.
 *
 * CLAUDE.md is explicit that the AI must never claim a website is secure, and
 * ADR-046 records that the security analyzer reports configuration rather than
 * safety. Nothing this system collects can support any of these.
 */
const SECURITY_ASSURANCES: readonly string[] = [
  "is secure",
  "are secure",
  "fully secure",
  "completely secure",
  "totally secure",
  "perfectly secure",
  "very secure",
  "highly secure",
  "is safe from",
  "no vulnerabilities",
  "not vulnerable",
  "free of vulnerabilities",
  "hack proof",
  "hack-proof",
  "unhackable",
  "cannot be hacked",
  "well protected",
  "fully protected",
];

/**
 * Named vulnerability classes.
 *
 * The analyzers observe headers, cookies and transport. None of them can
 * establish any of these, so naming one is an unsupported claim unless a
 * supplied finding named it first — which the evidence check below allows for.
 */
const VULNERABILITY_NAMES: readonly string[] = [
  "sql injection",
  "cross-site scripting",
  "cross site scripting",
  "xss",
  "csrf",
  "cross-site request forgery",
  "remote code execution",
  "data breach",
  "was breached",
  "malware",
  "backdoor",
  "exploited",
  "exploitable",
];

/** Promises about search results. CLAUDE.md forbids guaranteed rankings. */
const SEO_PROMISES: readonly string[] = [
  "rank #1",
  "rank number one",
  "rank first",
  "will rank",
  "guarantee",
  "guaranteed",
  "top of google",
  "first page of google",
  "page one of google",
  "top of the search results",
  "double your traffic",
  "increase traffic by",
  "boost your ranking",
  "improve your ranking by",
];

/**
 * A measurement: a number with a unit attached.
 *
 * `%` sits outside the trailing word boundary deliberately. A `\b` after `%`
 * never matches — `%` and whatever follows it are both non-word characters — so
 * folding it in with the lettered units silently exempted every percentage
 * claim from checking.
 */
const MEASUREMENT_PATTERN =
  /\b\d+(?:[.,]\d+)?\s?(?:(?:ms|s|kb|mb|gb|px|seconds?|milliseconds?|kilobytes?|megabytes?|pixels?|percent)\b|%)/gi;

function normalise(text: string): string {
  return text.toLowerCase().split(/\s+/).join(" ");
}

/** A piece of model-written prose, and where in the answer it came from. */
export interface LocatedText {
  readonly location: string;
  readonly text: string;
}

/** Every piece of model-written prose, with where it came from. */
function draftTexts(draft: InterpretationDraft): LocatedText[] {
  return [
    { location: "executiveSummary", text: draft.executiveSummary },
    ...draft.strengths.map((strength, index) => ({
      location: `strengths[${index}].whyItHelps`,
      text: strength.whyItHelps,
    })),
    ...draft.problems.flatMap((problem, index) => [
      { location: `problems[${index}].whyItMatters`, text: problem.whyItMatters },
      { location: `problems[${index}].recommendation`, text: problem.recommendation },
    ]),
  ];
}

function checkReferences(
  draft: InterpretationDraft,
  findingsById: ReadonlyMap<string, Finding>,
): Violation[] {
  const violations: Violation[] = [];

  draft.problems.forEach((problem, index) => {
    const finding = findingsById.get(problem.findingId);

    if (finding === undefined) {
      violations.push({
        kind: "unknown_finding",
        location: `problems[${index}].findingId`,
        detail: "The answer referenced a finding that was not supplied.",
        excerpt: previewText(problem.findingId, 120),
      });
      return;
    }

    if (finding.status === "pass") {
      violations.push({
        kind: "contradicts_status",
        location: `problems[${index}].findingId`,
        detail: `${finding.id} passed, so it cannot be presented as a problem.`,
        excerpt: previewText(problem.whyItMatters, 160),
      });
    }

    if (finding.status === "could_not_determine") {
      violations.push({
        kind: "contradicts_status",
        location: `problems[${index}].findingId`,
        detail: `${finding.id} could not be determined, so it establishes no problem (ADR-021).`,
        excerpt: previewText(problem.whyItMatters, 160),
      });
    }
  });

  draft.strengths.forEach((strength, index) => {
    const finding = findingsById.get(strength.findingId);

    if (finding === undefined) {
      violations.push({
        kind: "unknown_finding",
        location: `strengths[${index}].findingId`,
        detail: "The answer referenced a finding that was not supplied.",
        excerpt: previewText(strength.findingId, 120),
      });
      return;
    }

    if (finding.status !== "pass") {
      violations.push({
        kind: "contradicts_status",
        location: `strengths[${index}].findingId`,
        detail: `${finding.id} did not pass, so it cannot be presented as a strength.`,
        excerpt: previewText(strength.whyItHelps, 160),
      });
    }
  });

  return violations;
}

/**
 * Measurements the evidence does not contain.
 *
 * Compared with punctuation and spacing normalised, so `2.4 s` matches `2.4s`
 * and `1,024` matches `1024`. A false positive here costs a discarded answer,
 * which is why the pattern requires a unit: a bare "3 problems" is prose, and
 * only a number with a unit is a claim about the page.
 */
function checkMeasurements(
  texts: readonly LocatedText[],
  evidence: JsonValue,
): Violation[] {
  const haystack = evidenceToSearchText(evidence).replace(/[\s,]/g, "");
  const violations: Violation[] = [];

  for (const { location, text } of texts) {
    for (const match of text.match(MEASUREMENT_PATTERN) ?? []) {
      const needle = match.toLowerCase().replace(/[\s,]/g, "");

      // Also try the bare number: the evidence may carry `2400` in a field
      // named for its unit rather than the string "2400ms".
      const bareNumber = needle.replace(/[^\d.]/g, "");

      if (haystack.includes(needle)) continue;
      if (bareNumber.length > 0 && haystack.includes(bareNumber)) continue;

      violations.push({
        kind: "invented_measurement",
        location,
        detail: `"${match}" does not appear anywhere in the supplied evidence.`,
        excerpt: previewText(text, 160),
      });
    }
  }

  return violations;
}

function checkProhibitedClaims(
  texts: readonly LocatedText[],
  evidence: JsonValue,
): Violation[] {
  const evidenceText = evidenceToSearchText(evidence);
  const violations: Violation[] = [];

  for (const { location, text } of texts) {
    const normalised = normalise(text);

    for (const phrase of SECURITY_ASSURANCES) {
      if (!normalised.includes(phrase)) continue;

      violations.push({
        kind: "unsupported_security_claim",
        location,
        detail: `"${phrase}" asserts a level of safety this analysis cannot establish (ADR-046).`,
        excerpt: previewText(text, 160),
      });
    }

    for (const phrase of VULNERABILITY_NAMES) {
      if (!normalised.includes(phrase)) continue;
      // Allowed if a supplied finding raised it first.
      if (evidenceText.includes(phrase)) continue;

      violations.push({
        kind: "unsupported_security_claim",
        location,
        detail: `"${phrase}" names a vulnerability that no supplied finding establishes.`,
        excerpt: previewText(text, 160),
      });
    }

    for (const phrase of SEO_PROMISES) {
      if (!normalised.includes(phrase)) continue;

      violations.push({
        kind: "unsupported_seo_claim",
        location,
        detail: `"${phrase}" promises a search outcome nobody can predict.`,
        excerpt: previewText(text, 160),
      });
    }
  }

  return violations;
}

function checkNotEmpty(draft: InterpretationDraft): Violation[] {
  if (draft.executiveSummary.trim().length >= 20) return [];

  return [
    {
      kind: "empty_content",
      location: "executiveSummary",
      detail: "The summary is too short to say anything.",
      excerpt: previewText(draft.executiveSummary, 80),
    },
  ];
}

/**
 * The checks that apply to any model-written prose, wherever it appears.
 *
 * Invented measurements and prohibited claims are not specific to an
 * interpretation — a roast line makes exactly the same claims available, and a
 * second copy of these phrase lists would be a second thing to keep current.
 * Phase 15 calls this directly.
 */
export function checkProse(
  texts: readonly LocatedText[],
  evidence: JsonValue,
): Violation[] {
  return [
    ...checkMeasurements(texts, evidence),
    ...checkProhibitedClaims(texts, evidence),
  ];
}

export interface VerificationInput {
  readonly draft: InterpretationDraft;
  readonly evidence: JsonValue;
  readonly findingsById: ReadonlyMap<string, Finding>;
}

/**
 * Check a model answer.
 *
 * @returns every violation found, in a stable order. An empty array means the
 *   answer may be used.
 */
export function verifyInterpretation(input: VerificationInput): Violation[] {
  return [
    ...checkNotEmpty(input.draft),
    ...checkReferences(input.draft, input.findingsById),
    ...checkProse(draftTexts(input.draft), input.evidence),
  ];
}

/** The phrase lists, exported so tests can assert every one is enforced. */
export const PROHIBITED_PHRASES = {
  securityAssurances: SECURITY_ASSURANCES,
  vulnerabilityNames: VULNERABILITY_NAMES,
  seoPromises: SEO_PROMISES,
} as const;
