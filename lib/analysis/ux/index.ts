/**
 * Phase 11 — UX heuristics.
 *
 * Import from `@/lib/analysis/ux`; the internal modules are implementation
 * detail.
 */

export { analyzeUx } from "./analyze-ux";

export { collectUxSignals } from "./collect-signals";

export {
  BUSY_NAVIGATION_LINKS,
  DEEP_DOM_NESTING,
  DEEP_NAVIGATION_NESTING,
  HIGH_INTERACTIVE_DENSITY,
  HIGH_REPETITION,
  LONG_FORM_FIELDS,
  MANY_PRIMARY_ACTIONS,
  MIN_WORDS_FOR_DENSITY,
} from "./thresholds";

export type {
  ActionSignals,
  DensitySignals,
  FormSignals,
  HeadingSignals,
  HierarchySignals,
  NavigationSignals,
  RepeatedBlock,
  RepetitionSignals,
  UxAnalysisInput,
  UxSignals,
} from "./types";
