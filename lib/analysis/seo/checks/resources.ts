/**
 * Image alt text, internal linking and structured-data checks.
 *
 * Pure functions over `PageData`.
 */

import type { PageData } from "@/lib/analysis/dom";
import type { Finding } from "@/lib/types/finding";

import { domEvidence, preview, seoFinding } from "../finding-builder";

/**
 * Images missing an `alt` attribute.
 *
 * `alt=""` is explicitly **not** a defect: it is the correct way to mark a
 * decorative image, and Phase 4 preserves the difference between an empty alt
 * and an absent one precisely so this check does not conflate them.
 */
export function checkImageAlt(page: PageData): Finding[] {
  const images = page.images;

  if (images.length === 0) {
    return [
      seoFinding({
        id: "seo.images.none",
        severity: "info",
        status: "pass",
        evidence: [domEvidence("The page contains no <img> elements.")],
        explanation: "There are no images requiring alternative text.",
        recommendation:
          'Give any image added later an alt attribute, or alt="" if it is decorative.',
      }),
    ];
  }

  const missing = images.filter((image) => image.alt === null);
  const decorative = images.filter((image) => image.alt === "").length;

  if (missing.length === 0) {
    return [
      seoFinding({
        id: "seo.images.alt_ok",
        severity: "info",
        status: "pass",
        evidence: [
          domEvidence(
            `All ${images.length} image(s) declare an alt attribute; ${decorative} are marked decorative with alt="".`,
          ),
        ],
        explanation: "Every image declares alternative text or is marked decorative.",
        recommendation:
          'Keep describing new images in alt, and keep marking decorative ones with alt="".',
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.images.missing_alt",
      // Losing alt on every image is a different problem from losing it on one.
      severity: missing.length === images.length ? "serious" : "moderate",
      status: "fail",
      evidence: [
        domEvidence(
          `${missing.length} of ${images.length} image(s) have no alt attribute.`,
          missing
            .slice(0, 5)
            .map((image) => preview(image.src ?? "(no src)", 60))
            .join(", "),
        ),
      ],
      explanation:
        "Images without alternative text are invisible to screen readers and give search engines nothing to work with. An image that is purely decorative should carry an empty alt instead of none.",
      recommendation:
        'Describe each meaningful image in its alt attribute, and mark decorative images with alt="".',
    }),
  ];
}

export function checkInternalLinks(page: PageData): Finding[] {
  const internal = page.links.filter((link) => link.kind === "internal");
  const external = page.links.filter((link) => link.kind === "external");

  if (page.links.length === 0) {
    return [
      seoFinding({
        id: "seo.links.none",
        severity: "moderate",
        status: "fail",
        evidence: [domEvidence("The page contains no links.")],
        explanation:
          "A page with no links is a dead end: search engines cannot discover anything from it, and readers cannot go anywhere next.",
        recommendation: "Link to related pages on the site.",
      }),
    ];
  }

  const counts = domEvidence(
    `The page has ${internal.length} internal and ${external.length} external link(s).`,
  );

  if (internal.length === 0) {
    return [
      seoFinding({
        id: "seo.links.no_internal",
        severity: "moderate",
        status: "warn",
        evidence: [counts],
        explanation:
          "Without internal links, search engines cannot follow this page to the rest of the site, and the page contributes nothing to how the site is crawled.",
        recommendation: "Add links to related pages on this site.",
      }),
    ];
  }

  const emptyText = page.links.filter(
    (link) => link.text.length === 0 && link.kind !== "anchor",
  );

  if (emptyText.length > 0) {
    return [
      seoFinding({
        id: "seo.links.empty_text",
        severity: "minor",
        status: "warn",
        evidence: [
          counts,
          domEvidence(
            `${emptyText.length} link(s) have no text.`,
            emptyText
              .slice(0, 5)
              .map((link) => preview(link.href, 60))
              .join(", "),
          ),
        ],
        explanation:
          "Link text describes the destination. Links with none — usually icons or images without alternative text — say nothing about where they lead.",
        recommendation:
          "Give each link visible text, or alternative text on the image inside it.",
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.links.ok",
      severity: "info",
      status: "pass",
      evidence: [counts],
      explanation: "The page links to other pages on the site.",
      recommendation: "Keep linking to related pages as the site grows.",
    }),
  ];
}

/**
 * Structured data.
 *
 * Phase 4 collects the raw JSON-LD blocks without parsing them; deciding
 * whether they are valid is this phase's job.
 */
export function checkStructuredData(page: PageData): Finding[] {
  const blocks = page.jsonLdBlocks;

  if (blocks.length === 0) {
    return [
      seoFinding({
        id: "seo.structured_data.absent",
        severity: "minor",
        status: "warn",
        evidence: [domEvidence("The page contains no JSON-LD structured data.")],
        explanation:
          "Structured data lets search engines show richer results — ratings, prices, breadcrumbs — instead of a plain link. It is optional, and its absence is not an error.",
        recommendation:
          "Consider adding JSON-LD describing what this page represents, if a schema.org type fits it.",
      }),
    ];
  }

  const invalid: string[] = [];

  for (const block of blocks) {
    try {
      JSON.parse(block) as unknown;
    } catch {
      invalid.push(preview(block, 60));
    }
  }

  if (invalid.length > 0) {
    return [
      seoFinding({
        id: "seo.structured_data.invalid",
        severity: "moderate",
        status: "fail",
        evidence: [
          domEvidence(
            `${invalid.length} of ${blocks.length} JSON-LD block(s) are not valid JSON.`,
            invalid.join(" | "),
          ),
        ],
        explanation:
          "Structured data that does not parse is ignored entirely, so the effort spent adding it produces nothing.",
        recommendation: "Fix the JSON syntax so the block can be parsed.",
      }),
    ];
  }

  return [
    seoFinding({
      id: "seo.structured_data.ok",
      severity: "info",
      status: "pass",
      evidence: [
        domEvidence(`The page contains ${blocks.length} valid JSON-LD block(s).`),
      ],
      explanation: "The page declares structured data and it parses correctly.",
      recommendation: "Keep the JSON-LD in step with what the page actually shows.",
    }),
  ];
}
