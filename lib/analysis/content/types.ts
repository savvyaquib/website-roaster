/**
 * Content analyzer types.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 10, docs/DECISIONS.md ADR-009,
 * ADR-050.
 *
 * ## Extraction is not uniformly factual
 *
 * Some of what this phase finds is structural, and therefore a fact: a
 * `<footer>` element *is* the footer, a `mailto:` link *is* an email address, a
 * `<button>` *is* a control.
 *
 * The rest is inferred from wording and position: a section whose heading says
 * "Pricing" is *probably* pricing, the paragraph after the headline is *usually*
 * the subheading, a link reading "Get started" is *likely* a call to action.
 *
 * Every extracted item therefore records **how it was found**. The analyzer
 * turns `structural` into `measured` evidence and `inferred` into `heuristic`
 * evidence, so the distinction survives all the way to the report (ADR-009).
 */

/** How an item was identified. */
export type DetectionMethod =
  /** From markup that means what it says: `<footer>`, `mailto:`, `<button>`. */
  | "structural"
  /** From wording, position or pattern matching. A guess, and treated as one. */
  | "inferred";

export type SectionKind =
  "features" | "pricing" | "testimonials" | "faq" | "contact" | "about" | "unknown";

/** A call to action. */
export interface CallToAction {
  readonly text: string;
  /** Resolved destination. Null for a `<button>` with no link. */
  readonly href: string | null;
  readonly element: "button" | "link";
  readonly detection: DetectionMethod;
  /** Where on the page it appeared. */
  readonly region: "hero" | "body" | "footer" | "navigation";
  /** Which pattern matched, when detection was inferred. */
  readonly matchedPattern: string | null;
}

export interface HeroContent {
  /** The main headline. Null when the page has none. */
  readonly headline: string | null;
  /** `h1` is structural; `title` is a fallback and says so. */
  readonly headlineSource: "h1" | "title" | null;
  readonly headlineDetection: DetectionMethod | null;
  /** The supporting line beneath the headline, if one was identified. */
  readonly supportingCopy: string | null;
  readonly supportingCopySource: "paragraph" | "meta_description" | null;
  readonly supportingCopyDetection: DetectionMethod | null;
  readonly wordCount: number;
}

export interface ContentSection {
  readonly kind: SectionKind;
  readonly detection: DetectionMethod;
  readonly heading: string | null;
  readonly headingLevel: number | null;
  readonly wordCount: number;
  /** What caused the classification, e.g. `heading matched "pricing"`. */
  readonly signals: readonly string[];
}

export interface ContactInformation {
  /** From `mailto:` links. Structural. */
  readonly mailtoAddresses: readonly string[];
  /** Found in page text by pattern. Inferred. */
  readonly textEmails: readonly string[];
  /** From `tel:` links. Structural. */
  readonly telLinks: readonly string[];
  /** Found in page text by pattern. Inferred. */
  readonly textPhones: readonly string[];
  /** Content of `<address>` elements. Structural. */
  readonly addressBlocks: readonly string[];
  /** Links whose text or destination indicates a contact page. Inferred. */
  readonly contactLinks: readonly string[];
  /** Links to recognised social platforms. Inferred from the host. */
  readonly socialLinks: readonly string[];
}

export interface FooterContent {
  readonly present: boolean;
  readonly detection: DetectionMethod | null;
  readonly linkCount: number;
  readonly wordCount: number;
  /** A copyright notice was found in the footer text. Inferred. */
  readonly hasCopyrightNotice: boolean;
}

/** Something that reads as social proof. All inferred. */
export interface TrustSignal {
  readonly kind: "testimonial" | "rating" | "client_logos" | "credential";
  readonly detection: DetectionMethod;
  readonly excerpt: string;
  readonly signal: string;
}

/**
 * Everything extracted from the page.
 *
 * Facts and inferences live side by side, each labelled. Nothing here is a
 * judgement about quality — that is the analyzer's job, and much of it is
 * explicitly heuristic.
 */
export interface ContentInventory {
  readonly url: string;
  readonly title: string | null;
  readonly metaDescription: string | null;

  readonly hero: HeroContent;
  readonly ctas: readonly CallToAction[];
  readonly sections: readonly ContentSection[];
  readonly contact: ContactInformation;
  readonly footer: FooterContent;
  readonly trustSignals: readonly TrustSignal[];

  /** Words of visible body text, excluding script, style and navigation. */
  readonly wordCount: number;
  readonly paragraphCount: number;
  readonly headingCount: number;
  /** Longest run of uninterrupted body text, in words. */
  readonly longestParagraphWords: number;
}

export interface ContentAnalysisInput {
  readonly inventory: ContentInventory;
}
