/**
 * The provider abstraction.
 *
 * Source of truth: docs/DECISIONS.md ADR-003, ADR-004, ADR-014, ADR-016,
 * ADR-034, ADR-054.
 *
 * ## The whole interface is one method
 *
 * `AiProvider.generate` takes structured evidence and a schema, and returns
 * either data matching that schema or a normalized error. Everything a vendor
 * does differently — endpoint shape, auth, error bodies, how it is asked for
 * JSON — lives behind it in `providers/`, and nothing else in the application
 * imports from there (ADR-004). There is a test asserting that.
 *
 * ## Failure is a value, not an exception
 *
 * `generate` returns `AiResult<T>` rather than throwing. ADR-016 requires the
 * deterministic report to survive any AI failure, and a discriminated result
 * makes that a compile-time obligation: a caller cannot read `.data` without
 * having checked `.ok` first. A forgotten try/catch would have been a silent
 * hole in exactly the guarantee that matters most.
 *
 * ## The schema is the authority, not the provider
 *
 * A request carries both a JSON Schema — data, which an adapter may hand to a
 * vendor's native structured-output mode — and a `parse` function, which is
 * always run on whatever comes back. A provider that claims to enforce a schema
 * is not trusted to have done it, and a provider with no such mode still works.
 */

import type { AiError } from "./errors";

// ---------------------------------------------------------------------------
// Structured input
// ---------------------------------------------------------------------------

/** Anything that survives `JSON.stringify` unchanged. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * A screenshot, by value.
 *
 * ADR-034: there is no artifact store before Phase 16, so images travel inline
 * rather than by URL. A provider that cannot accept an image by value cannot
 * implement this interface.
 */
export interface AiImage {
  /** e.g. `image/png`. */
  readonly mimeType: string;
  /** Base64, without a `data:` prefix. */
  readonly dataBase64: string;
  /** What this shows, e.g. `desktop viewport`. Sent to the model as context. */
  readonly label: string;
}

/**
 * A vendor-neutral description of the expected answer.
 *
 * A deliberately small subset of JSON Schema: enough for the object-of-fields
 * and array-of-objects shapes Phase 14 needs, and small enough that every
 * provider's native structured-output mode can express it.
 */
export interface JsonSchema {
  readonly type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly string[];
  readonly nullable?: boolean;
}

export type SchemaParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * The expected answer, and how to check it.
 *
 * `parse` is the authority. It runs on every response, whether or not the
 * provider was also given `jsonSchema`.
 */
export interface ResponseSchema<T> {
  /** Stable name, used in logs and error messages. */
  readonly name: string;
  readonly jsonSchema: JsonSchema;
  parse(value: unknown): SchemaParseResult<T>;
}

/**
 * One request to a model.
 *
 * `evidence` is the normalized evidence ADR-014 permits — findings, scores,
 * metrics, extracted copy. It is serialised to JSON and sent as text. Nothing
 * here reaches for application state, secrets or internal network details, and
 * the type makes that difficult: `JsonValue` cannot carry a live object.
 */
export interface AiRequest<T> {
  /** Stable task name, e.g. `summary`. Appears in logs, never sent verbatim. */
  readonly task: string;
  /** What the model is being asked to do. */
  readonly instruction: string;
  /** The evidence it may reason from, and only this (ADR-003, ADR-014). */
  readonly evidence: JsonValue;
  readonly images?: readonly AiImage[];
  readonly schema: ResponseSchema<T>;
  readonly maxOutputTokens?: number;
  /** 0 unless a caller has a reason. Interpretation should be reproducible. */
  readonly temperature?: number;
}

/** Per-call overrides. */
export interface AiCallOptions {
  /** Overrides the provider's configured timeout. */
  readonly timeoutMs?: number;
  /** Caller's own cancellation, combined with the timeout rather than replacing it. */
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Structured output
// ---------------------------------------------------------------------------

/** What a call cost and how it ended. Null where a provider does not report it. */
export interface AiUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface AiResponseMeta {
  readonly provider: string;
  readonly model: string;
  readonly task: string;
  readonly latencyMs: number;
  readonly usage: AiUsage;
  /** The provider's own word for why generation stopped, verbatim. */
  readonly finishReason: string | null;
}

export type AiResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: AiResponseMeta }
  | { readonly ok: false; readonly error: AiError; readonly meta: AiResponseMeta };

/**
 * A configured model, ready to be asked something.
 *
 * Implementations live in `providers/`. Nothing outside that directory
 * constructs one directly — `resolveAiProvider` does (ADR-004).
 */
export interface AiProvider {
  /** Vendor identifier, e.g. `gemini`. */
  readonly name: string;
  /** The configured model identifier, verbatim. */
  readonly model: string;
  generate<T>(request: AiRequest<T>, options?: AiCallOptions): Promise<AiResult<T>>;
}

/** The shape of `fetch` an adapter needs. Injectable, so tests do no network. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<Response>;
