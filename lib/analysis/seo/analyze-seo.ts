/**
 * Phase 5 — SEO analyzer.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 5, docs/DECISIONS.md ADR-045.
 *
 * Evaluates technical SEO fundamentals and emits the canonical `Finding` type
 * (ADR-029). It produces **no score**: turning findings into numbers is
 * Phase 12's job, and keeping evidence collection apart from scoring is what
 * makes a score explainable (ADR-001, ADR-002).
 *
 * ## Pure, apart from what is handed to it
 *
 * `analyzeSeo` performs no I/O. The site-level files it needs are retrieved
 * separately by `fetchSiteFiles` and passed in as data, which keeps every check
 * deterministic and unit-testable.
 *
 * Omitting them is allowed, and produces `could_not_determine` for the robots
 * and sitemap checks — never a pass (ADR-021).
 */

import type { Finding } from "@/lib/types/finding";

import {
  checkH1,
  checkHeadingStructure,
  checkMetaDescription,
  checkTitle,
} from "./checks/content";
import {
  checkCanonical,
  checkLanguage,
  checkRobotsMeta,
  checkViewport,
} from "./checks/metadata";
import {
  checkImageAlt,
  checkInternalLinks,
  checkStructuredData,
} from "./checks/resources";
import { checkRobotsTxt, checkSitemap } from "./checks/site-files";
import type { SeoAnalysisInput } from "./types";

/**
 * Run every SEO check.
 *
 * Findings are returned in a fixed order — indexing directives first, then page
 * metadata, structure and resources — so the output is deterministic and two
 * runs of the same page are directly comparable.
 */
export function analyzeSeo(input: SeoAnalysisInput): Finding[] {
  const { page, siteFiles } = input;

  return [
    // Anything that can remove the page from search entirely comes first.
    ...checkRobotsMeta(page),
    ...checkRobotsTxt(siteFiles),

    ...checkTitle(page),
    ...checkMetaDescription(page),
    ...checkCanonical(page),
    ...checkLanguage(page),
    ...checkViewport(page),

    ...checkH1(page),
    ...checkHeadingStructure(page),

    ...checkImageAlt(page),
    ...checkInternalLinks(page),
    ...checkStructuredData(page),
    ...checkSitemap(siteFiles),
  ];
}
