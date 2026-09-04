/**
 * Content extraction.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 10, docs/DECISIONS.md ADR-050.
 *
 * Pure: HTML and a URL in, `ContentInventory` out. No browser, no network, no
 * clock, no AI.
 *
 * Reuses Phase 4's parse5 adapter rather than introducing a second way of
 * reading HTML. Phase 4 deliberately does not extract body text — that gap was
 * recorded as this phase's work at the time — so the traversal happens here.
 *
 * Every item records whether it was found **structurally** or **inferred**, and
 * that label is what the analyzer turns into measured or heuristic evidence.
 */

import {
  collapseWhitespace,
  findByTag,
  findFirstByTag,
  getAttribute,
  isHtmlTag,
  parseHtml,
  readableText,
  textContent,
  tokenize,
  type Element,
} from "@/lib/analysis/dom/dom-tree";
import { resolveUrl } from "@/lib/analysis/dom";

import {
  BILLING_PERIOD_PATTERN,
  CONTACT_LINK_PATTERN,
  COPYRIGHT_PATTERN,
  CTA_CLASS_PATTERN,
  CTA_TEXT_PATTERNS,
  EMAIL_PATTERN,
  MIN_SUPPORTING_COPY_WORDS,
  PHONE_PATTERN,
  PRICE_PATTERN,
  SECTION_HEADING_PATTERNS,
  SOCIAL_HOSTS,
  TRUST_PATTERNS,
} from "./patterns";
import type {
  CallToAction,
  ContactInformation,
  ContentInventory,
  ContentSection,
  FooterContent,
  HeroContent,
  SectionKind,
  TrustSignal,
} from "./types";

/** Elements whose text is chrome rather than content. */
const NON_CONTENT_TAGS = new Set([
  "nav",
  "header",
  "footer",
  "script",
  "style",
  "template",
  "noscript",
]);

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function truncate(text: string, max = 200): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Extract the page's content.
 *
 * @param html the document source — rendered HTML from Phase 3 is preferable on
 *   a JavaScript-heavy site, since copy injected at runtime is invisible to the
 *   raw response.
 * @param url used to resolve link destinations.
 */
export function extractContent(html: string, url: string): ContentInventory {
  const document = parseHtml(html);

  const title = extractTitle(document);
  const metaDescription = extractMetaDescription(document);

  const bodyText = extractBodyText(document);
  const paragraphs = findByTag(document, "p")
    .map((element) => readableText(element))
    .filter((text) => text.length > 0);

  const headings = findByTag(document, ...HEADING_TAGS);
  const footer = extractFooter(document);

  return {
    url,
    title,
    metaDescription,
    hero: extractHero(document, title, metaDescription),
    ctas: extractCtas(document, url),
    sections: extractSections(document, headings),
    contact: extractContact(document, bodyText),
    footer,
    trustSignals: extractTrustSignals(document, bodyText),
    wordCount: words(bodyText),
    paragraphCount: paragraphs.length,
    headingCount: headings.length,
    longestParagraphWords: paragraphs.reduce(
      (longest, text) => Math.max(longest, words(text)),
      0,
    ),
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function extractTitle(document: ReturnType<typeof parseHtml>): string | null {
  const element = findFirstByTag(document, "title");
  if (element === null) return null;

  const text = collapseWhitespace(textContent(element));
  return text.length === 0 ? null : text;
}

function extractMetaDescription(document: ReturnType<typeof parseHtml>): string | null {
  const meta = findByTag(document, "meta").find(
    (element) => getAttribute(element, "name")?.trim().toLowerCase() === "description",
  );

  if (meta === undefined) return null;

  const content = collapseWhitespace(getAttribute(meta, "content") ?? "");
  return content.length === 0 ? null : content;
}

/**
 * Visible body text, with navigation, header and footer removed.
 *
 * Those regions repeat on every page and would inflate the word count of a page
 * that says almost nothing.
 */
function extractBodyText(document: ReturnType<typeof parseHtml>): string {
  const body = findFirstByTag(document, "body");
  if (body === null) return collapseWhitespace(textContent(document));

  const collect = (node: Element): string => {
    let text = "";

    for (const child of node.childNodes) {
      if (child.nodeName === "#text" && "value" in child) {
        text += child.value;
        continue;
      }
      if (!("tagName" in child)) continue;
      if (NON_CONTENT_TAGS.has(child.tagName)) continue;

      text += ` ${collect(child)}`;
    }

    return text;
  };

  return collapseWhitespace(collect(body));
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

/**
 * The headline and the line beneath it.
 *
 * The `<h1>` is structural. The supporting copy is not: taking the first
 * substantial paragraph after the headline is a convention that holds on most
 * marketing pages and fails on plenty of others.
 */
function extractHero(
  document: ReturnType<typeof parseHtml>,
  title: string | null,
  metaDescription: string | null,
): HeroContent {
  const h1 = findFirstByTag(document, "h1");
  const h1Text = h1 === null ? "" : readableText(h1);

  const headline = h1Text.length > 0 ? h1Text : title;
  const headlineSource = h1Text.length > 0 ? "h1" : title === null ? null : "title";

  // A paragraph following the headline in document order. Everything before the
  // headline is skipped, which is what makes this positional rather than exact.
  let supportingCopy: string | null = null;
  let supportingSource: HeroContent["supportingCopySource"] = null;

  if (h1 !== null) {
    let seenHeadline = false;

    for (const element of findByTag(document, "h1", "p")) {
      if (element === h1) {
        seenHeadline = true;
        continue;
      }
      if (!seenHeadline) continue;
      if (!isHtmlTag(element, "p")) continue;

      const text = readableText(element);
      if (words(text) >= MIN_SUPPORTING_COPY_WORDS) {
        supportingCopy = truncate(text);
        supportingSource = "paragraph";
        break;
      }
    }
  }

  if (supportingCopy === null && metaDescription !== null) {
    supportingCopy = truncate(metaDescription);
    supportingSource = "meta_description";
  }

  return {
    headline: headline === null ? null : truncate(headline),
    headlineSource,
    headlineDetection:
      headlineSource === null
        ? null
        : headlineSource === "h1"
          ? "structural"
          : "inferred",
    supportingCopy,
    supportingCopySource: supportingSource,
    // Both routes to supporting copy are conventions rather than markup that
    // declares itself, so neither is structural.
    supportingCopyDetection: supportingSource === null ? null : "inferred",
    wordCount: words(`${headline ?? ""} ${supportingCopy ?? ""}`),
  };
}

// ---------------------------------------------------------------------------
// Calls to action
// ---------------------------------------------------------------------------

function regionOf(
  element: Element,
  document: ReturnType<typeof parseHtml>,
): CallToAction["region"] {
  // Walk up looking for a landmark. parse5 nodes carry a parent reference.
  let current: unknown = element;

  while (current !== null && typeof current === "object" && "parentNode" in current) {
    const node = current as Element & { parentNode?: unknown };
    if ("tagName" in node) {
      if (node.tagName === "footer") return "footer";
      if (node.tagName === "nav") return "navigation";
      if (node.tagName === "header") return "hero";
    }
    current = node.parentNode;
  }

  // Before the first h2 usually means the opening screen.
  const h1 = findFirstByTag(document, "h1");
  if (h1 !== null) {
    const ordered = findByTag(document, "h1", "h2", "a", "button");
    const headlineIndex = ordered.indexOf(h1);
    const ownIndex = ordered.indexOf(element);
    const firstH2 = ordered.findIndex((candidate) => isHtmlTag(candidate, "h2"));

    if (
      ownIndex > headlineIndex &&
      (firstH2 === -1 || ownIndex < firstH2) &&
      headlineIndex !== -1
    ) {
      return "hero";
    }
  }

  return "body";
}

function extractCtas(
  document: ReturnType<typeof parseHtml>,
  baseUrl: string,
): CallToAction[] {
  const ctas: CallToAction[] = [];

  for (const element of findByTag(document, "a", "button")) {
    const text = readableText(element);
    if (text.length === 0) continue;

    const isButton = isHtmlTag(element, "button");
    const classes = getAttribute(element, "class") ?? "";
    const role = getAttribute(element, "role")?.toLowerCase();

    // A <button> is a control by definition. Everything else is a guess.
    const structural = isButton || role === "button";
    const looksLikeButton = CTA_CLASS_PATTERN.test(classes);
    const matched = CTA_TEXT_PATTERNS.find((candidate) => candidate.pattern.test(text));

    if (!structural && !looksLikeButton && matched === undefined) continue;

    const href = isButton ? null : getAttribute(element, "href");

    ctas.push({
      text: truncate(text, 80),
      href: href === null ? null : resolveUrl(href, baseUrl),
      element: isButton ? "button" : "link",
      detection: structural ? "structural" : "inferred",
      region: regionOf(element, document),
      matchedPattern: matched?.name ?? (looksLikeButton ? "button styling" : null),
    });
  }

  return ctas;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * Classify the page's sections.
 *
 * Driven by headings, because a heading is the one place a page reliably says
 * what a block of content is. The classification itself is inferred: matching
 * "Pricing" in a heading is a guess about meaning, not an observation.
 */
function extractSections(
  document: ReturnType<typeof parseHtml>,
  headings: readonly Element[],
): ContentSection[] {
  const sections: ContentSection[] = [];

  for (const heading of headings) {
    const text = readableText(heading);
    if (text.length === 0) continue;

    const level = Number(heading.tagName.slice(1));
    const signals: string[] = [];
    let kind: SectionKind = "unknown";

    const matched = SECTION_HEADING_PATTERNS.find((candidate) =>
      candidate.pattern.test(text),
    );

    if (matched !== undefined) {
      kind = matched.kind;
      signals.push(`heading matched "${matched.kind}"`);
    }

    sections.push({
      kind,
      detection: "inferred",
      heading: truncate(text, 120),
      headingLevel: Number.isFinite(level) ? level : null,
      wordCount: words(text),
      signals,
    });
  }

  // Content signals that do not depend on a heading, checked once over the
  // whole document so a pricing table with no heading is still noticed.
  const bodyText = extractBodyText(document);

  if (
    PRICE_PATTERN.test(bodyText) &&
    !sections.some((section) => section.kind === "pricing")
  ) {
    const signals = ["currency amount in page text"];
    if (BILLING_PERIOD_PATTERN.test(bodyText)) signals.push("recurring billing wording");

    sections.push({
      kind: "pricing",
      detection: "inferred",
      heading: null,
      headingLevel: null,
      wordCount: 0,
      signals,
    });
  }

  const questionCount = findByTag(document, "details").length;
  if (questionCount > 0 && !sections.some((section) => section.kind === "faq")) {
    sections.push({
      kind: "faq",
      detection: "structural",
      heading: null,
      headingLevel: null,
      wordCount: 0,
      signals: [`${questionCount} <details> element(s)`],
    });
  }

  const quotes = findByTag(document, "blockquote").length;
  if (quotes > 0 && !sections.some((section) => section.kind === "testimonials")) {
    sections.push({
      kind: "testimonials",
      detection: "inferred",
      heading: null,
      headingLevel: null,
      wordCount: 0,
      signals: [`${quotes} <blockquote> element(s)`],
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

function extractContact(
  document: ReturnType<typeof parseHtml>,
  bodyText: string,
): ContactInformation {
  const mailto: string[] = [];
  const tel: string[] = [];
  const contactLinks: string[] = [];
  const social: string[] = [];

  for (const link of findByTag(document, "a")) {
    const href = getAttribute(link, "href");
    if (href === null) continue;

    const lowered = href.trim().toLowerCase();

    if (lowered.startsWith("mailto:")) {
      mailto.push(href.trim().slice(7).split("?")[0] ?? "");
      continue;
    }
    if (lowered.startsWith("tel:")) {
      tel.push(href.trim().slice(4));
      continue;
    }

    const text = readableText(link);
    if (CONTACT_LINK_PATTERN.test(text) || CONTACT_LINK_PATTERN.test(lowered)) {
      contactLinks.push(truncate(text.length > 0 ? text : href, 80));
    }

    try {
      const host = new URL(href, "https://placeholder.invalid").host.replace(
        /^www\./,
        "",
      );
      if (SOCIAL_HOSTS.includes(host)) social.push(host);
    } catch {
      // A malformed href is not a social link; nothing to record.
    }
  }

  // Text matching is the fallback, and the part most likely to be wrong.
  const textEmails = unique(bodyText.match(EMAIL_PATTERN) ?? []).filter(
    (email) => !mailto.includes(email),
  );

  const textPhones = unique(
    (bodyText.match(PHONE_PATTERN) ?? [])
      .map((value) => value.trim())
      // Long enough to plausibly be a phone number rather than a year or price.
      .filter((value) => value.replace(/\D/g, "").length >= 9),
  );

  return {
    mailtoAddresses: unique(mailto.filter((value) => value.length > 0)),
    textEmails,
    telLinks: unique(tel),
    textPhones,
    addressBlocks: findByTag(document, "address")
      .map((element) => truncate(readableText(element), 160))
      .filter((text) => text.length > 0),
    contactLinks: unique(contactLinks),
    socialLinks: unique(social),
  };
}

// ---------------------------------------------------------------------------
// Footer and trust
// ---------------------------------------------------------------------------

function extractFooter(document: ReturnType<typeof parseHtml>): FooterContent {
  const structural = findFirstByTag(document, "footer");

  const inferred =
    structural === null
      ? findByTag(document, "div", "section").find((element) =>
          tokenize(getAttribute(element, "class")).some((token) =>
            token.includes("footer"),
          ),
        )
      : undefined;

  const element = structural ?? inferred ?? null;

  if (element === null) {
    return {
      present: false,
      detection: null,
      linkCount: 0,
      wordCount: 0,
      hasCopyrightNotice: false,
    };
  }

  const text = readableText(element);

  return {
    present: true,
    detection: structural !== null ? "structural" : "inferred",
    linkCount: findByTag(element, "a").length,
    wordCount: words(text),
    hasCopyrightNotice: COPYRIGHT_PATTERN.test(text),
  };
}

function extractTrustSignals(
  document: ReturnType<typeof parseHtml>,
  bodyText: string,
): TrustSignal[] {
  const signals: TrustSignal[] = [];

  for (const quote of findByTag(document, "blockquote")) {
    const text = readableText(quote);
    if (text.length === 0) continue;

    signals.push({
      kind: "testimonial",
      detection: "inferred",
      excerpt: truncate(text, 120),
      signal: "<blockquote> element",
    });
  }

  for (const candidate of TRUST_PATTERNS) {
    const match = candidate.pattern.exec(bodyText);
    if (match === null) continue;

    signals.push({
      kind: candidate.name === "rating" ? "rating" : "credential",
      detection: "inferred",
      excerpt: truncate(match[0], 80),
      signal: `text matched "${candidate.name}"`,
    });
  }

  return signals;
}
