/**
 * Reading structured output back from a model.
 *
 * Source of truth: ADR-054.
 *
 * ## Why this is not just `JSON.parse`
 *
 * Models asked for JSON return JSON *most* of the time. The rest of the time
 * they wrap it in a ``` fence, introduce it with a sentence, append a helpful
 * note afterwards, or stop mid-object because they hit the output limit. All of
 * that is normal behaviour, not an outage, and none of it should reach a caller
 * as an unhandled exception.
 *
 * So: extract the most likely JSON value from the text, parse it, then hand it
 * to the schema — which is the authority on whether it is actually usable. Every
 * failure along the way becomes `malformed_output` with the offending text
 * preserved, truncated, as evidence.
 *
 * Pure. No network, no clock, no provider knowledge.
 */

import type { JsonValue, ResponseSchema, SchemaParseResult } from "./types";

export type JsonExtraction =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * Convert a value into evidence an `AiRequest` will accept.
 *
 * TypeScript will not assign an interface to `JsonValue` — an interface has no
 * implicit index signature — so a `ScoreReport` or a `Finding[]` cannot be
 * passed as evidence directly, however JSON-shaped it is. This is the bridge.
 *
 * It is not only a cast. Round-tripping through JSON is what makes ADR-014's
 * boundary real rather than declared: functions, class instances, getters,
 * prototypes and cycles do not survive it, so whatever reaches a provider is
 * inert data and nothing else. A live object cannot be smuggled to a model by
 * way of a field nobody looked at.
 *
 * @throws {TypeError} if the value cannot be serialised, e.g. it has a cycle.
 */
export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

/** Fence markers a model may wrap a code block in. */
const FENCE = "```";

/**
 * Pull a JSON value out of whatever the model said.
 *
 * Tries, in order: the whole trimmed text; the contents of the first fenced
 * block; the first balanced `{...}` or `[...]` span found in the text.
 */
export function extractJson(text: string): JsonExtraction {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "The model returned an empty response." };
  }

  for (const candidate of candidates(trimmed)) {
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
      // Try the next candidate. The reason reported below describes the text as
      // a whole, which is more useful than the last parser message.
    }
  }

  return {
    ok: false,
    reason: "The response did not contain a JSON value that could be parsed.",
  };
}

/** Candidate substrings to try parsing, most likely first. */
function* candidates(text: string): Generator<string> {
  yield text;

  const fenced = fencedBlock(text);
  if (fenced !== null) yield fenced;

  const balanced = balancedSpan(fenced ?? text);
  if (balanced !== null) yield balanced;
}

/**
 * The contents of the first fenced code block.
 *
 * Handles ``` and ```json alike: everything up to the end of the opening line
 * is the language tag and is dropped.
 */
function fencedBlock(text: string): string | null {
  const start = text.indexOf(FENCE);
  if (start === -1) return null;

  const afterFence = start + FENCE.length;
  const lineEnd = text.indexOf("\n", afterFence);
  if (lineEnd === -1) return null;

  const end = text.indexOf(FENCE, lineEnd);
  const body = end === -1 ? text.slice(lineEnd + 1) : text.slice(lineEnd + 1, end);

  const trimmed = body.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The first balanced object or array in the text.
 *
 * Scans character by character, tracking string state and escapes, so a brace
 * inside a string value does not end the span. Returns null if nothing closes,
 * which is what a truncated response looks like.
 */
function balancedSpan(text: string): string | null {
  const openIndex = firstOpener(text);
  if (openIndex === -1) return null;

  const opener = text[openIndex];
  const closer = opener === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === opener) depth += 1;
    else if (character === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, index + 1);
    }
  }

  return null;
}

function firstOpener(text: string): number {
  const brace = text.indexOf("{");
  const bracket = text.indexOf("[");

  if (brace === -1) return bracket;
  if (bracket === -1) return brace;

  return Math.min(brace, bracket);
}

/**
 * Read a model's text as a value matching `schema`.
 *
 * The schema's `parse` is always run, whatever the provider claimed about
 * enforcing structure.
 */
export function parseStructuredOutput<T>(
  text: string,
  schema: ResponseSchema<T>,
): SchemaParseResult<T> {
  const extracted = extractJson(text);

  if (!extracted.ok) {
    return { ok: false, issues: [extracted.reason] };
  }

  return schema.parse(extracted.value);
}
