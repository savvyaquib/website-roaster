/**
 * The roast.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 15, docs/DECISIONS.md ADR-015,
 * ADR-055, ADR-056.
 *
 * ## A roast line is an observation plus a punchline
 *
 * `docs/IMPLEMENTATION.md`'s own example is exactly that shape:
 *
 * ```text
 * Your homepage has four CTAs.
 *
 * Apparently your design strategy is
 * "let the visitor choose their destiny."
 * ```
 *
 * A fact, then the joke about it. So the two halves are stored separately, and
 * **only the punchline is ever written by a model.** The observation is taken
 * from the finding's own evidence, which is the same principle Phase 14
 * established: the application supplies facts, the model supplies words
 * (ADR-055).
 *
 * That is what makes "avoid fabricated problems" structural rather than
 * aspirational. A model writing this roast has no field in which to state a
 * fact, and the finding it is joking about was chosen before it was asked.
 */

import type { AiResponseMeta } from "@/lib/ai/types";
import type { Finding } from "@/lib/types/finding";

/** Where a roast's words came from. */
export type RoastSource =
  /** A model wrote the punchlines. */
  | "ai"
  /** Written from the template table, because AI was unavailable or refused. */
  | "deterministic";

export interface RoastLine {
  /** The finding this line is about. The fact, from the analyzers. */
  readonly finding: Finding;
  /**
   * What was observed, in one sentence.
   *
   * Derived from the finding's evidence, never from a model.
   */
  readonly observation: string;
  /** The joke. From a model, or from the template table. */
  readonly punchline: string;
}

export interface Roast {
  readonly lines: readonly RoastLine[];
  readonly source: RoastSource;
  /**
   * Why the deterministic path was used. Null when a model wrote it.
   *
   * Always specific — "AI_API_KEY is not set", "the answer referenced a finding
   * that was not supplied" — because a roast that silently changed voice is
   * confusing to whoever has to explain it.
   */
  readonly fallbackReason: string | null;
  /**
   * Something worth saying about the roast itself, rather than the site.
   *
   * Set when there was nothing to roast. Never a joke, and never a problem.
   */
  readonly note: string | null;
  /** The AI call's metadata, when there was one. */
  readonly meta: AiResponseMeta | null;
}

/** What a model returns: a reference and a joke, and nothing else. */
export interface DraftRoastLine {
  readonly findingId: string;
  readonly punchline: string;
}

export interface RoastDraft {
  readonly lines: readonly DraftRoastLine[];
}
