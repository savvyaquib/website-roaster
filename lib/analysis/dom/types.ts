/**
 * The normalized page representation.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 4.
 *
 * This is the single structured description of a page. Every analyzer from
 * Phase 5 onwards reads it rather than re-parsing HTML, which is what keeps
 * their findings consistent with each other.
 *
 * It is deliberately independent of the UI and of the browser: it is a plain
 * data structure, produced by a pure function, and it says nothing about
 * whether any of it is *good*. Judgement belongs to Phases 5 to 11.
 *
 * ## Reading `null` in this file
 *
 * `null` consistently means "not present in the document". An empty string
 * means "present but empty" — `<title></title>` is a different fact from a page
 * with no `<title>` at all, and collapsing the two would lose exactly the
 * distinction ADR-021 exists to preserve.
 */

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface HeadingData {
  readonly level: HeadingLevel;
  /** Text content, whitespace-collapsed and trimmed. */
  readonly text: string;
  readonly id: string | null;
}

/** What kind of destination a link points at. */
export type LinkKind =
  /** Same host as the page. */
  | "internal"
  /** A different host. */
  | "external"
  /** A fragment on this page (`#section`). */
  | "anchor"
  | "mailto"
  | "tel"
  /** `javascript:`, unresolvable, or an unrecognised scheme. */
  | "other";

export interface LinkData {
  /** The `href` attribute exactly as written. */
  readonly href: string;
  /** Absolute URL, resolved against `<base>` or the page URL. Null if unresolvable. */
  readonly resolvedUrl: string | null;
  readonly kind: LinkKind;
  /** Link text, whitespace-collapsed and trimmed. Empty for image-only links. */
  readonly text: string;
  /** `rel` tokens, lowercased, in document order. */
  readonly rel: readonly string[];
  readonly target: string | null;
  readonly nofollow: boolean;
}

export interface ImageData {
  /** The `src` attribute as written. Null when absent, e.g. `srcset`-only. */
  readonly src: string | null;
  readonly resolvedUrl: string | null;
  /**
   * The `alt` attribute.
   *
   * `null` means the attribute is absent, which is an accessibility problem.
   * `""` means it is explicitly empty, which is the correct way to mark a
   * decorative image. These must not be conflated.
   */
  readonly alt: string | null;
  /** Raw `width` attribute. Kept unparsed: it may be `100`, `100px` or junk. */
  readonly width: string | null;
  readonly height: string | null;
  readonly loading: string | null;
  readonly hasSrcset: boolean;
}

export interface FormFieldData {
  readonly tag: "input" | "select" | "textarea" | "button";
  /** The `type` attribute, lowercased. Null when absent. */
  readonly type: string | null;
  readonly name: string | null;
  readonly id: string | null;
  readonly required: boolean;
}

export interface PageFormData {
  readonly action: string | null;
  readonly resolvedAction: string | null;
  /** Lowercased. Defaults to `get`, as HTML does when the attribute is absent. */
  readonly method: string;
  readonly name: string | null;
  readonly id: string | null;
  readonly fields: readonly FormFieldData[];
  readonly hasSubmitControl: boolean;
}

export interface ScriptData {
  readonly src: string | null;
  readonly resolvedUrl: string | null;
  /**
   * The `type` attribute, lowercased.
   *
   * Every `<script>` element is listed here, including data blocks such as
   * `application/ld+json`. A consumer measuring JavaScript cost must filter on
   * this field rather than assume every entry is executable code.
   */
  readonly type: string | null;
  readonly async: boolean;
  readonly defer: boolean;
  readonly isModule: boolean;
  readonly isInline: boolean;
  /** Length of the inline source in characters. Null for external scripts. */
  readonly inlineLength: number | null;
}

export interface StylesheetData {
  /** Null for an inline `<style>` block. */
  readonly href: string | null;
  readonly resolvedUrl: string | null;
  readonly media: string | null;
  readonly isInline: boolean;
  readonly inlineLength: number | null;
}

export interface PageData {
  /** The URL the representation was resolved against. */
  readonly url: string;
  /** Null when there is no `<title>`; `""` when it is present but empty. */
  readonly title: string | null;
  /** Content of `<meta name="description">`. */
  readonly description: string | null;
  readonly headings: readonly HeadingData[];
  readonly links: readonly LinkData[];
  readonly images: readonly ImageData[];
  readonly forms: readonly PageFormData[];
  readonly scripts: readonly ScriptData[];
  readonly stylesheets: readonly StylesheetData[];
  /** `lang` on the root element. */
  readonly htmlLanguage: string | null;
  /** Content of `<meta name="viewport">`. */
  readonly viewport: string | null;
  /** `href` of `<link rel="canonical">`, resolved. */
  readonly canonical: string | null;
  /** Content of `<meta name="robots">`. */
  readonly robots: string | null;
  /** Declared character encoding, lowercased. */
  readonly charset: string | null;
  /** `href` of `<base>`, as written. Null when absent. */
  readonly baseHref: string | null;
  /**
   * Raw text of each `<script type="application/ld+json">` block.
   *
   * Deliberately unparsed. Whether the JSON is valid, and what it declares, is
   * a Phase 5 question; this phase only reports that the blocks are there.
   */
  readonly jsonLdBlocks: readonly string[];
}
