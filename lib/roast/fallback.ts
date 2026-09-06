/**
 * The roast that needs no model.
 *
 * Source of truth: ADR-015, ADR-016, ADR-056.
 *
 * Phase 15's brief requires fallback behaviour when AI is unavailable, and
 * ADR-016 requires the product to work without it. So this is not a degraded
 * placeholder — it is a complete roast, built from the same selected findings
 * and the same observations the AI path uses, with punchlines from the written
 * table instead of from a model.
 *
 * Pure and deterministic: the same findings always produce the same roast. No
 * randomness, deliberately — a roast that changed every time it was reloaded
 * would look like the report had changed, and there is nothing to gain from
 * shuffling a list of four jokes.
 */

import type { RecommendationReport } from "@/lib/recommendations";
import type { Finding } from "@/lib/types/finding";

import { DEFAULT_LINE_COUNT, observationFor, selectRoastTargets } from "./select";
import { punchlineFor } from "./templates";
import type { Roast, RoastLine } from "./types";

/** Said when the analyzers found nothing worth roasting. */
export const NOTHING_TO_ROAST =
  "No failing or warning checks were found, so there is nothing here to roast. That is not a joke and not a compliment — it is what the analyzers found.";

export interface DeterministicRoastInput {
  readonly findings: readonly Finding[];
  readonly recommendations?: RecommendationReport;
  readonly lineCount?: number;
  /** Why the model was not used. Recorded on the roast. */
  readonly reason: string;
}

/**
 * Build a roast from the template table.
 *
 * Never fails. A site with no problems yields a roast with no lines and a note
 * saying so, rather than a manufactured complaint — inventing a problem to have
 * something to say is the one thing ADR-015 rules out.
 */
export function buildDeterministicRoast(input: DeterministicRoastInput): Roast {
  const targets = selectRoastTargets(
    input.findings,
    input.recommendations,
    input.lineCount ?? DEFAULT_LINE_COUNT,
  );

  const lines: RoastLine[] = targets.map((finding) => ({
    finding,
    observation: observationFor(finding),
    punchline: punchlineFor(finding),
  }));

  return {
    lines,
    source: "deterministic",
    fallbackReason: input.reason,
    note: lines.length === 0 ? NOTHING_TO_ROAST : null,
    meta: null,
  };
}
