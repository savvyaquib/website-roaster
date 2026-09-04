/**
 * The numbers this phase compares signals against.
 *
 * Source of truth: docs/DECISIONS.md ADR-051.
 *
 * **None of these are standards.** Unlike Phase 9, where WCAG supplies a real
 * floor for tap targets, nothing here is backed by a specification. They are
 * rules of thumb drawn from common practice, and a well-designed page can sit
 * the wrong side of any of them.
 *
 * They live in one place so that is obvious, and so a reviewer can disagree with
 * a number without reading the logic. Every finding that applies one reports the
 * measured value beside it, so a reader who rejects the threshold can still use
 * the count.
 */

/**
 * Links in one navigation region above which it is worth a look.
 *
 * Loosely follows the old "seven plus or minus two" idea, which is folklore
 * about short-term memory rather than a finding about menus.
 */
export const BUSY_NAVIGATION_LINKS = 12;

/** Navigation nesting deeper than this is hard to hold in your head. */
export const DEEP_NAVIGATION_NESTING = 3;

/**
 * Candidate primary actions above which no single one is likely dominant.
 *
 * A pricing page with one button per plan legitimately exceeds this.
 */
export const MANY_PRIMARY_ACTIONS = 8;

/**
 * Interactive elements per 100 words above which a page reads as more of an
 * index than a page.
 *
 * A navigation-heavy hub page is supposed to look like this.
 */
export const HIGH_INTERACTIVE_DENSITY = 12;

/** Words below which density ratios are too noisy to be worth reporting. */
export const MIN_WORDS_FOR_DENSITY = 50;

/** DOM nesting beyond this usually signals generated or heavily wrapped markup. */
export const DEEP_DOM_NESTING = 20;

/** Fields in one form above which completion rates usually suffer. */
export const LONG_FORM_FIELDS = 8;

/** Repetitions of one block above which a page is largely a list of the same thing. */
export const HIGH_REPETITION = 15;

/** Words above which a page with no subheadings is hard to skim. */
export const LONG_PAGE_WITHOUT_SUBHEADINGS = 400;

/** Upper bound on items listed inside one finding. */
export const MAX_REPORTED_ITEMS = 5;
