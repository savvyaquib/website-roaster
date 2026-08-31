/**
 * SEO analyzer inputs.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 5.
 *
 * The analyzer emits the canonical `Finding` type (ADR-029) and nothing else.
 * It produces no score — turning findings into numbers is Phase 12's job, and
 * keeping the two apart is what makes a score explainable (ADR-001).
 */

import type { PageData } from "@/lib/analysis/dom";

/**
 * The outcome of retrieving one site-level file.
 *
 * `null` anywhere a `SiteFileResult` is expected means the file was never
 * looked for — which is reported as `could_not_determine`, never as a pass
 * (ADR-021).
 */
export interface SiteFileResult {
  /** The URL that was requested. */
  readonly url: string;
  /** HTTP status, or `null` if the request never completed. */
  readonly status: number | null;
  /** True only for a 2xx response. */
  readonly found: boolean;
  /** Response body, when one was retrieved. */
  readonly body: string | null;
  /** Why the request failed, when it did. */
  readonly error: string | null;
}

export interface SiteFiles {
  /** `null` when robots.txt was not checked. */
  readonly robotsTxt: SiteFileResult | null;
  /** `null` when no sitemap lookup was attempted. */
  readonly sitemap: SiteFileResult | null;
  /** Sitemap URLs declared by robots.txt, in the order they appeared. */
  readonly declaredSitemaps: readonly string[];
}

export interface SeoAnalysisInput {
  /** The normalized page from Phase 4. */
  readonly page: PageData;
  /**
   * Site-level files retrieved by `fetchSiteFiles`.
   *
   * Optional: without it, the robots.txt and sitemap checks report
   * `could_not_determine` rather than being silently skipped.
   */
  readonly siteFiles?: SiteFiles;
}
