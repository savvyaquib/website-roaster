/**
 * A thin traversal layer over parse5.
 *
 * Source of truth: docs/DECISIONS.md ADR-044.
 *
 * parse5 produces a WHATWG-conformant tree but exposes it as plain nodes with
 * `attrs` arrays rather than a DOM. These helpers are the adapter, and they are
 * the only place in the codebase that knows what a parse5 node looks like.
 *
 * Everything here is pure and synchronous. No network, no browser.
 */

import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

export type Document = DefaultTreeAdapterMap["document"];
export type Element = DefaultTreeAdapterMap["element"];
export type ChildNode = DefaultTreeAdapterMap["childNode"];
export type ParentNode = DefaultTreeAdapterMap["parentNode"];

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/**
 * Elements whose text content is code or data, not page text.
 *
 * Excluded when reading text so that a stray `<script>` inside a link does not
 * become part of the link's label.
 */
const NON_TEXT_TAGS = new Set(["script", "style", "template", "noscript"]);

export function parseHtml(html: string): Document {
  return parse(html);
}

export function isElement(node: ChildNode | ParentNode): node is Element {
  return "tagName" in node;
}

/**
 * Is this an HTML element with the given tag name?
 *
 * The namespace check matters: `<a>` inside an `<svg>` is an SVG link, not an
 * HTML anchor, and counting it as one would inflate the link list on any page
 * with an inline icon set.
 */
export function isHtmlTag(node: ChildNode | ParentNode, tagName: string): boolean {
  return (
    isElement(node) && node.namespaceURI === HTML_NAMESPACE && node.tagName === tagName
  );
}

export function getAttribute(element: Element, name: string): string | null {
  // parse5 lowercases attribute names for HTML elements, so a direct compare is
  // enough and avoids a per-lookup scan with case folding.
  const attribute = element.attrs.find((candidate) => candidate.name === name);
  return attribute === undefined ? null : attribute.value;
}

export function hasAttribute(element: Element, name: string): boolean {
  return element.attrs.some((candidate) => candidate.name === name);
}

/** Children of a node, or an empty list for nodes that cannot have any. */
function childrenOf(node: ChildNode | ParentNode): ChildNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

/**
 * Every element under `root`, in document order.
 *
 * Document order is what makes the extractor's output deterministic, which is
 * Phase 4's acceptance criterion.
 *
 * `<template>` content is not visited: parse5 places it on a separate
 * `content` fragment, and it is inert until cloned, so it is not part of the
 * page as rendered.
 */
export function findAll(
  root: ChildNode | ParentNode,
  predicate: (element: Element) => boolean,
): Element[] {
  const found: Element[] = [];

  const visit = (node: ChildNode | ParentNode): void => {
    if (isElement(node) && predicate(node)) found.push(node);
    for (const child of childrenOf(node)) visit(child);
  };

  visit(root);
  return found;
}

export function findFirst(
  root: ChildNode | ParentNode,
  predicate: (element: Element) => boolean,
): Element | null {
  const visit = (node: ChildNode | ParentNode): Element | null => {
    if (isElement(node) && predicate(node)) return node;

    for (const child of childrenOf(node)) {
      const match = visit(child);
      if (match !== null) return match;
    }

    return null;
  };

  return visit(root);
}

/** Find all HTML elements with any of the given tag names, in document order. */
export function findByTag(
  root: ChildNode | ParentNode,
  ...tagNames: readonly string[]
): Element[] {
  const wanted = new Set(tagNames);
  return findAll(
    root,
    (element) => element.namespaceURI === HTML_NAMESPACE && wanted.has(element.tagName),
  );
}

export function findFirstByTag(
  root: ChildNode | ParentNode,
  tagName: string,
): Element | null {
  return findFirst(root, (element) => isHtmlTag(element, tagName));
}

/**
 * Concatenated text of an element's descendants.
 *
 * Entity references are already decoded by the parser, so this returns the text
 * a reader would see. Script, style and template contents are skipped.
 */
export function textContent(node: ChildNode | ParentNode): string {
  let text = "";

  const visit = (current: ChildNode | ParentNode): void => {
    if (current.nodeName === "#text" && "value" in current) {
      text += current.value;
      return;
    }

    if (isElement(current) && NON_TEXT_TAGS.has(current.tagName)) return;

    for (const child of childrenOf(current)) visit(child);
  };

  visit(node);
  return text;
}

/** Raw text of an element, including code — used for `<script>` and `<style>`. */
export function rawTextContent(element: Element): string {
  let text = "";

  for (const child of element.childNodes) {
    if (child.nodeName === "#text" && "value" in child) text += child.value;
  }

  return text;
}

/** Collapse all runs of whitespace to a single space and trim. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Read an element's text the way a reader would perceive it. */
export function readableText(node: ChildNode | ParentNode): string {
  return collapseWhitespace(textContent(node));
}

/**
 * Split a space-separated attribute (`rel`, `class`) into lowercased tokens.
 *
 * Order is preserved so the output stays deterministic.
 */
export function tokenize(value: string | null): string[] {
  if (value === null) return [];
  return collapseWhitespace(value.toLowerCase()).split(" ").filter(Boolean);
}
