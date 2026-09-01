/**
 * robots.txt and sitemap checks.
 *
 * Pure functions over the retrieval results. When a file was never checked —
 * `null` — the finding is `could_not_determine`, never `pass`: we have not
 * established that the site is fine, only that we did not look (ADR-021).
 */

import type { Finding } from "@/lib/types/finding";

import { couldNotDetermine, httpEvidence, preview, seoFinding } from "../finding-builder";
import { parseRobotsTxt } from "../robots-txt";
import type { SiteFiles } from "../types";

export function checkRobotsTxt(siteFiles: SiteFiles | undefined): Finding[] {
  const result = siteFiles?.robotsTxt;

  if (result === undefined || result === null) {
    return [
      couldNotDetermine(
        "seo.robots_txt.not_checked",
        "robots.txt was not retrieved.",
        "Whether this site has a robots.txt could not be established, so nothing is claimed about it either way.",
        "Re-run the analysis with site-file retrieval enabled, or open /robots.txt yourself to confirm.",
      ),
    ];
  }

  if (result.error !== null) {
    return [
      couldNotDetermine(
        "seo.robots_txt.unreachable",
        `Requesting ${result.url} failed: ${result.error}.`,
        "robots.txt could not be retrieved, so whether crawlers are blocked is unknown.",
        "Check that /robots.txt is reachable, then re-run the analysis.",
      ),
    ];
  }

  if (!result.found) {
    return [
      seoFinding({
        id: "seo.robots_txt.missing",
        severity: "minor",
        status: "warn",
        evidence: [httpEvidence(`${result.url} returned HTTP ${result.status ?? "?"}.`)],
        explanation:
          "There is no robots.txt. Crawlers treat that as permission to crawl everything, so the site still works — but there is nowhere to declare a sitemap or exclude private paths.",
        recommendation:
          "Add a robots.txt declaring your sitemap, even if it allows everything.",
      }),
    ];
  }

  const parsed = parseRobotsTxt(result.body ?? "");
  const evidence = httpEvidence(
    `${result.url} returned HTTP ${result.status ?? "?"} with ${parsed.groupCount} directive group(s).`,
    preview(result.body ?? "", 200),
  );

  if (parsed.disallowsEverything) {
    return [
      seoFinding({
        id: "seo.robots_txt.disallows_all",
        severity: "critical",
        status: "fail",
        evidence: [evidence],
        explanation:
          "robots.txt tells every crawler to stay off the entire site, so no page here will be crawled. Like a stray noindex, this is usually left over from a staging environment.",
        recommendation:
          "Remove the site-wide Disallow: / rule unless the site is deliberately hidden from search engines.",
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.robots_txt.ok",
      severity: "info",
      status: "pass",
      evidence: [evidence],
      explanation: "robots.txt is present and does not block the whole site.",
      recommendation:
        "Keep robots.txt in step with the paths you want crawled, and keep the sitemap declaration current.",
    }),
  ];
}

export function checkSitemap(siteFiles: SiteFiles | undefined): Finding[] {
  const result = siteFiles?.sitemap;

  if (result === undefined || result === null) {
    return [
      couldNotDetermine(
        "seo.sitemap.not_checked",
        "No sitemap lookup was performed.",
        "Whether this site publishes a sitemap could not be established.",
        "Re-run the analysis with site-file retrieval enabled, or open /sitemap.xml yourself to confirm.",
      ),
    ];
  }

  const declared = siteFiles?.declaredSitemaps ?? [];
  const declaredEvidence =
    declared.length > 0
      ? httpEvidence(
          `robots.txt declares ${declared.length} sitemap(s).`,
          preview(declared.join(", "), 200),
        )
      : httpEvidence("robots.txt declares no sitemap; the conventional path was tried.");

  if (result.error !== null) {
    return [
      couldNotDetermine(
        "seo.sitemap.unreachable",
        `Requesting ${result.url} failed: ${result.error}.`,
        "The sitemap could not be retrieved, so whether one exists is unknown.",
        "Check that the sitemap URL is reachable, then re-run the analysis.",
      ),
    ];
  }

  if (!result.found) {
    return [
      seoFinding({
        id: "seo.sitemap.missing",
        // A sitemap declared in robots.txt but not served is a broken promise,
        // which is worse than never having declared one.
        severity: declared.length > 0 ? "moderate" : "minor",
        status: declared.length > 0 ? "fail" : "warn",
        evidence: [
          httpEvidence(`${result.url} returned HTTP ${result.status ?? "?"}.`),
          declaredEvidence,
        ],
        explanation:
          declared.length > 0
            ? "robots.txt points at a sitemap that cannot be retrieved, so crawlers following it find nothing."
            : "No sitemap was found. Search engines can still crawl by following links, but a sitemap helps them discover pages that are linked indirectly.",
        recommendation:
          declared.length > 0
            ? "Serve the sitemap at the declared URL, or correct the declaration in robots.txt."
            : "Publish a sitemap.xml and declare it in robots.txt.",
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.sitemap.ok",
      severity: "info",
      status: "pass",
      evidence: [
        httpEvidence(`${result.url} returned HTTP ${result.status ?? "?"}.`),
        declaredEvidence,
      ],
      explanation: "A sitemap is published and reachable.",
      recommendation: "Keep the sitemap up to date as pages are added or removed.",
    }),
  ];
}
