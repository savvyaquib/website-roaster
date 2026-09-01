/**
 * Canonical, robots meta, language and viewport checks.
 *
 * Pure functions over `PageData`.
 */

import type { PageData } from "@/lib/analysis/dom";
import type { Finding } from "@/lib/types/finding";

import { domEvidence, preview, seoFinding } from "../finding-builder";

export function checkCanonical(page: PageData): Finding[] {
  if (page.canonical === null) {
    return [
      seoFinding({
        id: "seo.canonical.missing",
        severity: "minor",
        status: "warn",
        evidence: [domEvidence('There is no <link rel="canonical"> tag.')],
        explanation:
          "Without a canonical URL, the same content reached through different URLs — tracking parameters, trailing slashes, http and https — can be treated as separate pages.",
        recommendation:
          "Add a canonical link pointing at the preferred URL for this page.",
      }),
    ];
  }

  const evidence = domEvidence("A canonical URL is declared.", page.canonical);

  // A canonical pointing at a different host is legitimate for syndicated
  // content and wrong almost everywhere else, so it is reported without being
  // called a failure.
  const pageHost = safeHost(page.url);
  const canonicalHost = safeHost(page.canonical);

  if (pageHost !== null && canonicalHost !== null && pageHost !== canonicalHost) {
    return [
      seoFinding({
        id: "seo.canonical.cross_origin",
        severity: "moderate",
        status: "warn",
        evidence: [evidence, domEvidence(`The page is served from ${pageHost}.`)],
        explanation:
          "The canonical URL points at a different site, which tells search engines to credit that site with this content instead.",
        recommendation:
          "Confirm this is intended. If the content is original to this site, point the canonical at this page.",
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.canonical.ok",
      severity: "info",
      status: "pass",
      evidence: [evidence],
      explanation: "The page declares a canonical URL.",
      recommendation:
        "Keep the canonical pointing at this page's preferred URL if the URL structure changes.",
    }),
  ];
}

/**
 * The robots meta tag.
 *
 * `noindex` is reported as critical: it is the single directive that removes a
 * page from search results entirely, and it is frequently left behind by
 * accident after a staging deployment.
 */
export function checkRobotsMeta(page: PageData): Finding[] {
  if (page.robots === null) {
    return [
      seoFinding({
        id: "seo.robots_meta.absent",
        severity: "info",
        status: "pass",
        evidence: [domEvidence("There is no robots meta tag restricting indexing.")],
        explanation:
          "With no robots meta tag, the page is indexable by default, which is normally what a public page wants.",
        recommendation:
          "No change needed. Avoid adding a noindex directive unless this page should be hidden from search.",
      }),
    ];
  }

  const directives = page.robots
    .toLowerCase()
    .split(",")
    .map((directive) => directive.trim())
    .filter(Boolean);

  const evidence = domEvidence("A robots meta tag is present.", preview(page.robots));

  if (directives.includes("noindex") || directives.includes("none")) {
    return [
      seoFinding({
        id: "seo.robots_meta.noindex",
        severity: "critical",
        status: "fail",
        evidence: [evidence],
        explanation:
          "This page asks search engines not to index it, so it will not appear in search results at all. This is very often left over from a staging environment.",
        recommendation:
          "Remove the noindex directive unless this page is deliberately hidden from search.",
      }),
    ];
  }

  if (directives.includes("nofollow")) {
    return [
      seoFinding({
        id: "seo.robots_meta.nofollow",
        severity: "moderate",
        status: "warn",
        evidence: [evidence],
        explanation:
          "This page tells search engines not to follow any of its links, so pages reachable only from here may never be discovered.",
        recommendation: "Remove the nofollow directive unless it is deliberate.",
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.robots_meta.ok",
      severity: "info",
      status: "pass",
      evidence: [evidence],
      explanation: "The robots meta tag does not block indexing.",
      recommendation:
        "Keep the robots directives free of noindex unless this page should be hidden from search.",
    }),
  ];
}

export function checkLanguage(page: PageData): Finding[] {
  if (page.htmlLanguage === null || page.htmlLanguage.length === 0) {
    return [
      seoFinding({
        id: "seo.language.missing",
        severity: "moderate",
        status: "fail",
        evidence: [domEvidence("The <html> element has no lang attribute.")],
        explanation:
          "The language declaration tells search engines which audience the page serves, and tells screen readers which pronunciation rules to use.",
        recommendation:
          'Add a lang attribute to the <html> element, for example lang="en".',
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.language.ok",
      severity: "info",
      status: "pass",
      evidence: [domEvidence("The page declares a language.", page.htmlLanguage)],
      explanation: "The document language is declared.",
      recommendation: "Keep the lang attribute accurate if the page is translated.",
    }),
  ];
}

export function checkViewport(page: PageData): Finding[] {
  if (page.viewport === null || page.viewport.length === 0) {
    return [
      seoFinding({
        id: "seo.viewport.missing",
        severity: "serious",
        status: "fail",
        evidence: [domEvidence('There is no <meta name="viewport"> tag.')],
        explanation:
          "Without a viewport declaration, mobile browsers render the page at desktop width and scale it down, leaving text too small to read.",
        recommendation:
          'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
      }),
    ];
  }

  const evidence = domEvidence("A viewport meta tag is declared.", page.viewport);
  const normalized = page.viewport.toLowerCase();

  if (!normalized.includes("width=device-width")) {
    return [
      seoFinding({
        id: "seo.viewport.no_device_width",
        severity: "moderate",
        status: "warn",
        evidence: [evidence],
        explanation:
          "The viewport is declared but does not adapt to the device width, so the layout may not respond to the screen it is shown on.",
        recommendation: "Include width=device-width in the viewport content.",
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.viewport.ok",
      severity: "info",
      status: "pass",
      evidence: [evidence],
      explanation: "The page declares a device-width viewport.",
      recommendation: "Keep width=device-width in the viewport declaration.",
    }),
  ];
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
