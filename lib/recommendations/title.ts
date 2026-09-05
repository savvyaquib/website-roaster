/**
 * Deriving a title for a recommendation.
 *
 * Source of truth: ADR-029, ADR-053.
 *
 * ## Why this exists at all
 *
 * `Finding` has no title field, and adding one would mean editing the canonical
 * model and all eleven analyzers — which ADR-029 rules out, and which this
 * phase has no mandate to do. Presentation is explicitly this layer's job, so
 * the title is derived here.
 *
 * ## What it derives from
 *
 * The **first evidence summary**, in preference to anything else. Evidence
 * summaries are short authored statements of what was actually observed — "There
 * is no `<link rel="canonical">` tag", "0 navigation regions were found" — which
 * is precisely what a title should say. Using them means a new finding from any
 * future analyzer gets a sensible title with no lookup table to maintain and
 * nothing to fall out of date.
 *
 * The fallbacks exist so this can never return an empty title: the explanation's
 * first sentence, then the finding's own identifier.
 *
 * Every recommendation records which of the three it used, in `titleSource`, so
 * a reader is never told a derived label was authored.
 */

import type { Finding } from "@/lib/types/finding";

import type { TitleSource } from "./types";

/**
 * Longest title produced.
 *
 * Long enough for a full short sentence, short enough that a title cannot
 * become a paragraph when an analyzer writes a long summary.
 */
export const MAX_TITLE_LENGTH = 80;

/** Characters that end a sentence. */
const SENTENCE_ENDINGS = [".", "?", "!"];

export interface DerivedTitle {
  readonly title: string;
  readonly source: TitleSource;
}

/**
 * A short label naming what this finding is about.
 *
 * Deterministic: the same finding always yields the same title.
 */
export function deriveTitle(finding: Finding): DerivedTitle {
  const evidence = finding.evidence.find(
    (item) => collapseWhitespace(item.summary).length > 0,
  );

  if (evidence !== undefined) {
    return { title: titleCase(evidence.summary), source: "evidence" };
  }

  if (collapseWhitespace(finding.explanation).length > 0) {
    return { title: titleCase(finding.explanation), source: "explanation" };
  }

  // Only reachable for a finding with neither evidence nor an explanation,
  // which the model forbids. Producing the identifier is still better than
  // producing an empty string, and it stays traceable.
  return { title: humaniseIdentifier(finding.id), source: "identifier" };
}

/** Clean a sentence of prose into a title. */
function titleCase(text: string): string {
  return capitalise(shorten(stripTrailingPeriod(firstSentence(text))));
}

function collapseWhitespace(text: string): string {
  return text.split(/\s+/).join(" ").trim();
}

/**
 * The first sentence of a piece of prose.
 *
 * A sentence ends at `.`, `?` or `!` followed by whitespace or the end of the
 * text. The trailing-whitespace requirement is what stops "3.5s" or
 * "example.com" from being read as two sentences.
 */
function firstSentence(text: string): string {
  const collapsed = collapseWhitespace(text);

  for (let index = 0; index < collapsed.length; index += 1) {
    const character = collapsed[index] ?? "";
    if (!SENTENCE_ENDINGS.includes(character)) continue;

    const next = collapsed[index + 1];
    if (next === undefined) return collapsed;
    if (next === " ") return collapsed.slice(0, index + 1);
  }

  return collapsed;
}

/**
 * Drop a single trailing full stop.
 *
 * A title does not take one. A question or exclamation keeps its mark, because
 * removing it would change what the sentence is doing.
 */
function stripTrailingPeriod(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

/** Truncate at a word boundary, marking that something was cut. */
function shorten(text: string, maxLength = MAX_TITLE_LENGTH): string {
  if (text.length <= maxLength) return text;

  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");

  // A single word longer than the cap has no boundary to break on, so it is
  // truncated mid-word rather than returned over-length.
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]?.toUpperCase() + text.slice(1);
}

/**
 * Turn `seo.canonical.missing` into "Canonical missing".
 *
 * The category prefix is dropped because the recommendation already carries the
 * category. This is a last resort and reads like one, which is appropriate: a
 * finding reaching it is missing the evidence the model requires.
 */
function humaniseIdentifier(id: string): string {
  const segments = id.split(".").filter((segment) => segment.length > 0);
  const words = (segments.length > 1 ? segments.slice(1) : segments)
    .join(" ")
    .split("_")
    .join(" ");

  return capitalise(collapseWhitespace(words)) || id;
}
