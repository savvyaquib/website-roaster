/**
 * Values the mobile checks compare against.
 *
 * Source of truth: docs/DECISIONS.md ADR-049.
 *
 * Two kinds of number live here and they are not equivalent:
 *
 * - **standards-backed floors**, which a page either meets or does not;
 * - **comfort guidelines**, which are widely recommended but not a rule.
 *
 * Findings built on the first kind are `measured`. Findings built on the second
 * are `heuristic`, and say so (ADR-009).
 */

/**
 * Minimum tap target size, in CSS pixels.
 *
 * WCAG 2.2 success criterion 2.5.8 (Target Size, Minimum) sets 24x24. This is a
 * floor, not a recommendation: below it, a control fails a published standard.
 */
export const MIN_TAP_TARGET_PX = 24;

/**
 * The size most platform guidelines recommend for comfortable tapping.
 *
 * Apple's guidance is 44pt and Material Design's is 48dp. A control between the
 * WCAG floor and this is not a failure, and saying otherwise would overstate
 * what is known.
 */
export const COMFORTABLE_TAP_TARGET_PX = 44;

/**
 * Body text below this is generally hard to read on a phone.
 *
 * A guideline rather than a standard, so findings using it are heuristic.
 */
export const MIN_COMFORTABLE_FONT_PX = 12;

/**
 * Horizontal overflow below this is sub-pixel rounding, not a layout problem.
 *
 * Browsers routinely report a scroll width a fraction wider than the viewport
 * on a perfectly fine page.
 */
export const OVERFLOW_TOLERANCE_PX = 2;

/**
 * Overflow beyond this is treated as a broken layout rather than a stray
 * element.
 */
export const SEVERE_OVERFLOW_PX = 50;

/** Upper bound on elements listed per finding, so a report stays readable. */
export const MAX_REPORTED_ELEMENTS = 5;

/**
 * Number of primary navigation links above which a page is expected to have
 * some form of mobile navigation control.
 *
 * Purely a heuristic: plenty of usable sites break it.
 */
export const NAV_LINKS_EXPECTING_TOGGLE = 6;
