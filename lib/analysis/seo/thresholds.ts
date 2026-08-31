/**
 * Numeric thresholds used by the SEO checks.
 *
 * Source of truth: docs/DECISIONS.md ADR-045.
 *
 * These are conventions, not measurements. They live in one named place —
 * separate from the checks that apply them — for the same reason scoring
 * weights live in `docs/SCORING.md`: so they can be reviewed and changed
 * without reading the logic, and so nobody has to guess where a number came
 * from.
 *
 * None of these are absolute rules. They are the widely-published guidance for
 * how search results render, and every finding that uses one reports the
 * measured value as evidence so a reader can disagree with the threshold and
 * still trust the number.
 */

export const TITLE_LENGTH = {
  /** Below this, a title is unlikely to describe the page usefully. */
  min: 30,
  /** Beyond this, most search results truncate the title. */
  max: 60,
} as const;

export const META_DESCRIPTION_LENGTH = {
  min: 70,
  /** Beyond this, most search results truncate the description. */
  max: 160,
} as const;

/** Heading levels may not be skipped, e.g. an `<h2>` followed by an `<h4>`. */
export const MAX_HEADING_LEVEL_JUMP = 1;

/**
 * Paths tried when looking for a sitemap, in order.
 *
 * A `Sitemap:` directive in robots.txt takes precedence over all of these.
 */
export const SITEMAP_FALLBACK_PATHS: readonly string[] = ["/sitemap.xml"];

export const ROBOTS_TXT_PATH = "/robots.txt";
