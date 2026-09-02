/**
 * Phase 7 — Accessibility analyzer.
 *
 * Import from `@/lib/analysis/accessibility`; the internal modules are
 * implementation detail.
 */

export { analyzeAccessibility } from "./analyze-accessibility";

export {
  DEFAULT_AUDIT_TIMEOUT_MS,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  DEFAULT_SETTLE_MS,
  runAxe,
  type RunAxeOptions,
} from "./run-axe";

export {
  findingIdForRule,
  MAX_REPORTED_NODES,
  normalizeAxeResults,
  RULE_ID_PREFIX,
  severityForImpact,
} from "./normalize";

export {
  ACCESSIBILITY_FAILURE_CODES,
  type AccessibilityAnalysisInput,
  type AccessibilityFailure,
  type AccessibilityFailureCode,
  type AxeAudit,
  type AxeAuditResults,
  type AxeNode,
  type AxeRule,
} from "./types";
