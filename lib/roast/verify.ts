/**
 * Checking a roast before anyone reads it.
 *
 * Source of truth: ADR-015, ADR-055, ADR-056.
 *
 * Three things this layer adds on top of Phase 14's prose checks, which it
 * reuses rather than re-listing:
 *
 * 1. **Every line is about a finding that was selected for roasting.** Not
 *    merely a finding that exists — one this roast was asked about. A model
 *    that reaches for a different problem, however real, has chosen its own
 *    subject, and choosing the subject is where fabrication starts.
 * 2. **Nothing abusive.** ADR-015 requires non-abusive, and a roast is the one
 *    place in this product where a model has been invited to be unkind. The
 *    line to hold is that the website is the target and a person never is.
 * 3. **No repeated punchline.** Four identical jokes is a broken roast, and it
 *    is the failure mode of a model that has run out of ideas.
 *
 * Pure.
 */

import { previewText } from "@/lib/ai/errors";
import { checkProse } from "@/lib/ai/interpretation";
import type { Violation } from "@/lib/ai/interpretation";
import type { JsonValue } from "@/lib/ai/types";
import type { Finding } from "@/lib/types/finding";

import type { RoastDraft } from "./types";

/**
 * Words that make a line about a person rather than a page.
 *
 * Not a profanity list. Swearing at a layout is within the brief; calling the
 * person who built it stupid is not, and these are the words that do that.
 * Matched as whole words, so "idiotic navigation" is caught but "assumption"
 * is not.
 */
const PERSONAL_INSULTS: readonly string[] = [
  "idiot",
  "idiots",
  "idiotic",
  "moron",
  "morons",
  "moronic",
  "stupid",
  "dumb",
  "incompetent",
  "lazy",
  "clueless",
  "pathetic",
  "worthless",
  "brain-dead",
  "braindead",
  "amateur hour",
  "embarrassment",
  "disgrace",
  "shameful",
  "loser",
  "losers",
  "fool",
  "fools",
];

/**
 * Phrases aimed at the reader themselves.
 *
 * A roast talks about the website in the third person or the second-person
 * possessive — "your navigation", "the page". "You are" followed by a judgement
 * is the shape of an insult to a person.
 */
const PERSONAL_ATTACK_PATTERNS: readonly RegExp[] = [
  /\byou (?:are|were|must be|clearly are)\b/i,
  /\byou'?re\b/i,
  /\bwhoever (?:built|made|wrote|designed) this\b/i,
  /\bthe person who\b/i,
];

export interface RoastVerificationInput {
  readonly draft: RoastDraft;
  /** The findings this roast was asked about, by id. */
  readonly selectedById: ReadonlyMap<string, Finding>;
  /** The evidence sent to the model, for the measurement check. */
  readonly evidence: JsonValue;
}

/**
 * Check a roast.
 *
 * @returns every violation found. An empty array means it may be shown.
 */
export function verifyRoast(input: RoastVerificationInput): Violation[] {
  const violations: Violation[] = [];

  input.draft.lines.forEach((line, index) => {
    if (!input.selectedById.has(line.findingId)) {
      violations.push({
        kind: "unknown_finding",
        location: `lines[${index}].findingId`,
        detail:
          "The roast is about a finding it was not given. It may not choose its own subject.",
        excerpt: previewText(line.findingId, 120),
      });
    }
  });

  violations.push(...checkAbuse(input.draft));
  violations.push(...checkRepetition(input.draft));

  // Phase 14's checks: invented measurements, security assurances, ranking
  // promises. One copy of those phrase lists, used by both phases (ADR-055).
  violations.push(
    ...checkProse(
      input.draft.lines.map((line, index) => ({
        location: `lines[${index}].punchline`,
        text: line.punchline,
      })),
      input.evidence,
    ),
  );

  return violations;
}

function checkAbuse(draft: RoastDraft): Violation[] {
  const violations: Violation[] = [];

  draft.lines.forEach((line, index) => {
    const location = `lines[${index}].punchline`;
    const words = new Set(
      line.punchline
        .toLowerCase()
        .split(/[^a-z'-]+/)
        .filter((word) => word.length > 0),
    );
    const normalised = line.punchline.toLowerCase();

    for (const insult of PERSONAL_INSULTS) {
      const matched = insult.includes(" ")
        ? normalised.includes(insult)
        : words.has(insult);

      if (!matched) continue;

      violations.push({
        kind: "abusive_tone",
        location,
        detail: `"${insult}" attacks a person rather than the website (ADR-015).`,
        excerpt: previewText(line.punchline, 160),
      });
    }

    for (const pattern of PERSONAL_ATTACK_PATTERNS) {
      if (!pattern.test(line.punchline)) continue;

      violations.push({
        kind: "abusive_tone",
        location,
        detail: "The line is aimed at a person rather than at the page (ADR-015).",
        excerpt: previewText(line.punchline, 160),
      });
    }
  });

  return violations;
}

function checkRepetition(draft: RoastDraft): Violation[] {
  const seen = new Set<string>();
  const violations: Violation[] = [];

  draft.lines.forEach((line, index) => {
    const key = line.punchline.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (seen.has(key)) {
      violations.push({
        kind: "repeated_punchline",
        location: `lines[${index}].punchline`,
        detail: "The same joke appears more than once.",
        excerpt: previewText(line.punchline, 160),
      });
    }

    seen.add(key);
  });

  return violations;
}

/** The lists, exported so tests can assert every entry is enforced. */
export const ABUSE_PATTERNS = {
  personalInsults: PERSONAL_INSULTS,
  personalAttacks: PERSONAL_ATTACK_PATTERNS,
} as const;
