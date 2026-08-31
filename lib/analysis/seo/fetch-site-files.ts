/**
 * Retrieval of robots.txt and the sitemap.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 5, docs/DECISIONS.md ADR-035.
 *
 * These go through the **Phase 2 client**, not a bare fetch. They are not
 * exempt from the SSRF controls for being "our own" requests: the origin they
 * target comes from a user-submitted URL, and a redirect from robots.txt is as
 * dangerous as a redirect from the page itself.
 *
 * This is the only part of Phase 5 that touches the network. Every check is a
 * pure function; the results retrieved here are passed into them as data.
 */

import { fetchPage, type FetchPageOptions } from "@/lib/analysis/http";
import { createLogger, type Logger } from "@/lib/observability/logger";

import { parseRobotsTxt } from "./robots-txt";
import { ROBOTS_TXT_PATH, SITEMAP_FALLBACK_PATHS } from "./thresholds";
import type { SiteFileResult, SiteFiles } from "./types";

/**
 * Media types accepted for site files.
 *
 * The Phase 2 client downloads HTML only by default. robots.txt is plain text
 * and a sitemap is XML, so both are requested explicitly — servers are
 * inconsistent about which of these they declare.
 */
const SITE_FILE_MEDIA_TYPES: readonly string[] = [
  "text/plain",
  "text/xml",
  "application/xml",
  "text/html",
  "application/rss+xml",
  "application/atom+xml",
];

/** Site files are small; a page-sized budget would be far too generous. */
const SITE_FILE_MAX_BYTES = 512 * 1024;

const SITE_FILE_TIMEOUT_MS = 10_000;

export interface FetchSiteFilesOptions {
  readonly logger?: Logger;
  /** Passed through to the Phase 2 client, so tests can reach a local server. */
  readonly fetchOptions?: FetchPageOptions;
}

/**
 * Retrieve robots.txt and the sitemap for a page's origin.
 *
 * Never throws. A file that could not be retrieved is reported as such, and the
 * checks turn that into `could_not_determine` rather than a pass (ADR-021).
 */
export async function fetchSiteFiles(
  pageUrl: string,
  options: FetchSiteFilesOptions = {},
): Promise<SiteFiles> {
  const log = options.logger ?? createLogger("analysis.seo");

  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    // Without an origin there is nothing to request. Reporting "not checked"
    // keeps the checks honest.
    return { robotsTxt: null, sitemap: null, declaredSitemaps: [] };
  }

  const robotsTxt = await retrieve(new URL(ROBOTS_TXT_PATH, origin).href, options, log);

  const declaredSitemaps =
    robotsTxt.body === null ? [] : parseRobotsTxt(robotsTxt.body).sitemaps;

  // A declaration in robots.txt wins over the conventional path: it is the
  // site telling us where its sitemap actually is.
  const sitemapUrl =
    declaredSitemaps[0] ??
    new URL(SITEMAP_FALLBACK_PATHS[0] ?? "/sitemap.xml", origin).href;

  const sitemap = await retrieve(sitemapUrl, options, log);

  log.info("seo.site_files.retrieved", {
    robotsFound: robotsTxt.found,
    sitemapFound: sitemap.found,
    declaredSitemaps: declaredSitemaps.length,
  });

  return { robotsTxt, sitemap, declaredSitemaps };
}

async function retrieve(
  url: string,
  options: FetchSiteFilesOptions,
  log: Logger,
): Promise<SiteFileResult> {
  const result = await fetchPage(url, {
    timeoutMs: SITE_FILE_TIMEOUT_MS,
    maxBytes: SITE_FILE_MAX_BYTES,
    downloadMediaTypes: SITE_FILE_MEDIA_TYPES,
    ...options.fetchOptions,
  });

  if (!result.ok) {
    log.debug("seo.site_file.failed", { url, code: result.failure.code });
    return {
      url,
      status: null,
      found: false,
      body: null,
      error: result.failure.code,
    };
  }

  const { response } = result;
  const found = response.status >= 200 && response.status < 300;

  return {
    url: response.finalUrl,
    status: response.status,
    found,
    body: found ? response.body : null,
    error: null,
  };
}
