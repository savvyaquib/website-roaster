/**
 * Phase 10 — Content analyzer.
 *
 * Import from `@/lib/analysis/content`; the internal modules are
 * implementation detail.
 */

export { analyzeContent } from "./analyze-content";

export { extractContent } from "./extract-content";

export {
  CTA_REPETITION_LIMIT,
  LIGHT_CONTENT_WORDS,
  MANY_DISTINCT_CTAS,
  THIN_CONTENT_WORDS,
} from "./patterns";

export type {
  CallToAction,
  ContactInformation,
  ContentAnalysisInput,
  ContentInventory,
  ContentSection,
  DetectionMethod,
  FooterContent,
  HeroContent,
  SectionKind,
  TrustSignal,
} from "./types";
