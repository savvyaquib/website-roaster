/**
 * The response schema.
 *
 * Source of truth: ADR-054, ADR-055.
 *
 * Shape only. Whether the model's *claims* stand up is `verify.ts`'s question,
 * and keeping the two apart is what lets an error say "the answer was the wrong
 * shape" or "the answer referenced a finding that does not exist" rather than
 * one vague message covering both.
 *
 * The `parse` here is the authority on structure, whatever the provider's own
 * structured-output mode claims to have enforced (ADR-054).
 */

import type { JsonSchema, ResponseSchema, SchemaParseResult } from "@/lib/ai/types";

import type { DraftProblem, DraftStrength, InterpretationDraft } from "./types";

/** Bounds, so a runaway answer cannot become the report. */
export const MAX_SUMMARY_LENGTH = 1200;
export const MAX_FIELD_LENGTH = 800;
export const MAX_PROBLEMS = 12;
export const MAX_STRENGTHS = 8;

const jsonSchema: JsonSchema = {
  type: "object",
  description: "An interpretation of a website analysis.",
  required: ["executiveSummary", "strengths", "problems"],
  properties: {
    executiveSummary: {
      type: "string",
      description: "Where this page stands and what deserves attention. About 80 words.",
    },
    strengths: {
      type: "array",
      description: "Things the page genuinely does well. May be empty.",
      items: {
        type: "object",
        required: ["findingId", "whyItHelps"],
        properties: {
          findingId: {
            type: "string",
            description: "The id of a passing finding from the evidence.",
          },
          whyItHelps: { type: "string", description: "One or two sentences." },
        },
      },
    },
    problems: {
      type: "array",
      description: "Highest-priority problems, most important first.",
      items: {
        type: "object",
        required: ["findingId", "whyItMatters", "recommendation"],
        properties: {
          findingId: {
            type: "string",
            description: "The id of a failing or warning finding from the evidence.",
          },
          whyItMatters: {
            type: "string",
            description: "Why this matters to this site's visitors or owner.",
          },
          recommendation: {
            type: "string",
            description: "One specific action someone could take.",
          },
        },
      },
    },
  },
};

function readString(
  source: Record<string, unknown>,
  key: string,
  location: string,
  maxLength: number,
  issues: string[],
): string | null {
  const value = source[key];

  if (typeof value !== "string") {
    issues.push(`${location}.${key} must be a string.`);
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    issues.push(`${location}.${key} must not be empty.`);
    return null;
  }

  if (trimmed.length > maxLength) {
    issues.push(`${location}.${key} is longer than ${maxLength} characters.`);
    return null;
  }

  return trimmed;
}

function readArray(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
  issues: string[],
): unknown[] | null {
  const value = source[key];

  if (!Array.isArray(value)) {
    issues.push(`${key} must be an array.`);
    return null;
  }

  if (value.length > maxLength) {
    issues.push(`${key} has ${value.length} entries; the maximum is ${maxLength}.`);
    return null;
  }

  return value;
}

function readObject(value: unknown, location: string, issues: string[]) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(`${location} must be an object.`);
    return null;
  }

  return value as Record<string, unknown>;
}

function parseDraft(value: unknown): SchemaParseResult<InterpretationDraft> {
  const issues: string[] = [];
  const root = readObject(value, "the response", issues);

  if (root === null) return { ok: false, issues };

  const executiveSummary = readString(
    root,
    "executiveSummary",
    "the response",
    MAX_SUMMARY_LENGTH,
    issues,
  );

  const rawStrengths = readArray(root, "strengths", MAX_STRENGTHS, issues);
  const rawProblems = readArray(root, "problems", MAX_PROBLEMS, issues);

  const strengths: DraftStrength[] = [];
  const problems: DraftProblem[] = [];

  for (const [index, entry] of (rawStrengths ?? []).entries()) {
    const location = `strengths[${index}]`;
    const item = readObject(entry, location, issues);
    if (item === null) continue;

    const findingId = readString(item, "findingId", location, 200, issues);
    const whyItHelps = readString(item, "whyItHelps", location, MAX_FIELD_LENGTH, issues);

    if (findingId !== null && whyItHelps !== null)
      strengths.push({ findingId, whyItHelps });
  }

  for (const [index, entry] of (rawProblems ?? []).entries()) {
    const location = `problems[${index}]`;
    const item = readObject(entry, location, issues);
    if (item === null) continue;

    const findingId = readString(item, "findingId", location, 200, issues);
    const whyItMatters = readString(
      item,
      "whyItMatters",
      location,
      MAX_FIELD_LENGTH,
      issues,
    );
    const recommendation = readString(
      item,
      "recommendation",
      location,
      MAX_FIELD_LENGTH,
      issues,
    );

    if (findingId !== null && whyItMatters !== null && recommendation !== null) {
      problems.push({ findingId, whyItMatters, recommendation });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  if (executiveSummary === null) return { ok: false, issues: ["No executive summary."] };

  return { ok: true, value: { executiveSummary, strengths, problems } };
}

/** The schema for an interpretation answer. */
export const interpretationSchema: ResponseSchema<InterpretationDraft> = {
  name: "interpretation",
  jsonSchema,
  parse: parseDraft,
};
