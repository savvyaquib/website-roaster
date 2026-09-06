/**
 * Phase 15 — the roast engine.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 15, ADR-015, ADR-016, ADR-056.
 *
 * ## This always returns a roast
 *
 * There is no failure path. No provider configured, a timeout, a rate limit, a
 * malformed answer, an answer that broke a rule — every one of them falls
 * through to the written table, and the caller gets a roast either way with
 * `source` and `fallbackReason` saying which happened and why.
 *
 * That is a deliberate difference from Phase 14, where a failed interpretation
 * simply omits a section. A roast can be pre-written; an interpretation of this
 * specific page cannot, so there is nothing to fall back to there.
 *
 * ## The roast does not touch the score
 *
 * Nothing here is imported by `lib/scoring`, and the scoring engine takes only
 * findings and raw measurements (ADR-002). A test asserts the dependency runs
 * one way, because "the roast must not be the source of the score" is easy to
 * agree with and easy to break later with one convenient import.
 */

import type { AiAvailability } from "@/lib/ai";
import type { AiCallOptions, JsonValue } from "@/lib/ai/types";
import type { RecommendationReport } from "@/lib/recommendations";
import type { Finding } from "@/lib/types/finding";

import { buildDeterministicRoast, NOTHING_TO_ROAST } from "./fallback";
import { buildRoastPrompt } from "./prompt";
import { roastSchema } from "./schema";
import { DEFAULT_LINE_COUNT, observationFor, selectRoastTargets } from "./select";
import { punchlineFor } from "./templates";
import type { Roast, RoastLine } from "./types";
import { verifyRoast } from "./verify";

export interface RoastRequest {
  readonly url: string;
  readonly findings: readonly Finding[];
  /** Phase 13's ranking, so the roast is about what the report leads with. */
  readonly recommendations?: RecommendationReport;
  readonly lineCount?: number;
}

/**
 * Write a roast.
 *
 * Tries the model; falls back to the written table on any problem. Never
 * throws, never rejects.
 */
export async function generateRoast(
  availability: AiAvailability,
  request: RoastRequest,
  options: AiCallOptions = {},
): Promise<Roast> {
  const lineCount = request.lineCount ?? DEFAULT_LINE_COUNT;
  const targets = selectRoastTargets(
    request.findings,
    request.recommendations,
    lineCount,
  );

  // Nothing to roast is not a failure and needs no model. Asking one anyway
  // would be inviting it to find something, which is the fabrication ADR-015
  // rules out.
  if (targets.length === 0) {
    return {
      lines: [],
      source: "deterministic",
      fallbackReason: null,
      note: NOTHING_TO_ROAST,
      meta: null,
    };
  }

  const fallback = (reason: string): Roast =>
    buildDeterministicRoast({
      findings: request.findings,
      ...(request.recommendations === undefined
        ? {}
        : { recommendations: request.recommendations }),
      lineCount,
      reason,
    });

  if (!availability.available) {
    return fallback(availability.reason);
  }

  const evidence = roastEvidence(targets);
  const selectedById = new Map(targets.map((finding) => [finding.id, finding]));

  let result;

  try {
    result = await availability.provider.generate(
      {
        task: "roast",
        instruction: buildRoastPrompt({ url: request.url }),
        evidence,
        schema: roastSchema,
        maxOutputTokens: 800,
        // Some variation is wanted here, unlike everywhere else in this
        // codebase: a roast written at zero reads like a form letter. It stays
        // low, because the checks that follow are cheaper to pass than to fail.
        temperature: 0.7,
      },
      options,
    );
  } catch (cause) {
    return fallback(
      `The provider threw instead of returning a failure: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!result.ok) {
    return fallback(result.error.message);
  }

  const violations = verifyRoast({ draft: result.data, selectedById, evidence });

  if (violations.length > 0) {
    const kinds = [...new Set(violations.map((violation) => violation.kind))];
    return fallback(
      `The roast was discarded: ${violations.length} rule violation(s) (${kinds.join(", ")}).`,
    );
  }

  // A model that answered about only some of the findings has written a
  // shorter roast, not a broken one, so the lines it did write are kept.
  const lines: RoastLine[] = result.data.lines.map((line) => {
    const finding = selectedById.get(line.findingId)!;

    return {
      finding,
      observation: observationFor(finding),
      punchline: line.punchline,
    };
  });

  if (lines.length === 0) {
    return fallback("The model returned no roast lines.");
  }

  return {
    lines,
    source: "ai",
    fallbackReason: null,
    note: null,
    meta: result.meta,
  };
}

/**
 * What the model sees.
 *
 * Only the findings it is roasting, each with the observation already written.
 * Not the score, not the page content, not the other findings — a roast needs
 * the joke's subject and nothing else, and a smaller payload is a cheaper call
 * and a smaller surface for invention.
 */
function roastEvidence(targets: readonly Finding[]): JsonValue {
  return {
    findings: targets.map((finding) => ({
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      observation: observationFor(finding),
      whyItMatters: finding.explanation,
    })),
  };
}

/** The punchline a finding would get with no model. Exported for previews. */
export { punchlineFor };
