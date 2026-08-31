/**
 * Phase 4 — DOM analyzer.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 4, docs/DECISIONS.md ADR-044.
 *
 * Turns a page's HTML into the normalized `PageData` structure that every later
 * analyzer reads.
 *
 * ## Pure by design
 *
 * `extractPageData` is a pure function of `(html, url)`. It launches no
 * browser, makes no request and reads no clock, which is what makes Phase 4's
 * acceptance criterion — deterministic output for the same page state —
 * structurally true rather than merely intended.
 *
 * It works equally on the raw HTML from Phase 2 and the post-JavaScript DOM
 * from Phase 3. The caller chooses which; on a JavaScript-rendered site the
 * rendered form is the honest one.
 *
 * ## Extraction, not judgement
 *
 * Nothing here decides whether a title is too long, whether an image should
 * have alt text, or whether there are too many scripts. Those are Phases 5
 * to 11. This phase reports what the document contains.
 */

import {
  collapseWhitespace,
  findByTag,
  findFirstByTag,
  getAttribute,
  hasAttribute,
  isHtmlTag,
  parseHtml,
  rawTextContent,
  readableText,
  tokenize,
  type Document,
  type Element,
} from "./dom-tree";
import { classifyLink, hostOf, resolveBaseUrl, resolveUrl } from "./urls";
import type {
  FormFieldData,
  HeadingData,
  HeadingLevel,
  ImageData,
  LinkData,
  PageData,
  PageFormData,
  ScriptData,
  StylesheetData,
} from "./types";

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

const FORM_FIELD_TAGS = ["input", "select", "textarea", "button"] as const;

const JSON_LD_TYPE = "application/ld+json";

/**
 * Build the normalized representation of a page.
 *
 * @param html the document source — raw from Phase 2, or rendered from Phase 3.
 * @param url the URL the document was served from, used to resolve relative
 *   references and to tell internal links from external ones.
 */
export function extractPageData(html: string, url: string): PageData {
  const document = parseHtml(html);

  const baseHref = readBaseHref(document);

  // `<base>` governs *resolution* only. Whether a link is internal is a
  // question about the page's own origin, so the host comes from the page URL:
  // a page on example.com with <base href="https://cdn.example.com/"> links
  // away from its own site, and calling those links internal would misreport
  // the site's structure.
  const baseUrl = resolveBaseUrl(url, baseHref);
  const pageHost = hostOf(url);

  return {
    url,
    title: extractTitle(document),
    description: readMetaContent(document, "description"),
    headings: extractHeadings(document),
    links: extractLinks(document, baseUrl, pageHost),
    images: extractImages(document, baseUrl),
    forms: extractForms(document, baseUrl),
    scripts: extractScripts(document, baseUrl),
    stylesheets: extractStylesheets(document, baseUrl),
    htmlLanguage: extractLanguage(document),
    viewport: readMetaContent(document, "viewport"),
    canonical: extractCanonical(document, baseUrl),
    robots: readMetaContent(document, "robots"),
    charset: extractCharset(document),
    baseHref,
    jsonLdBlocks: extractJsonLd(document),
  };
}

// ---------------------------------------------------------------------------
// Document metadata
// ---------------------------------------------------------------------------

function readBaseHref(document: Document): string | null {
  const base = findFirstByTag(document, "base");
  return base === null ? null : getAttribute(base, "href");
}

/**
 * The document title.
 *
 * `null` when there is no `<title>` element at all; `""` when the element is
 * present but empty. An SEO analyzer needs to tell those apart.
 *
 * The first `<title>` wins, matching how a browser sets `document.title`.
 */
function extractTitle(document: Document): string | null {
  const title = findFirstByTag(document, "title");
  return title === null ? null : collapseWhitespace(rawTextContent(title));
}

function extractLanguage(document: Document): string | null {
  const html = findFirstByTag(document, "html");
  if (html === null) return null;

  const lang = getAttribute(html, "lang");
  return lang === null ? null : lang.trim() || null;
}

/**
 * Read `<meta name="…">` content.
 *
 * The name is matched case-insensitively because `Description` and
 * `description` are the same declaration to a browser.
 *
 * Returns `""` when the tag exists without a usable `content`, so "declared but
 * empty" stays distinguishable from "not declared".
 */
function readMetaContent(document: Document, name: string): string | null {
  const meta = findByTag(document, "meta").find(
    (element) => getAttribute(element, "name")?.trim().toLowerCase() === name,
  );

  if (meta === undefined) return null;

  const content = getAttribute(meta, "content");
  return content === null ? "" : collapseWhitespace(content);
}

function extractCanonical(document: Document, baseUrl: string): string | null {
  const link = findByTag(document, "link").find((element) =>
    tokenize(getAttribute(element, "rel")).includes("canonical"),
  );

  if (link === undefined) return null;

  const href = getAttribute(link, "href");
  if (href === null) return null;

  return resolveUrl(href, baseUrl);
}

/** `<meta charset>`, falling back to the legacy `http-equiv` form. */
function extractCharset(document: Document): string | null {
  const metas = findByTag(document, "meta");

  for (const meta of metas) {
    const charset = getAttribute(meta, "charset");
    if (charset !== null) return charset.trim().toLowerCase() || null;
  }

  for (const meta of metas) {
    const equiv = getAttribute(meta, "http-equiv")?.trim().toLowerCase();
    if (equiv !== "content-type") continue;

    const content = getAttribute(meta, "content") ?? "";
    const match = /charset\s*=\s*([^;\s]+)/i.exec(content);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }

  return null;
}

function extractJsonLd(document: Document): string[] {
  return findByTag(document, "script")
    .filter(
      (element) => getAttribute(element, "type")?.trim().toLowerCase() === JSON_LD_TYPE,
    )
    .map((element) => rawTextContent(element).trim());
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function extractHeadings(document: Document): HeadingData[] {
  return findByTag(document, ...HEADING_TAGS).map((element) => ({
    // The tag name is one of HEADING_TAGS, so the digit is always 1-6.
    level: Number(element.tagName.slice(1)) as HeadingLevel,
    text: readableText(element),
    id: getAttribute(element, "id"),
  }));
}

/**
 * Anchors that actually link somewhere.
 *
 * An `<a>` without `href` is not a link — historically it was a named anchor,
 * and today it is usually a placeholder. Including them would misreport how
 * many links a page has.
 */
function extractLinks(document: Document, baseUrl: string, pageHost: string): LinkData[] {
  return findByTag(document, "a")
    .filter((element) => hasAttribute(element, "href"))
    .map((element) => {
      const href = getAttribute(element, "href") ?? "";
      const resolvedUrl = resolveUrl(href, baseUrl);
      const rel = tokenize(getAttribute(element, "rel"));

      return {
        href,
        resolvedUrl,
        kind: classifyLink(href, resolvedUrl, pageHost),
        text: readableText(element),
        rel,
        target: getAttribute(element, "target"),
        nofollow: rel.includes("nofollow"),
      };
    });
}

function extractImages(document: Document, baseUrl: string): ImageData[] {
  return findByTag(document, "img").map((element) => {
    const src = getAttribute(element, "src");

    return {
      src,
      resolvedUrl: src === null ? null : resolveUrl(src, baseUrl),
      // Read through hasAttribute so a missing alt stays distinguishable from
      // an explicitly empty one.
      alt: hasAttribute(element, "alt") ? (getAttribute(element, "alt") ?? "") : null,
      width: getAttribute(element, "width"),
      height: getAttribute(element, "height"),
      loading: getAttribute(element, "loading")?.trim().toLowerCase() ?? null,
      hasSrcset: hasAttribute(element, "srcset"),
    };
  });
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

function extractScripts(document: Document, baseUrl: string): ScriptData[] {
  return findByTag(document, "script").map((element) => {
    const src = getAttribute(element, "src");
    const type = getAttribute(element, "type")?.trim().toLowerCase() ?? null;
    const isInline = src === null;

    return {
      src,
      resolvedUrl: src === null ? null : resolveUrl(src, baseUrl),
      type,
      async: hasAttribute(element, "async"),
      defer: hasAttribute(element, "defer"),
      isModule: type === "module",
      isInline,
      inlineLength: isInline ? rawTextContent(element).length : null,
    };
  });
}

/** External `<link rel="stylesheet">` elements and inline `<style>` blocks. */
function extractStylesheets(document: Document, baseUrl: string): StylesheetData[] {
  const sheets: StylesheetData[] = [];

  for (const element of findByTag(document, "link", "style")) {
    if (isHtmlTag(element, "style")) {
      const source = rawTextContent(element);
      sheets.push({
        href: null,
        resolvedUrl: null,
        media: getAttribute(element, "media"),
        isInline: true,
        inlineLength: source.length,
      });
      continue;
    }

    if (!tokenize(getAttribute(element, "rel")).includes("stylesheet")) continue;

    const href = getAttribute(element, "href");
    sheets.push({
      href,
      resolvedUrl: href === null ? null : resolveUrl(href, baseUrl),
      media: getAttribute(element, "media"),
      isInline: false,
      inlineLength: null,
    });
  }

  return sheets;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function extractForms(document: Document, baseUrl: string): PageFormData[] {
  return findByTag(document, "form").map((element) => {
    const action = getAttribute(element, "action");
    const fields = extractFormFields(element);

    return {
      action,
      resolvedAction: action === null ? null : resolveUrl(action, baseUrl),
      // HTML defaults to GET when the attribute is absent or unrecognised.
      method: getAttribute(element, "method")?.trim().toLowerCase() || "get",
      name: getAttribute(element, "name"),
      id: getAttribute(element, "id"),
      fields,
      hasSubmitControl: fields.some(isSubmitControl),
    };
  });
}

function extractFormFields(form: Element): FormFieldData[] {
  return findByTag(form, ...FORM_FIELD_TAGS).map((element) => ({
    tag: element.tagName as FormFieldData["tag"],
    type: getAttribute(element, "type")?.trim().toLowerCase() ?? null,
    name: getAttribute(element, "name"),
    id: getAttribute(element, "id"),
    required: hasAttribute(element, "required"),
  }));
}

function isSubmitControl(field: FormFieldData): boolean {
  // A <button> with no type submits by default; an <input> does not.
  if (field.tag === "button") return field.type === null || field.type === "submit";
  if (field.tag === "input") return field.type === "submit" || field.type === "image";
  return false;
}
