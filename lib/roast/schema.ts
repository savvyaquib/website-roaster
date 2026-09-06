/**
 * The roast answer's shape.
 *
 * Source of truth: ADR-054, ADR-056.
 *
 * Shape only; whether the jokes are acceptable is `verify.ts`'s question. The
 * `parse` here is the authority whatever the provider claimed to enforce.
 */

import type { JsonSchema, ResponseSchema, SchemaParseResult } from "@/lib/ai/types";

import type { DraftRoastLine, RoastDraft } from "./types";

/** Roughly thirty words. A roast line that runs longer is not a roast line. */
export const MAX_PUNCHLINE_LENGTH = 240;
export const MAX_LINES = 8;

const jsonSchema: JsonSchema = {
  type: "object",
  description: "A short roast, one punchline per supplied finding.",
  required: ["lines"],
  properties: {
    lines: {
      type: "array",
      description: "One entry per finding, in the order the findings were given.",
      items: {
        type: "object",
        required: ["findingId", "punchline"],
        properties: {
          findingId: {
            type: "string",
            description: "The id of the finding this line is about.",
          },
          punchline: {
            type: "string",
            description:
              "The joke. One or two sentences. Does not restate the observation.",
          },
        },
      },
    },
  },
};

function parseDraft(value: unknown): SchemaParseResult<RoastDraft> {
  const issues: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issues: ["The response must be an object."] };
  }

  const raw = (value as Record<string, unknown>).lines;

  if (!Array.isArray(raw)) {
    return { ok: false, issues: ["lines must be an array."] };
  }

  if (raw.length > MAX_LINES) {
    return {
      ok: false,
      issues: [`lines has ${raw.length} entries; the maximum is ${MAX_LINES}.`],
    };
  }

  const lines: DraftRoastLine[] = [];

  raw.forEach((entry, index) => {
    const location = `lines[${index}]`;

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      issues.push(`${location} must be an object.`);
      return;
    }

    const item = entry as Record<string, unknown>;

    if (typeof item.findingId !== "string" || item.findingId.trim().length === 0) {
      issues.push(`${location}.findingId must be a non-empty string.`);
      return;
    }

    if (typeof item.punchline !== "string") {
      issues.push(`${location}.punchline must be a string.`);
      return;
    }

    const punchline = item.punchline.trim();

    if (punchline.length === 0) {
      issues.push(`${location}.punchline must not be empty.`);
      return;
    }

    if (punchline.length > MAX_PUNCHLINE_LENGTH) {
      issues.push(
        `${location}.punchline is ${punchline.length} characters; the maximum is ${MAX_PUNCHLINE_LENGTH}.`,
      );
      return;
    }

    lines.push({ findingId: item.findingId.trim(), punchline });
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { lines } };
}

export const roastSchema: ResponseSchema<RoastDraft> = {
  name: "roast",
  jsonSchema,
  parse: parseDraft,
};
