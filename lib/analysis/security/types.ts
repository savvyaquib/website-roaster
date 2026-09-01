/**
 * Security analyzer input.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 6.
 */

import type { HttpResponseData } from "@/lib/analysis/http";

export interface SecurityAnalysisInput {
  /** The response from Phase 2, which carries the headers and cookies. */
  readonly response: HttpResponseData;
}
