/**
 * Phase 6 — Security analyzer.
 *
 * Import from `@/lib/analysis/security`; the internal modules are
 * implementation detail.
 */

export { analyzeSecurity } from "./analyze-security";

export {
  parseSetCookie,
  parseSetCookies,
  type ParsedCookie,
  type SameSite,
} from "./cookies";

export {
  effectiveSources,
  parseCsp,
  parseHsts,
  type CspDirectives,
  type HstsDirectives,
} from "./directives";

export {
  HSTS_MIN_MAX_AGE_SECONDS,
  RISKY_CSP_SOURCES,
  TECHNOLOGY_HEADERS,
  UNSAFE_REFERRER_POLICIES,
} from "./thresholds";

export type { SecurityAnalysisInput } from "./types";
