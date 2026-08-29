/**
 * Phase 1 — URL validation.
 *
 * Import from `@/lib/analysis/url`; the internal modules are implementation
 * detail.
 */

export { validateUrl } from "./validate-url";
export {
  analysisStatusForRejection,
  URL_REJECTION_CODES,
  type InvalidUrlResult,
  type UrlRejectionCode,
  type UrlValidationResult,
  type ValidUrlResult,
} from "./types";
