/**
 * Phase 14 — AI interpretation.
 *
 * Source of truth: docs/DECISIONS.md ADR-003, ADR-014, ADR-016, ADR-055.
 *
 * Assemble evidence, ask the model, check the answer, join it back to the
 * findings that prove it.
 *
 * ## This can fail, and failing is fine
 *
 * `interpretAnalysis` never throws and never rejects. Every outcome — no
 * provider configured, a timeout, a rate limit, a malformed answer, an answer
 * that broke a rule — comes back as `ok: false` with an `AiError` carrying a
 * message fit to show a person. ADR-016 requires the deterministic report to
 * stand on its own, and the caller's job is to render it either way.
 *
 * ## The AI adds words, never facts
 *
 * The returned interpretation holds `Finding` references, not restated
 * findings. Severity, category, evidence and status are read from the analyzer
 * output; only prose comes from the model.
 */

import { AiError } from "@/lib/ai/errors";
import type { AiAvailability } from "@/lib/ai/resolve-provider";
import type { AiCallOptions, AiImage, AiResponseMeta } from "@/lib/ai/types";
import type { Finding } from "@/lib/types/finding";

import { assembleEvidence } from "./evidence";
import type { InterpretationInput } from "./evidence";
import { buildInterpretationPrompt } from "./prompt";
import { interpretationSchema } from "./schema";
import type {
  AiInterpretation,
  InterpretationDraft,
  InterpretedProblem,
  InterpretedStrength,
  Violation,
} from "./types";
import { verifyInterpretation } from "./verify";

/** Output tokens allowed. Enough for a summary plus a dozen short entries. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

export interface InterpretRequest extends InterpretationInput {
  /**
   * Screenshots, by value.
   *
   * Optional: a model that cannot see the page still has every finding, and
   * ADR-016 means an interpretation without images is better than none.
   */
  readonly screenshots?: readonly AiImage[];
  readonly maxOutputTokens?: number;
}

export type InterpretationResult =
  | { readonly ok: true; readonly interpretation: AiInterpretation }
  | {
      readonly ok: false;
      readonly error: AiError;
      /** Present when the answer arrived but broke a rule. */
      readonly violations: readonly Violation[];
    };

/**
 * Interpret an analysis.
 *
 * @param availability from `resolveAiProvider`. An unavailable one is not an
 *   error to handle here — it produces a `not_configured` result, which is the
 *   ordinary case for an installation with no key.
 */
export async function interpretAnalysis(
  availability: AiAvailability,
  request: InterpretRequest,
  options: AiCallOptions = {},
): Promise<InterpretationResult> {
  if (!availability.available) {
    return { ok: false, error: availability.error, violations: [] };
  }

  const { evidence, findingsById, ranksByFindingId } = assembleEvidence(request);

  // A provider is contractually required to return failures rather than throw
  // (ADR-054). This catches the case where one breaks that contract anyway —
  // an SDK raising on a malformed URL, a `fetch` implementation throwing
  // synchronously. ADR-016's guarantee is the most important thing this module
  // has, and it should not rest on every adapter being well behaved.
  let result;

  try {
    result = await availability.provider.generate(
      {
        task: "interpretation",
        instruction: buildInterpretationPrompt({ url: request.url }),
        evidence,
        ...(request.screenshots === undefined ? {} : { images: request.screenshots }),
        schema: interpretationSchema,
        maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        temperature: 0,
      },
      options,
    );
  } catch (cause) {
    return {
      ok: false,
      violations: [],
      error: new AiError({
        code: "unknown",
        provider: availability.provider.name,
        message: `The provider threw instead of returning a failure: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
    };
  }

  if (!result.ok) {
    return { ok: false, error: result.error, violations: [] };
  }

  const violations = verifyInterpretation({
    draft: result.data,
    evidence,
    findingsById,
  });

  if (violations.length > 0) {
    return {
      ok: false,
      violations,
      error: new AiError({
        code: "malformed_output",
        provider: result.meta.provider,
        message: `The interpretation was discarded: ${describeViolations(violations)}`,
        issues: violations.map(
          (violation) => `${violation.location}: ${violation.detail}`,
        ),
      }),
    };
  }

  return {
    ok: true,
    interpretation: resolve(result.data, findingsById, ranksByFindingId, result.meta),
  };
}

/** Join the model's words back to the findings that prove them. */
function resolve(
  draft: InterpretationDraft,
  findingsById: ReadonlyMap<string, Finding>,
  ranksByFindingId: ReadonlyMap<string, number>,
  meta: AiResponseMeta,
): AiInterpretation {
  const problems: InterpretedProblem[] = draft.problems.map((problem) => ({
    // Verification has already established the id resolves.
    finding: findingsById.get(problem.findingId)!,
    whyItMatters: problem.whyItMatters,
    recommendation: problem.recommendation,
    deterministicRank: ranksByFindingId.get(problem.findingId) ?? null,
  }));

  const strengths: InterpretedStrength[] = draft.strengths.map((strength) => ({
    finding: findingsById.get(strength.findingId)!,
    whyItHelps: strength.whyItHelps,
  }));

  return { executiveSummary: draft.executiveSummary, strengths, problems, meta };
}

function describeViolations(violations: readonly Violation[]): string {
  const kinds = [...new Set(violations.map((violation) => violation.kind))];

  return `${violations.length} rule violation(s) (${kinds.join(", ")}).`;
}
