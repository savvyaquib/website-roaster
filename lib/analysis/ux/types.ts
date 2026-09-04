/**
 * UX signal types.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 11, docs/DECISIONS.md ADR-009,
 * ADR-051.
 *
 * ## Everything here is measured; nothing here is a verdict
 *
 * `UxSignals` holds counts, depths and ratios — all of them objectively
 * countable from the document. A page has eleven navigation links or it does
 * not.
 *
 * Whether eleven is *too many* is not in this file, and is not a fact. That
 * judgement lives in the analyzer, is emitted as a `heuristic` finding, and
 * always cites the number that prompted it.
 *
 * The split matters because UX is the least objective category the product
 * scores, and presenting an inference as a measurement is the specific way this
 * phase could mislead someone (ADR-009).
 */

/** How the primary navigation is put together. */
export interface NavigationSignals {
  /** `<nav>` elements and elements with a navigation role. */
  readonly regionCount: number;
  readonly totalLinks: number;
  /** Links in the single busiest navigation region. */
  readonly maxLinksInOneRegion: number;
  /** Deepest nesting of lists inside a navigation region. */
  readonly maxNestingDepth: number;
  /** Links pointing at a destination another navigation link already covers. */
  readonly duplicateDestinations: number;
}

/** Controls competing to be the thing a visitor does next. */
export interface ActionSignals {
  readonly buttons: number;
  /** Links styled as buttons — `btn`, `button`, `cta` in the class list. */
  readonly buttonStyledLinks: number;
  /** Controls whose class marks them as primary. */
  readonly primaryStyled: number;
  readonly submitControls: number;
  /** Everything above, deduplicated: the pool of candidate primary actions. */
  readonly candidateActions: number;
}

/** How much of the page is clickable relative to how much is readable. */
export interface DensitySignals {
  readonly interactiveElements: number;
  readonly links: number;
  readonly wordCount: number;
  /** Null when the page has no words to divide by. */
  readonly interactivePer100Words: number | null;
  readonly linksPer100Words: number | null;
}

/** The document outline. */
export interface HeadingSignals {
  /** Counts for h1 through h6, in order. */
  readonly countsByLevel: readonly number[];
  readonly total: number;
  readonly h1Count: number;
  /** Places where the outline jumps a level, e.g. h2 straight to h4. */
  readonly skippedLevels: number;
  /** Deepest heading level used. */
  readonly deepestLevel: number | null;
  readonly firstLevel: number | null;
}

/** How the page is structured beneath the headings. */
export interface HierarchySignals {
  /** Deepest element nesting in the body. */
  readonly maxDomDepth: number;
  /** `main`, `nav`, `header`, `footer`, `aside`, `article`, `section`. */
  readonly landmarkCount: number;
  readonly hasMainLandmark: boolean;
  readonly paragraphCount: number;
  readonly listCount: number;
  /** Headings divided by paragraphs. Null when there are no paragraphs. */
  readonly headingToParagraphRatio: number | null;
}

export interface FormSignals {
  readonly formCount: number;
  readonly totalFields: number;
  readonly maxFieldsInOneForm: number;
  readonly requiredFields: number;
  /** Forms with no submit control, which cannot obviously be completed. */
  readonly formsWithoutSubmit: number;
}

/** A block of markup that appears many times over. */
export interface RepeatedBlock {
  /** Tag plus first class, e.g. `div.card`. Approximate by design. */
  readonly signature: string;
  readonly count: number;
}

export interface RepetitionSignals {
  readonly repeatedBlocks: readonly RepeatedBlock[];
  /** Occurrences of the most repeated block. */
  readonly maxRepetition: number;
  /** Link labels used more than once, and how often. */
  readonly repeatedLinkTexts: readonly RepeatedBlock[];
}

/** Everything counted. All of it objective; none of it a judgement. */
export interface UxSignals {
  readonly url: string;
  readonly navigation: NavigationSignals;
  readonly actions: ActionSignals;
  readonly density: DensitySignals;
  readonly headings: HeadingSignals;
  readonly hierarchy: HierarchySignals;
  readonly forms: FormSignals;
  readonly repetition: RepetitionSignals;
}

export interface UxAnalysisInput {
  readonly signals: UxSignals;
}
