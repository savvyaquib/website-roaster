/**
 * The scoring version.
 *
 * Source of truth: docs/SCORING.md, docs/DECISIONS.md ADR-013, ADR-022.
 *
 * Recorded with every score so an old number stays interpretable after the
 * model changes. Increment on **any** change to the weights, the grade bands,
 * the deduction table or the metric curves — the meaning of a score is the sum
 * of all four, and a silent change to any one makes historical scores
 * incomparable.
 *
 * Changing this without updating docs/SCORING.md, or the reverse, is a defect.
 * A test asserts the two agree.
 */
export const SCORING_VERSION = 1;
