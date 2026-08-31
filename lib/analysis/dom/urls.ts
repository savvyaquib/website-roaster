/**
 * URL resolution and link classification for the DOM analyzer.
 *
 * Separate from the extractor because these are the fiddly parts — `<base>`
 * handling, protocol-relative URLs, non-navigational schemes — and they deserve
 * their own tests.
 *
 * This is *not* the security layer. Nothing here decides whether a URL may be
 * contacted; that is Phase 1's job and this phase makes no requests at all.
 */

import type { LinkKind } from "./types";

/**
 * Resolve a possibly-relative URL against a base.
 *
 * @returns the absolute URL, or `null` if it cannot be resolved. A page can
 *   contain any string in an `href`, so failure is ordinary and is reported
 *   rather than thrown.
 */
export function resolveUrl(raw: string, base: string): string | null {
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

/**
 * Work out the base URL for relative references.
 *
 * A `<base href>` overrides the document URL, and may itself be relative — so
 * it is resolved against the document URL first. An unresolvable `<base>` is
 * ignored, which is what browsers do.
 */
export function resolveBaseUrl(pageUrl: string, baseHref: string | null): string {
  if (baseHref === null) return pageUrl;

  const resolved = resolveUrl(baseHref, pageUrl);
  return resolved ?? pageUrl;
}

/**
 * Classify a link by where it points.
 *
 * @param href the raw attribute, needed because `#section` and `` resolve to
 *   absolute URLs that no longer show what was written.
 * @param resolved the absolute form, or null if it would not resolve.
 * @param pageHost the host of the page, for the internal/external split.
 */
export function classifyLink(
  href: string,
  resolved: string | null,
  pageHost: string,
): LinkKind {
  const trimmed = href.trim();

  // A pure fragment never leaves the page, whatever it resolves to.
  if (trimmed.startsWith("#")) return "anchor";

  if (resolved === null) return "other";

  let parsed: URL;
  try {
    parsed = new URL(resolved);
  } catch {
    return "other";
  }

  switch (parsed.protocol) {
    case "mailto:":
      return "mailto";
    case "tel:":
      return "tel";
    case "http:":
    case "https:":
      return parsed.host === pageHost ? "internal" : "external";
    default:
      // javascript:, data:, ftp: and anything else. Not a navigation to a page
      // we could analyze, so it is not internal or external.
      return "other";
  }
}

/** The host of a page URL, or an empty string if it cannot be parsed. */
export function hostOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).host;
  } catch {
    return "";
  }
}
