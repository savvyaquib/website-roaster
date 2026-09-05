/**
 * Phase 13 — the recommendation engine.
 *
 * Import from `@/lib/recommendations`; the internal modules are implementation
 * detail.
 */

export {
  buildRecommendations,
  recommendationsAtLeast,
  topRecommendations,
  type RecommendationInput,
} from "./build-recommendations";

export {
  compareRecommendations,
  rankRecommendations,
  tierLabel,
  type UnrankedRecommendation,
} from "./rank";

export {
  IMPACT_BANDS,
  IMPACT_LEVEL_ORDER,
  impactLevelFor,
  SEVERITY_ORDER,
  STATUS_ORDER,
  TIER_LABELS,
  tierFor,
} from "./tiers";

export { impactFor, weightBasisFor } from "./impact";

export { deriveTitle, MAX_TITLE_LENGTH, type DerivedTitle } from "./title";

export type {
  ImpactLevel,
  PriorityTier,
  Recommendation,
  RecommendationImpact,
  RecommendationKind,
  RecommendationReport,
  RecommendationSummary,
  TitleSource,
  WeightBasis,
} from "./types";
