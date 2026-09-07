/**
 * What the share card says.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 18, ADR-059.
 *
 * Kept apart from the drawing so the editorial decisions — which categories,
 * which roast line, what a card says when there is no report — can be tested
 * without rendering an image.
 *
 * The brief is explicit that the card must not be information-dense. Everything
 * here is therefore a *choice about what to leave out*, and each one is written
 * down rather than left to whatever happened to fit.
 */

import type { AnalysisJob } from "@/lib/jobs";
import type { Grade } from "@/lib/scoring";
import { statusCopy } from "@/lib/ui/format";
import { hostOf } from "@/lib/ui/format";
import { categoryLabel } from "@/lib/ui/format";

/**
 * Category scores on the card.
 *
 * Four fits across 1200px at a size still legible when the card is scaled to a
 * timeline thumbnail. A fifth would shrink all of them.
 */
export const MAX_CARD_CATEGORIES = 4;

/**
 * Longest punchline the card will set at display size.
 *
 * Past this it wraps to a fourth line and starts crowding the score.
 */
export const MAX_PUNCHLINE_LENGTH = 118;

/**
 * Longest host the card sets on one line.
 *
 * Beyond this the host wraps and pushes the wordmark onto a second line. The
 * end of a hostname is the part that identifies it, so the *middle* is removed
 * rather than the tail: `some-startup…example.io` is still recognisable in a
 * way that `some-startup-with-a-longi…` is not.
 */
export const MAX_HOST_LENGTH = 34;

export function shortenHost(host: string): string {
  if (host.length <= MAX_HOST_LENGTH) return host;

  const tail = Math.floor((MAX_HOST_LENGTH - 1) / 2);
  const head = MAX_HOST_LENGTH - 1 - tail;

  return `${host.slice(0, head)}…${host.slice(host.length - tail)}`;
}

export interface CardCategory {
  readonly label: string;
  readonly score: number;
  readonly grade: Grade;
}

export interface CardRoast {
  readonly observation: string;
  readonly punchline: string;
}

export interface ShareCardData {
  /** The host, which is what a reader recognises. */
  readonly host: string;
  /** Null when the analysis produced no score. */
  readonly score: number | null;
  readonly grade: Grade | null;
  readonly categories: readonly CardCategory[];
  /** Assessed categories the card had no room for. */
  readonly hiddenCategoryCount: number;
  /** Null when there was nothing to roast, or no report at all. */
  readonly roast: CardRoast | null;
  /**
   * What to say instead of a score.
   *
   * Set when the analysis did not complete, so a shared link still previews as
   * something truthful rather than as a blank card.
   */
  readonly statusNote: string | null;
}

/**
 * Choose the roast line to show.
 *
 * The first line is the highest-ranked problem, so it is the one most worth
 * reading. A very long punchline is skipped in favour of the next one rather
 * than truncated — a joke with its ending cut off is not a joke, and the card
 * has three other lines to choose from.
 */
export function selectRoastLine(
  lines: readonly { observation: string; punchline: string }[],
): CardRoast | null {
  const fits = lines.find((line) => line.punchline.length <= MAX_PUNCHLINE_LENGTH);
  const chosen = fits ?? lines[0];

  if (chosen === undefined) return null;

  return {
    observation: chosen.observation,
    punchline:
      chosen.punchline.length <= MAX_PUNCHLINE_LENGTH
        ? chosen.punchline
        : `${chosen.punchline.slice(0, MAX_PUNCHLINE_LENGTH - 1).trimEnd()}…`,
  };
}

/**
 * Everything the card draws.
 *
 * Pure. Given the same job it always produces the same card, which is what
 * makes a shared image stable: the same link previews the same way every time
 * somebody posts it.
 */
export function shareCardData(job: AnalysisJob): ShareCardData {
  const host = shortenHost(job.url === null ? job.submittedUrl : hostOf(job.url));

  if (job.report === null) {
    return {
      host,
      score: null,
      grade: null,
      categories: [],
      hiddenCategoryCount: 0,
      roast: null,
      statusNote: statusCopy(job.status).heading,
    };
  }

  const assessed = job.report.score.categories.filter(
    (category): category is typeof category & { score: number; grade: Grade } =>
      category.score !== null && category.grade !== null,
  );

  return {
    host,
    score: job.report.score.overall.score,
    grade: job.report.score.overall.grade,
    categories: assessed.slice(0, MAX_CARD_CATEGORIES).map((category) => ({
      label: categoryLabel(category.category),
      score: category.score,
      grade: category.grade,
    })),
    hiddenCategoryCount: Math.max(0, assessed.length - MAX_CARD_CATEGORIES),
    roast: selectRoastLine(job.report.roast.lines),
    statusNote: null,
  };
}

/** The sentence a link preview shows under the title. */
export function shareDescription(data: ShareCardData): string {
  if (data.statusNote !== null) {
    return `${data.host} — the analysis did not finish. ${data.statusNote}.`;
  }

  if (data.roast !== null) return data.roast.punchline;

  return data.score === null
    ? `${data.host} was analyzed, but nothing could be assessed.`
    : `${data.host} scored ${data.score} out of 100.`;
}
