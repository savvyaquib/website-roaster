/**
 * Phase 10 — Content analyzer.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 10, docs/DECISIONS.md ADR-009,
 * ADR-050.
 *
 * Pure: inventory in, `Finding[]` out. Deterministic, and **no AI** — that is
 * Phase 14's job, and ADR-003 requires it to interpret evidence this phase has
 * already collected rather than go looking for its own.
 *
 * ## Facts and interpretation
 *
 * The extractor labels every item `structural` or `inferred`. This module
 * turns the first into `measured` evidence and the second into `heuristic`,
 * so a reader can always tell "the page has no `<h1>`" from "this section looks
 * like pricing".
 *
 * Findings that rest on a threshold are heuristic even when the number behind
 * them is exact: 250 words is a measurement, "thin" is an opinion.
 */

import { findingFactory, preview } from "@/lib/analysis/finding-builder";
import type { Evidence, Finding } from "@/lib/types/finding";

import {
  CTA_REPETITION_LIMIT,
  GENERIC_METADATA_PATTERNS,
  LIGHT_CONTENT_WORDS,
  MANY_DISTINCT_CTAS,
  MAX_REPORTED_ITEMS,
  THIN_CONTENT_WORDS,
} from "./patterns";
import type { ContentAnalysisInput, ContentInventory } from "./types";

const contentFinding = findingFactory("content");

function measured(summary: string, detail?: string): Evidence {
  return {
    kind: "measured",
    source: "dom",
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

function heuristic(summary: string, detail?: string): Evidence {
  return {
    kind: "heuristic",
    source: "derived",
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

// ---------------------------------------------------------------------------
// Headline and supporting copy
// ---------------------------------------------------------------------------

function checkHeadline(inventory: ContentInventory): Finding {
  const { hero } = inventory;

  if (hero.headline === null) {
    return contentFinding({
      id: "content.headline.missing",
      severity: "serious",
      status: "fail",
      evidence: [measured("The page has no <h1> and no title to fall back on.")],
      explanation:
        "A visitor arriving on this page is told nothing about what it offers. The headline is the one piece of copy almost everyone reads.",
      recommendation: "Add an <h1> stating plainly what this page is for.",
    });
  }

  if (hero.headlineSource === "title") {
    return contentFinding({
      id: "content.headline.no_h1",
      severity: "moderate",
      status: "fail",
      evidence: [
        measured("The page has no <h1> element."),
        measured("The document title was used instead.", preview(hero.headline)),
      ],
      explanation:
        "The page has a title in the browser tab but no headline on the page itself, so there is nothing prominent telling a visitor what they are looking at.",
      recommendation: "Add an <h1> carrying the page's main message.",
    });
  }

  return contentFinding({
    id: "content.headline.present",
    severity: "info",
    status: "pass",
    evidence: [measured("The page has a headline.", preview(hero.headline))],
    explanation: "The page states its main message in an <h1>.",
    recommendation:
      "Keep the headline specific to this page rather than describing the whole site.",
  });
}

function checkSupportingCopy(inventory: ContentInventory): Finding {
  const { hero } = inventory;

  if (hero.supportingCopy === null) {
    return contentFinding({
      id: "content.supporting_copy.missing",
      severity: "minor",
      status: "warn",
      evidence: [
        measured("No paragraph was found following the headline."),
        heuristic(
          "Supporting copy is identified by position, so an unusual layout can hide it from this check.",
        ),
      ],
      explanation:
        "Nothing was found expanding on the headline. A short supporting line is usually what turns a slogan into something a visitor can act on — though a page can be laid out so that this check misses it.",
      recommendation:
        "Follow the headline with a sentence explaining what the page offers and to whom.",
    });
  }

  if (hero.supportingCopySource === "meta_description") {
    return contentFinding({
      id: "content.supporting_copy.meta_only",
      severity: "minor",
      status: "warn",
      evidence: [
        measured("No paragraph follows the headline on the page."),
        measured("The meta description was used instead.", preview(hero.supportingCopy)),
        heuristic("Position-based detection may have missed copy in an unusual layout."),
      ],
      explanation:
        "The page describes itself to search engines but not to a visitor who has already arrived. Those are different audiences reading in different places.",
      recommendation: "Put a supporting line on the page beneath the headline.",
    });
  }

  return contentFinding({
    id: "content.supporting_copy.present",
    severity: "info",
    status: "pass",
    evidence: [
      measured("A paragraph follows the headline.", preview(hero.supportingCopy)),
      heuristic(
        "Identified by position; whether it actually supports the headline is a judgement.",
      ),
    ],
    explanation:
      "The headline is followed by supporting copy. It was identified by position, so whether it genuinely supports the headline is a judgement this analyzer does not make.",
    recommendation: "Keep it concrete — what the visitor gets, rather than what you do.",
  });
}

// ---------------------------------------------------------------------------
// Calls to action
// ---------------------------------------------------------------------------

function checkCtas(inventory: ContentInventory): Finding[] {
  const { ctas } = inventory;

  if (ctas.length === 0) {
    return [
      contentFinding({
        id: "content.cta.none",
        severity: "serious",
        status: "fail",
        evidence: [
          measured("No buttons or action links were found."),
          heuristic(
            "Calls to action are recognised from markup and common wording, so an unusual pattern could be missed.",
          ),
        ],
        explanation:
          "Nothing was found inviting the visitor to do anything, so the page appears to offer no obvious next step. Detection relies on button markup and common wording, so an unconventionally worded action may have been missed.",
        recommendation:
          "Add a clear primary action — the one thing you most want a visitor to do.",
      }),
    ];
  }

  const findings: Finding[] = [];
  const structural = ctas.filter((cta) => cta.detection === "structural").length;
  const heroCtas = ctas.filter((cta) => cta.region === "hero");

  const counts = new Map<string, number>();
  for (const cta of ctas) {
    const key = cta.text.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const distinct = counts.size;
  const repeated = [...counts.entries()].filter(
    ([, count]) => count >= CTA_REPETITION_LIMIT,
  );

  findings.push(
    contentFinding({
      id: "content.cta.present",
      severity: "info",
      status: "pass",
      evidence: [
        measured(
          `${ctas.length} call(s) to action were found, ${distinct} of them distinct.`,
          ctas
            .slice(0, MAX_REPORTED_ITEMS)
            .map((cta) => cta.text)
            .join(" | "),
        ),
        measured(`${structural} were buttons or elements with a button role.`),
        ...(heroCtas.length > 0
          ? [heuristic(`${heroCtas.length} appear near the top of the page.`)]
          : []),
      ],
      explanation: "The page offers the visitor something to do.",
      recommendation:
        "Keep one action clearly primary so the visitor is not left choosing.",
    }),
  );

  if (repeated.length > 0) {
    findings.push(
      contentFinding({
        id: "content.cta.repetitive",
        severity: "minor",
        status: "warn",
        evidence: [
          measured(
            `The same label appears repeatedly.`,
            repeated
              .slice(0, MAX_REPORTED_ITEMS)
              .map(([text, count]) => `"${text}" x${count}`)
              .join(", "),
          ),
          heuristic(
            "Repetition is normal on a long page; it only reads as noise when the labels are identical and close together.",
          ),
        ],
        explanation:
          "One call to action is repeated several times. That is often deliberate on a long page, and sometimes a sign the page is nagging rather than persuading.",
        recommendation:
          "Check the repeats are spaced out and the wording varies with the context.",
      }),
    );
  }

  if (distinct > MANY_DISTINCT_CTAS) {
    findings.push(
      contentFinding({
        id: "content.cta.many_choices",
        severity: "minor",
        status: "warn",
        evidence: [
          measured(`${distinct} distinct call(s) to action were found.`),
          heuristic(
            `More than ${MANY_DISTINCT_CTAS} competing actions often means no single one is primary — though a pricing page legitimately has one per plan.`,
          ),
        ],
        explanation:
          "The page offers many different actions. That may be right for what it does, or it may mean the visitor is being asked to choose their own path.",
        recommendation:
          "Decide which single action matters most and make it visually dominant.",
      }),
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

function checkSections(inventory: ContentInventory): Finding {
  const kinds = new Set(
    inventory.sections.filter((section) => section.kind !== "unknown").map((s) => s.kind),
  );

  if (kinds.size === 0) {
    return contentFinding({
      id: "content.sections.unrecognised",
      severity: "info",
      status: "could_not_determine",
      evidence: [
        measured(`The page has ${inventory.headingCount} heading(s).`),
        heuristic(
          "None matched the wording this analyzer recognises for features, pricing, testimonials, FAQs or contact.",
        ),
      ],
      explanation:
        "No recognisable content sections were identified. The detection is English wording matched against headings, so this says as much about the analyzer as about the page.",
      recommendation:
        "If the page has distinct sections, give each a heading that names it plainly.",
    });
  }

  const found = [...kinds].sort();

  return contentFinding({
    id: "content.sections.identified",
    severity: "info",
    status: "pass",
    evidence: [
      heuristic(
        `Sections that look like: ${found.join(", ")}.`,
        inventory.sections
          .filter((section) => section.kind !== "unknown")
          .slice(0, MAX_REPORTED_ITEMS)
          .map((section) => `${section.kind}: ${section.signals.join("; ")}`)
          .join(" | "),
      ),
    ],
    explanation:
      "The page appears to be organised into recognisable sections. This is inferred from headings and wording, not from anything the markup declares.",
    recommendation: "Keep section headings descriptive so the page can be skimmed.",
  });
}

function checkContentDepth(inventory: ContentInventory): Finding {
  const { wordCount, paragraphCount } = inventory;

  const counts = measured(
    `The page has ${wordCount} word(s) of body text across ${paragraphCount} paragraph(s).`,
    "Navigation, header and footer text is excluded.",
  );

  if (wordCount < THIN_CONTENT_WORDS) {
    return contentFinding({
      id: "content.depth.thin",
      severity: "moderate",
      status: "fail",
      evidence: [
        counts,
        heuristic(
          `Below roughly ${THIN_CONTENT_WORDS} words a page rarely answers a visitor's questions — though a deliberate landing page can be an exception.`,
        ),
      ],
      explanation:
        "There is very little to read here. That leaves both visitors and search engines with almost nothing to go on, unless the page is deliberately minimal.",
      recommendation:
        "Say more about what this page offers, who it is for, and what happens next.",
    });
  }

  if (wordCount < LIGHT_CONTENT_WORDS) {
    return contentFinding({
      id: "content.depth.light",
      severity: "minor",
      status: "warn",
      evidence: [
        counts,
        heuristic(
          `Word count is a crude measure of substance; ${LIGHT_CONTENT_WORDS} words is a rule of thumb, not a target.`,
        ),
      ],
      explanation:
        "The page is short. That is fine for a focused landing page and thin for anything meant to inform.",
      recommendation:
        "Check the page answers the obvious questions a visitor would arrive with.",
    });
  }

  return contentFinding({
    id: "content.depth.substantial",
    severity: "info",
    status: "pass",
    evidence: [counts],
    explanation: "The page has a reasonable amount of body text.",
    recommendation:
      "Length is not quality — check it reads well and says something specific.",
  });
}

// ---------------------------------------------------------------------------
// Metadata, trust and contact
// ---------------------------------------------------------------------------

function checkGenericMetadata(inventory: ContentInventory): Finding {
  const candidates: { field: string; value: string; matched: string }[] = [];

  for (const [field, value] of [
    ["title", inventory.title],
    ["meta description", inventory.metaDescription],
    ["headline", inventory.hero.headline],
  ] as const) {
    if (value === null) continue;

    const matched = GENERIC_METADATA_PATTERNS.find((candidate) =>
      candidate.pattern.test(value.trim()),
    );

    if (matched !== undefined) {
      candidates.push({ field, value, matched: matched.name });
    }
  }

  if (candidates.length === 0) {
    return contentFinding({
      id: "content.metadata.specific",
      severity: "info",
      status: "pass",
      evidence: [
        measured("The title, description and headline are not placeholder text."),
      ],
      explanation: "Nothing on the page reads as an unfilled default.",
      recommendation: "Keep these specific to the page rather than the site as a whole.",
    });
  }

  return contentFinding({
    id: "content.metadata.generic",
    severity: "moderate",
    status: "fail",
    evidence: [
      measured(
        `${candidates.length} field(s) contain placeholder or generic wording.`,
        candidates
          .map((item) => `${item.field}: "${preview(item.value, 60)}" (${item.matched})`)
          .join(" | "),
      ),
      heuristic(
        "Matched against a list of common defaults, so unusual placeholders are missed.",
      ),
    ],
    explanation:
      "Text like this is almost always left over from a template rather than written for the page. It tells a visitor nothing and often means the page was never finished.",
    recommendation: "Replace it with wording that describes this specific page.",
  });
}

function checkTrustSignals(inventory: ContentInventory): Finding {
  const { trustSignals } = inventory;

  if (trustSignals.length === 0) {
    return contentFinding({
      id: "content.trust.none_detected",
      severity: "minor",
      status: "warn",
      evidence: [
        heuristic(
          "No testimonials, ratings, customer counts or credentials were recognised.",
        ),
        heuristic(
          "Detection is pattern-based and English-only, so real trust signals presented differently would be missed.",
        ),
      ],
      explanation:
        "Nothing was found vouching for the page's claims. Whether that matters depends entirely on what the page is for — and the detection is crude enough that their absence here is weak evidence.",
      recommendation:
        "If visitors need reassurance before acting, consider adding evidence others have.",
    });
  }

  return contentFinding({
    id: "content.trust.detected",
    severity: "info",
    status: "pass",
    evidence: [
      heuristic(
        `${trustSignals.length} possible trust signal(s) were recognised.`,
        trustSignals
          .slice(0, MAX_REPORTED_ITEMS)
          .map((signal) => `${signal.kind}: ${signal.signal}`)
          .join(" | "),
      ),
    ],
    explanation:
      "The page appears to include social proof. Whether it is convincing is a judgement this analyzer does not make.",
    recommendation: "Keep claims attributable — a named source beats an anonymous quote.",
  });
}

function checkContact(inventory: ContentInventory): Finding {
  const { contact } = inventory;

  const structuralRoutes =
    contact.mailtoAddresses.length +
    contact.telLinks.length +
    contact.addressBlocks.length;
  const inferredRoutes =
    contact.textEmails.length + contact.textPhones.length + contact.contactLinks.length;

  if (structuralRoutes === 0 && inferredRoutes === 0) {
    return contentFinding({
      id: "content.contact.none_found",
      severity: "moderate",
      status: "fail",
      evidence: [
        measured("No mailto: or tel: links, and no <address> element, were found."),
        measured("No contact link or address was recognised in the page text."),
      ],
      explanation:
        "There is no visible way to get in touch from this page. On a page asking a visitor to act, that is usually a gap rather than a choice.",
      recommendation:
        "Add a contact route — an email link, a phone number, or a link to a contact page.",
    });
  }

  const evidence: Evidence[] = [];

  if (contact.mailtoAddresses.length > 0) {
    evidence.push(
      measured(
        `${contact.mailtoAddresses.length} email link(s).`,
        contact.mailtoAddresses.slice(0, MAX_REPORTED_ITEMS).join(", "),
      ),
    );
  }
  if (contact.telLinks.length > 0) {
    evidence.push(measured(`${contact.telLinks.length} telephone link(s).`));
  }
  if (contact.addressBlocks.length > 0) {
    evidence.push(measured(`${contact.addressBlocks.length} <address> block(s).`));
  }
  if (contact.contactLinks.length > 0) {
    evidence.push(
      heuristic(
        `${contact.contactLinks.length} link(s) look like a contact route.`,
        contact.contactLinks.slice(0, MAX_REPORTED_ITEMS).join(", "),
      ),
    );
  }
  if (contact.textEmails.length > 0 || contact.textPhones.length > 0) {
    evidence.push(
      heuristic(
        `${contact.textEmails.length} email(s) and ${contact.textPhones.length} phone-shaped string(s) found in page text.`,
        "Text matching, so a long reference number can look like a phone number.",
      ),
    );
  }
  if (contact.socialLinks.length > 0) {
    evidence.push(
      heuristic(
        `Links to ${contact.socialLinks.length} social platform(s).`,
        contact.socialLinks.join(", "),
      ),
    );
  }

  return contentFinding({
    id: "content.contact.available",
    severity: "info",
    status: "pass",
    evidence,
    explanation: "The page offers at least one way to make contact.",
    recommendation:
      "Make sure the route works and is answered; a stale address is worse than none.",
  });
}

function checkFooter(inventory: ContentInventory): Finding {
  const { footer } = inventory;

  if (!footer.present) {
    return contentFinding({
      id: "content.footer.missing",
      severity: "minor",
      status: "warn",
      evidence: [measured("No <footer> element or footer-classed container was found.")],
      explanation:
        "The page has no footer. That is where visitors expect secondary links, legal notices and contact details, and its absence often means those are missing entirely.",
      recommendation: "Add a footer with the supporting links a visitor may need.",
    });
  }

  return contentFinding({
    id: "content.footer.present",
    severity: "info",
    status: "pass",
    evidence: [
      footer.detection === "structural"
        ? measured(
            `A <footer> element with ${footer.linkCount} link(s) and ${footer.wordCount} word(s).`,
          )
        : heuristic(
            `A container classed as a footer, with ${footer.linkCount} link(s).`,
            "Identified by class name rather than by a <footer> element.",
          ),
      footer.hasCopyrightNotice
        ? measured("It contains a copyright notice.")
        : heuristic("No copyright notice was recognised in it."),
    ],
    explanation: "The page has a footer.",
    recommendation:
      footer.detection === "structural"
        ? "Keep the footer's links current."
        : "Use a <footer> element so the region is identifiable to tools and assistive technology.",
  });
}

/**
 * Analyze the extracted content.
 *
 * Findings are returned in a fixed order — headline first, since it is what a
 * visitor reads first — so two runs of the same page are directly comparable.
 *
 * Produces no score. Phase 12 does that.
 */
export function analyzeContent(input: ContentAnalysisInput): Finding[] {
  const { inventory } = input;

  return [
    checkHeadline(inventory),
    checkSupportingCopy(inventory),
    checkGenericMetadata(inventory),
    ...checkCtas(inventory),
    checkContentDepth(inventory),
    checkSections(inventory),
    checkTrustSignals(inventory),
    checkContact(inventory),
    checkFooter(inventory),
  ];
}
