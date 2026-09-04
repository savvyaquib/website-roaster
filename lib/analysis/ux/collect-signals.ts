/**
 * Counting the UX signals.
 *
 * Source of truth: docs/DECISIONS.md ADR-051.
 *
 * Pure: HTML in, counts out. No browser, no network, no clock, no AI.
 *
 * Everything in here is arithmetic over the document. Nothing decides whether
 * any number is good — that is the analyzer's job, and it is explicitly
 * heuristic where this file is not.
 *
 * Reuses Phase 4's parse5 adapter rather than adding a third way of reading
 * HTML.
 */

import {
  findByTag,
  findFirstByTag,
  getAttribute,
  hasAttribute,
  isHtmlTag,
  parseHtml,
  readableText,
  tokenize,
  type Element,
} from "@/lib/analysis/dom/dom-tree";

import { MAX_REPORTED_ITEMS } from "./thresholds";
import type {
  ActionSignals,
  DensitySignals,
  FormSignals,
  HeadingSignals,
  HierarchySignals,
  NavigationSignals,
  RepeatedBlock,
  RepetitionSignals,
  UxSignals,
} from "./types";

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

const INTERACTIVE_SELECTOR_TAGS = ["a", "button", "input", "select", "textarea"] as const;

const LANDMARK_TAGS = [
  "main",
  "nav",
  "header",
  "footer",
  "aside",
  "article",
  "section",
] as const;

/** Class fragments that mark a link as visually a button. */
const BUTTON_CLASS_PATTERN = /\b(btn|button|cta)\b/i;

/** Class fragments that mark a control as the dominant one. */
const PRIMARY_CLASS_PATTERN = /\b(primary|main|hero)\b/i;

/** Elements whose text is not page copy. */
const NON_TEXT_TAGS = new Set(["script", "style", "template", "noscript"]);

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function ratioPer100(count: number, words: number): number | null {
  if (words === 0) return null;
  return Math.round((count / words) * 100 * 10) / 10;
}

/**
 * Collect every signal from a document.
 *
 * @param html the document source. Rendered HTML from Phase 3 is preferable on
 *   a JavaScript-heavy site, since controls added at runtime are invisible in
 *   the raw response.
 */
export function collectUxSignals(html: string, url: string): UxSignals {
  const document = parseHtml(html);
  const body = findFirstByTag(document, "body");
  const root = body ?? document;

  return {
    url,
    navigation: collectNavigation(document),
    actions: collectActions(document),
    density: collectDensity(document, root),
    headings: collectHeadings(document),
    hierarchy: collectHierarchy(document, root),
    forms: collectForms(document),
    repetition: collectRepetition(document),
  };
}

// ---------------------------------------------------------------------------

function navigationRegions(document: ReturnType<typeof parseHtml>): Element[] {
  const semantic = findByTag(document, "nav");
  const byRole = findByTag(document, "div", "ul", "section").filter(
    (element) => getAttribute(element, "role")?.trim().toLowerCase() === "navigation",
  );

  return [...semantic, ...byRole];
}

/** Deepest nesting of lists inside a region, which is menu depth. */
function listDepth(element: Element, depth = 0): number {
  let deepest = depth;

  for (const child of element.childNodes) {
    if (!("tagName" in child)) continue;

    const isList = isHtmlTag(child, "ul") || isHtmlTag(child, "ol");
    deepest = Math.max(deepest, listDepth(child, isList ? depth + 1 : depth));
  }

  return deepest;
}

function collectNavigation(document: ReturnType<typeof parseHtml>): NavigationSignals {
  const regions = navigationRegions(document);

  let totalLinks = 0;
  let maxLinks = 0;
  let maxDepth = 0;
  const destinations: string[] = [];

  for (const region of regions) {
    const links = findByTag(region, "a").filter((link) => hasAttribute(link, "href"));

    totalLinks += links.length;
    maxLinks = Math.max(maxLinks, links.length);
    maxDepth = Math.max(maxDepth, listDepth(region));

    for (const link of links) {
      destinations.push((getAttribute(link, "href") ?? "").trim());
    }
  }

  const seen = new Set<string>();
  let duplicates = 0;
  for (const destination of destinations) {
    if (destination.length === 0) continue;
    if (seen.has(destination)) duplicates += 1;
    else seen.add(destination);
  }

  return {
    regionCount: regions.length,
    totalLinks,
    maxLinksInOneRegion: maxLinks,
    maxNestingDepth: maxDepth,
    duplicateDestinations: duplicates,
  };
}

// ---------------------------------------------------------------------------

function collectActions(document: ReturnType<typeof parseHtml>): ActionSignals {
  const buttons = findByTag(document, "button");
  const links = findByTag(document, "a");

  const buttonStyled = links.filter((link) =>
    BUTTON_CLASS_PATTERN.test(getAttribute(link, "class") ?? ""),
  );

  const primaryStyled = [...buttons, ...buttonStyled].filter((element) =>
    PRIMARY_CLASS_PATTERN.test(getAttribute(element, "class") ?? ""),
  );

  const submits = [
    ...buttons.filter((button) => {
      const type = getAttribute(button, "type")?.trim().toLowerCase();
      return type === undefined || type === null || type === "submit";
    }),
    ...findByTag(document, "input").filter((input) => {
      const type = getAttribute(input, "type")?.trim().toLowerCase();
      return type === "submit" || type === "image";
    }),
  ];

  return {
    buttons: buttons.length,
    buttonStyledLinks: buttonStyled.length,
    primaryStyled: primaryStyled.length,
    submitControls: submits.length,
    // Buttons and button-styled links are disjoint sets, so adding them does
    // not double-count.
    candidateActions: buttons.length + buttonStyled.length,
  };
}

// ---------------------------------------------------------------------------

/** Visible text, excluding code and template contents. */
function bodyWords(root: Element | ReturnType<typeof parseHtml>): number {
  let text = "";

  const visit = (node: { childNodes?: unknown }): void => {
    const children = Array.isArray(node.childNodes) ? node.childNodes : [];

    for (const child of children) {
      if (typeof child !== "object" || child === null) continue;

      if ("nodeName" in child && child.nodeName === "#text" && "value" in child) {
        text += ` ${String(child.value)}`;
        continue;
      }
      if (!("tagName" in child)) continue;
      if (NON_TEXT_TAGS.has(String(child.tagName))) continue;

      visit(child as { childNodes?: unknown });
    }
  };

  visit(root as { childNodes?: unknown });
  return countWords(text);
}

function collectDensity(
  document: ReturnType<typeof parseHtml>,
  root: Element | ReturnType<typeof parseHtml>,
): DensitySignals {
  const interactive = findByTag(document, ...INTERACTIVE_SELECTOR_TAGS).filter(
    (element) => {
      // A hidden input is not something a visitor interacts with.
      if (!isHtmlTag(element, "input")) return true;
      return getAttribute(element, "type")?.trim().toLowerCase() !== "hidden";
    },
  );

  const links = findByTag(document, "a").filter((link) => hasAttribute(link, "href"));
  const words = bodyWords(root);

  return {
    interactiveElements: interactive.length,
    links: links.length,
    wordCount: words,
    interactivePer100Words: ratioPer100(interactive.length, words),
    linksPer100Words: ratioPer100(links.length, words),
  };
}

// ---------------------------------------------------------------------------

function collectHeadings(document: ReturnType<typeof parseHtml>): HeadingSignals {
  const headings = findByTag(document, ...HEADING_TAGS);
  const counts = [0, 0, 0, 0, 0, 0];

  const levels: number[] = [];
  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1));
    if (!Number.isFinite(level) || level < 1 || level > 6) continue;

    counts[level - 1] = (counts[level - 1] ?? 0) + 1;
    levels.push(level);
  }

  let skipped = 0;
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1] ?? 0;
    const current = levels[index] ?? 0;
    if (current - previous > 1) skipped += 1;
  }

  return {
    countsByLevel: counts,
    total: levels.length,
    h1Count: counts[0] ?? 0,
    skippedLevels: skipped,
    deepestLevel: levels.length === 0 ? null : Math.max(...levels),
    firstLevel: levels[0] ?? null,
  };
}

// ---------------------------------------------------------------------------

function domDepth(node: { childNodes?: unknown }, depth = 0): number {
  const children = Array.isArray(node.childNodes) ? node.childNodes : [];
  let deepest = depth;

  for (const child of children) {
    if (typeof child !== "object" || child === null) continue;
    if (!("tagName" in child)) continue;

    deepest = Math.max(deepest, domDepth(child as { childNodes?: unknown }, depth + 1));
  }

  return deepest;
}

function collectHierarchy(
  document: ReturnType<typeof parseHtml>,
  root: Element | ReturnType<typeof parseHtml>,
): HierarchySignals {
  const paragraphs = findByTag(document, "p").length;
  const headings = findByTag(document, ...HEADING_TAGS).length;

  return {
    maxDomDepth: domDepth(root as { childNodes?: unknown }),
    landmarkCount: findByTag(document, ...LANDMARK_TAGS).length,
    hasMainLandmark: findFirstByTag(document, "main") !== null,
    paragraphCount: paragraphs,
    listCount: findByTag(document, "ul", "ol").length,
    headingToParagraphRatio:
      paragraphs === 0 ? null : Math.round((headings / paragraphs) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------

function collectForms(document: ReturnType<typeof parseHtml>): FormSignals {
  const forms = findByTag(document, "form");

  let totalFields = 0;
  let maxFields = 0;
  let required = 0;
  let withoutSubmit = 0;

  for (const form of forms) {
    const fields = findByTag(form, "input", "select", "textarea").filter(
      (field) => getAttribute(field, "type")?.trim().toLowerCase() !== "hidden",
    );

    totalFields += fields.length;
    maxFields = Math.max(maxFields, fields.length);
    required += fields.filter((field) => hasAttribute(field, "required")).length;

    const hasSubmit =
      findByTag(form, "button").some((button) => {
        const type = getAttribute(button, "type")?.trim().toLowerCase();
        return type === undefined || type === null || type === "submit";
      }) ||
      findByTag(form, "input").some((input) => {
        const type = getAttribute(input, "type")?.trim().toLowerCase();
        return type === "submit" || type === "image";
      });

    if (!hasSubmit) withoutSubmit += 1;
  }

  return {
    formCount: forms.length,
    totalFields,
    maxFieldsInOneForm: maxFields,
    requiredFields: required,
    formsWithoutSubmit: withoutSubmit,
  };
}

// ---------------------------------------------------------------------------

/**
 * Repeated components.
 *
 * The signature is a tag name plus its first class — approximate by design, and
 * that approximation is why the analyzer treats repetition as a hint rather
 * than a structural fact. Only elements with several children are counted, so
 * a page full of `<span>`s does not register as repetition.
 */
function collectRepetition(document: ReturnType<typeof parseHtml>): RepetitionSignals {
  const signatures = new Map<string, number>();

  for (const element of findByTag(
    document,
    "div",
    "li",
    "article",
    "section",
    "figure",
  )) {
    const elementChildren = element.childNodes.filter((child) => "tagName" in child);
    if (elementChildren.length < 2) continue;

    const className = tokenize(getAttribute(element, "class"))[0];
    if (className === undefined) continue;

    const signature = `${element.tagName}.${className}`;
    signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
  }

  const repeatedBlocks: RepeatedBlock[] = [...signatures.entries()]
    .filter(([, count]) => count > 1)
    .map(([signature, count]) => ({ signature, count }))
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));

  const linkTexts = new Map<string, number>();
  for (const link of findByTag(document, "a")) {
    const text = readableText(link).toLowerCase();
    if (text.length === 0) continue;
    linkTexts.set(text, (linkTexts.get(text) ?? 0) + 1);
  }

  const repeatedLinkTexts: RepeatedBlock[] = [...linkTexts.entries()]
    .filter(([, count]) => count > 1)
    .map(([signature, count]) => ({ signature, count }))
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));

  return {
    repeatedBlocks: repeatedBlocks.slice(0, MAX_REPORTED_ITEMS),
    maxRepetition: repeatedBlocks[0]?.count ?? 0,
    repeatedLinkTexts: repeatedLinkTexts.slice(0, MAX_REPORTED_ITEMS),
  };
}
