/**
 * What the model is asked for, and what it is allowed to say.
 *
 * Source of truth: docs/DECISIONS.md ADR-003, ADR-014, ADR-016, ADR-055.
 *
 * ## The model supplies prose. The application supplies facts.
 *
 * This is the whole design. A model answer never carries a severity, a
 * category, a metric, a score or an element — only a **reference** to a finding
 * the analyzers already produced, plus plain-language words about it.
 *
 * Everything factual in the finished interpretation is read back from the
 * `Finding` the model pointed at, exactly as Phase 13 reads facts through
 * `recommendation.finding` (ADR-029). A model cannot contradict evidence it was
 * never allowed to restate, and it cannot invent a finding because the id it
 * gives is checked against the ones supplied.
 *
 * The prompt still prohibits invention in words (Phase 14's brief requires it),
 * but the prohibition is not what enforces this. The shape is.
 */

import type { AiResponseMeta } from "@/lib/ai/types";
import type { Finding } from "@/lib/types/finding";

// ---------------------------------------------------------------------------
// What the model returns
// ---------------------------------------------------------------------------

/** One problem the model chose to highlight, as the model expresses it. */
export interface DraftProblem {
  /** Must be the id of a finding that was supplied. Checked, not trusted. */
  readonly findingId: string;
  /** Why this matters to this site's visitors or owner, in plain language. */
  readonly whyItMatters: string;
  /** What to do about it. Actionable, specific, no hedging. */
  readonly recommendation: string;
}

/** One thing the site does well, as the model expresses it. */
export interface DraftStrength {
  /** Must be the id of a **passing** finding that was supplied. */
  readonly findingId: string;
  readonly whyItHelps: string;
}

/**
 * The model's raw answer, after schema validation but before verification.
 *
 * Never used directly. `verifyInterpretation` decides whether it may become an
 * `AiInterpretation`.
 */
export interface InterpretationDraft {
  readonly executiveSummary: string;
  readonly strengths: readonly DraftStrength[];
  readonly problems: readonly DraftProblem[];
}

// ---------------------------------------------------------------------------
// What the application uses
// ---------------------------------------------------------------------------

/**
 * A problem, joined back to the finding that proves it.
 *
 * Severity, category, evidence and the deterministic explanation are read
 * through `finding`. They are not copied, so the model's words and the
 * analyzer's facts cannot drift apart (ADR-029).
 */
export interface InterpretedProblem {
  readonly finding: Finding;
  /** The model's words. */
  readonly whyItMatters: string;
  /** The model's words. */
  readonly recommendation: string;
  /** Position in Phase 13's ranking, when a ranked list was supplied. */
  readonly deterministicRank: number | null;
}

export interface InterpretedStrength {
  readonly finding: Finding;
  /** The model's words. */
  readonly whyItHelps: string;
}

/** A verified interpretation, safe to show. */
export interface AiInterpretation {
  readonly executiveSummary: string;
  readonly strengths: readonly InterpretedStrength[];
  readonly problems: readonly InterpretedProblem[];
  readonly meta: AiResponseMeta;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Why a model answer was refused.
 *
 * One vocabulary for every AI feature, not just this one. The last two are
 * raised by Phase 15's roast rather than here — they live alongside the rest
 * because "why an answer was discarded" is a single question a caller asks, and
 * two overlapping enumerations of it would be worse than one shared list.
 */
export const VIOLATION_KINDS = [
  /** Referenced a finding that was never supplied. */
  "unknown_finding",
  /** Called a failing check a strength, or a passing check a problem. */
  "contradicts_status",
  /** Stated a measurement that appears nowhere in the evidence. */
  "invented_measurement",
  /** Claimed a site is secure, or named a vulnerability nothing established. */
  "unsupported_security_claim",
  /** Promised a ranking outcome. */
  "unsupported_seo_claim",
  /** Said nothing usable — an empty summary, or no problems at all. */
  "empty_content",
  /** Phase 15: aimed a line at a person rather than at the website (ADR-015). */
  "abusive_tone",
  /** Phase 15: used the same joke twice. */
  "repeated_punchline",
] as const;

export type ViolationKind = (typeof VIOLATION_KINDS)[number];

export interface Violation {
  readonly kind: ViolationKind;
  /** Where it was found, e.g. `problems[2].whyItMatters`. */
  readonly location: string;
  /** What was wrong, in words. */
  readonly detail: string;
  /** The offending excerpt, truncated. */
  readonly excerpt: string;
}
