/**
 * Title, meta description and heading-structure checks.
 *
 * Every function here is pure: `PageData` in, `Finding[]` out. No network, no
 * clock, no browser.
 */

import type { PageData } from "@/lib/analysis/dom";
import type { Finding } from "@/lib/types/finding";

import { domEvidence, preview, seoFinding } from "../finding-builder";
import { META_DESCRIPTION_LENGTH, TITLE_LENGTH } from "../thresholds";

export function checkTitle(page: PageData): Finding[] {
  const { title } = page;

  if (title === null) {
    return [
      seoFinding({
        id: "seo.title.missing",
        severity: "serious",
        status: "fail",
        evidence: [domEvidence("The document has no <title> element.")],
        explanation:
          "Search engines use the title as the headline of a result, and browsers use it to label the tab. Without one, both fall back to guessing from the URL or page content.",
        recommendation: `Add a <title> describing this specific page, ideally ${TITLE_LENGTH.min}-${TITLE_LENGTH.max} characters.`,
      }),
    ];
  }

  if (title.length === 0) {
    return [
      seoFinding({
        id: "seo.title.empty",
        severity: "serious",
        status: "fail",
        evidence: [domEvidence("A <title> element is present but contains no text.")],
        explanation:
          "An empty title is treated the same as a missing one by search engines, but is harder to notice because the element exists.",
        recommendation: `Give the <title> text describing this page, ideally ${TITLE_LENGTH.min}-${TITLE_LENGTH.max} characters.`,
      }),
    ];
  }

  const measured = domEvidence(
    `The title is ${title.length} characters long.`,
    preview(title),
  );

  if (title.length > TITLE_LENGTH.max) {
    return [
      seoFinding({
        id: "seo.title.too_long",
        severity: "minor",
        status: "warn",
        evidence: [measured],
        explanation: `Titles beyond roughly ${TITLE_LENGTH.max} characters are usually truncated in search results, so the end of this one may never be read.`,
        recommendation: `Shorten the title to about ${TITLE_LENGTH.max} characters, putting the distinctive words first.`,
      }),
    ];
  }

  if (title.length < TITLE_LENGTH.min) {
    return [
      seoFinding({
        id: "seo.title.too_short",
        severity: "minor",
        status: "warn",
        evidence: [measured],
        explanation: `A title under about ${TITLE_LENGTH.min} characters usually leaves useful describing words unused.`,
        recommendation: "Expand the title to describe what the page is actually about.",
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.title.ok",
      severity: "info",
      status: "pass",
      evidence: [measured],
      explanation: "The page has a title of a reasonable length.",
    }),
  ];
}

export function checkMetaDescription(page: PageData): Finding[] {
  const description = page.description;

  if (description === null) {
    return [
      seoFinding({
        id: "seo.description.missing",
        severity: "moderate",
        status: "fail",
        evidence: [domEvidence('There is no <meta name="description"> tag.')],
        explanation:
          "Without a description, search engines compose their own snippet from page text, which is often a poor summary of what the page offers.",
        recommendation: `Add a meta description of roughly ${META_DESCRIPTION_LENGTH.min}-${META_DESCRIPTION_LENGTH.max} characters summarising the page.`,
      }),
    ];
  }

  if (description.length === 0) {
    return [
      seoFinding({
        id: "seo.description.empty",
        severity: "moderate",
        status: "fail",
        evidence: [
          domEvidence("A meta description tag is present but declares no content."),
        ],
        explanation:
          "An empty description has the same effect as no description, while looking like the page has one.",
        recommendation: "Give the meta description content, or remove the empty tag.",
      }),
    ];
  }

  const measured = domEvidence(
    `The meta description is ${description.length} characters long.`,
    preview(description),
  );

  if (description.length > META_DESCRIPTION_LENGTH.max) {
    return [
      seoFinding({
        id: "seo.description.too_long",
        severity: "minor",
        status: "warn",
        evidence: [measured],
        explanation: `Descriptions beyond roughly ${META_DESCRIPTION_LENGTH.max} characters are usually truncated in search results.`,
        recommendation: `Shorten the description to about ${META_DESCRIPTION_LENGTH.max} characters.`,
      }),
    ];
  }

  if (description.length < META_DESCRIPTION_LENGTH.min) {
    return [
      seoFinding({
        id: "seo.description.too_short",
        severity: "minor",
        status: "warn",
        evidence: [measured],
        explanation:
          "A very short description gives a searcher little reason to choose this result.",
        recommendation: `Expand the description towards ${META_DESCRIPTION_LENGTH.min}-${META_DESCRIPTION_LENGTH.max} characters.`,
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.description.ok",
      severity: "info",
      status: "pass",
      evidence: [measured],
      explanation: "The page has a meta description of a reasonable length.",
    }),
  ];
}

export function checkH1(page: PageData): Finding[] {
  const h1s = page.headings.filter((heading) => heading.level === 1);

  if (h1s.length === 0) {
    return [
      seoFinding({
        id: "seo.h1.missing",
        severity: "serious",
        status: "fail",
        evidence: [
          domEvidence(
            `The page has no <h1>. It has ${page.headings.length} heading(s) in total.`,
          ),
        ],
        explanation:
          "The h1 is the page's main heading and the clearest signal of what the page is about, for both readers and search engines.",
        recommendation: "Add a single <h1> stating what this page is about.",
      }),
    ];
  }

  if (h1s.length > 1) {
    return [
      seoFinding({
        id: "seo.h1.multiple",
        severity: "minor",
        status: "warn",
        evidence: [
          domEvidence(
            `The page has ${h1s.length} <h1> elements.`,
            h1s.map((heading) => preview(heading.text, 40)).join(" | "),
          ),
        ],
        explanation:
          "Several top-level headings make it ambiguous which one describes the page as a whole.",
        recommendation:
          "Keep one <h1> for the page and demote the others to <h2> or lower.",
      }),
    ];
  }

  const only = h1s[0];

  if (only !== undefined && only.text.length === 0) {
    return [
      seoFinding({
        id: "seo.h1.empty",
        severity: "moderate",
        status: "fail",
        evidence: [domEvidence("The <h1> element contains no text.")],
        explanation:
          "An empty h1 provides no signal, and is often the result of a heading used purely for layout or an image with no alternative text.",
        recommendation: "Put the page's main heading text inside the <h1>.",
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.h1.ok",
      severity: "info",
      status: "pass",
      evidence: [
        domEvidence("The page has exactly one <h1>.", preview(only?.text ?? "")),
      ],
      explanation: "The page has a single, non-empty top-level heading.",
    }),
  ];
}

/**
 * Heading levels should descend without skipping.
 *
 * Only the first skip is reported. A page with a broken outline usually has
 * many, and listing every one would bury the point.
 */
export function checkHeadingStructure(page: PageData): Finding[] {
  const headings = page.headings;

  if (headings.length === 0) {
    return [
      seoFinding({
        id: "seo.headings.none",
        severity: "moderate",
        status: "fail",
        evidence: [domEvidence("The page contains no headings at all.")],
        explanation:
          "Headings give a page its outline. Without any, neither a reader skimming nor a search engine can see how the content is organised.",
        recommendation: "Structure the content with an <h1> and descriptive subheadings.",
      }),
    ];
  }

  let previousLevel = headings[0]?.level ?? 1;

  for (const heading of headings.slice(1)) {
    if (heading.level - previousLevel > 1) {
      return [
        seoFinding({
          id: "seo.headings.skipped_level",
          severity: "minor",
          status: "warn",
          evidence: [
            domEvidence(
              `An <h${previousLevel}> is followed by an <h${heading.level}>, skipping a level.`,
              preview(heading.text, 60),
            ),
          ],
          explanation:
            "Skipping a heading level breaks the document outline, which assistive technology and search engines both rely on to understand structure.",
          recommendation: `Use <h${previousLevel + 1}> here, or restructure the surrounding sections.`,
        }),
      ];
    }

    previousLevel = heading.level;
  }

  return [
    seoFinding({
      id: "seo.headings.ok",
      severity: "info",
      status: "pass",
      evidence: [
        domEvidence(`The page has ${headings.length} heading(s) in a consistent order.`),
      ],
      explanation: "Heading levels descend without skipping.",
    }),
  ];
}
