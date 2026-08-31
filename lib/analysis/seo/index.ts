/**
 * Phase 5 — SEO analyzer.
 *
 * Import from `@/lib/analysis/seo`; the internal modules are implementation
 * detail.
 */

export { analyzeSeo } from "./analyze-seo";

export { fetchSiteFiles, type FetchSiteFilesOptions } from "./fetch-site-files";

export { parseRobotsTxt, type RobotsTxt } from "./robots-txt";

export {
  META_DESCRIPTION_LENGTH,
  ROBOTS_TXT_PATH,
  SITEMAP_FALLBACK_PATHS,
  TITLE_LENGTH,
} from "./thresholds";

export type { SeoAnalysisInput, SiteFileResult, SiteFiles } from "./types";
