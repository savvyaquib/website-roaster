/**
 * The Gemini adapter.
 *
 * Source of truth: docs/DECISIONS.md ADR-004, ADR-018, ADR-034, ADR-054.
 *
 * **This is the only file in the application that knows how Gemini works.**
 * Endpoint shape, auth header, request body, error bodies, finish reasons and
 * usage fields are all confined here, and a test asserts no module outside
 * `lib/ai/providers/` mentions a vendor by name (ADR-004). Replacing the vendor
 * means adding a sibling file and changing one environment variable.
 *
 * ## The key goes in a header, not the query string
 *
 * Gemini accepts `?key=`, and that is how most examples show it. This adapter
 * uses the `x-goog-api-key` header instead, because a key in a URL ends up in
 * error messages, stack traces, proxy logs and anything that records a request
 * line. A header keeps it out of all of them (ADR-018), and `redactSecrets`
 * covers what is left.
 *
 * ## Not verified against the live API
 *
 * The wire format here is implemented from the documented v1beta
 * `generateContent` shape and is exercised only against a fake `fetch`. No call
 * has been made to Google's servers, because that needs a key this repository
 * does not have. The first real call may need adjustment — see ADR-054.
 */

import { AiError, previewText, redactSecrets } from "../errors";
import { parseStructuredOutput } from "../json";
import type {
  AiCallOptions,
  AiImage,
  AiProvider,
  AiRequest,
  AiResult,
  AiUsage,
  FetchLike,
  JsonSchema,
} from "../types";

export const GEMINI_PROVIDER_NAME = "gemini";

/**
 * The default model.
 *
 * A current, multimodal, free-tier-eligible model, which is what ADR-034
 * requires. Overridable with `AI_MODEL`, because model names change faster than
 * code does.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Injectable so tests never touch the network. */
  readonly fetchImpl?: FetchLike;
  /** Injectable so latency is deterministic in tests. */
  readonly now?: () => number;
}

/** Gemini's response, as much of it as this adapter reads. */
interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
    readonly finishReason?: string;
  }[];
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly totalTokenCount?: number;
  };
  readonly error?: { readonly message?: string; readonly status?: string };
}

/**
 * Build a Gemini-backed provider.
 *
 * Constructing one performs no I/O and validates nothing remotely: a bad key is
 * discovered on the first call, as a normalized `authentication_failed`.
 */
export function createGeminiProvider(options: GeminiProviderOptions): AiProvider {
  const {
    apiKey,
    model = DEFAULT_GEMINI_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch as unknown as FetchLike,
    now = Date.now,
  } = options;

  async function generate<T>(
    request: AiRequest<T>,
    callOptions: AiCallOptions = {},
  ): Promise<AiResult<T>> {
    const startedAt = now();
    const effectiveTimeout = callOptions.timeoutMs ?? timeoutMs;

    const meta = (finishReason: string | null, usage: AiUsage) => ({
      provider: GEMINI_PROVIDER_NAME,
      model,
      task: request.task,
      latencyMs: now() - startedAt,
      usage,
      finishReason,
    });

    const fail = (error: AiError): AiResult<T> => ({
      ok: false,
      error,
      meta: meta(null, emptyUsage()),
    });

    // The caller's cancellation and our deadline both apply; whichever fires
    // first wins, and they are distinguished afterwards so a user-initiated
    // abort is not reported as a provider timeout.
    const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
    const signal =
      callOptions.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([timeoutSignal, callOptions.signal]);

    let response: Response;

    try {
      response = await fetchImpl(`${baseUrl}/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Not `?key=` — see the module comment.
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(buildRequestBody(request)),
        signal,
      });
    } catch (cause) {
      return fail(networkError(cause, callOptions.signal, effectiveTimeout, apiKey));
    }

    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      return fail(httpError(response.status, bodyText, apiKey));
    }

    let parsed: GeminiResponse;

    try {
      parsed = JSON.parse(bodyText) as GeminiResponse;
    } catch (cause) {
      return fail(
        new AiError({
          code: "provider_unavailable",
          provider: GEMINI_PROVIDER_NAME,
          message: "The provider returned a response that was not JSON.",
          status: response.status,
          rawPreview: previewText(redactSecrets(bodyText, [apiKey])),
          cause,
        }),
      );
    }

    const usage = readUsage(parsed);
    const blockReason = parsed.promptFeedback?.blockReason;

    if (blockReason !== undefined) {
      return {
        ok: false,
        error: new AiError({
          code: "content_filtered",
          provider: GEMINI_PROVIDER_NAME,
          message: `The provider blocked this request (${blockReason}).`,
        }),
        meta: meta(blockReason, usage),
      };
    }

    const candidate = parsed.candidates?.[0];
    const finishReason = candidate?.finishReason ?? null;
    const text = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");

    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
      return {
        ok: false,
        error: new AiError({
          code: "content_filtered",
          provider: GEMINI_PROVIDER_NAME,
          message: `The provider stopped generating for safety reasons (${finishReason}).`,
        }),
        meta: meta(finishReason, usage),
      };
    }

    if (finishReason === "MAX_TOKENS") {
      // Reported as truncation rather than as malformed output: the model did
      // what was asked and ran out of room, which is a different fix.
      return {
        ok: false,
        error: new AiError({
          code: "response_truncated",
          provider: GEMINI_PROVIDER_NAME,
          message: "The model reached its output limit before finishing.",
          rawPreview: previewText(text),
        }),
        meta: meta(finishReason, usage),
      };
    }

    if (text.trim().length === 0) {
      return {
        ok: false,
        error: new AiError({
          code: "malformed_output",
          provider: GEMINI_PROVIDER_NAME,
          message: "The provider returned no text content.",
          issues: ["The response contained no candidate text."],
        }),
        meta: meta(finishReason, usage),
      };
    }

    const validated = parseStructuredOutput(text, request.schema);

    if (!validated.ok) {
      return {
        ok: false,
        error: new AiError({
          code: "malformed_output",
          provider: GEMINI_PROVIDER_NAME,
          message: `The model's answer did not match the expected "${request.schema.name}" structure.`,
          issues: validated.issues,
          rawPreview: previewText(text),
        }),
        meta: meta(finishReason, usage),
      };
    }

    return { ok: true, data: validated.value, meta: meta(finishReason, usage) };
  }

  return { name: GEMINI_PROVIDER_NAME, model, generate };
}

// ---------------------------------------------------------------------------
// Request shaping
// ---------------------------------------------------------------------------

function buildRequestBody<T>(request: AiRequest<T>): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [
    { text: buildEvidenceText(request) },
    ...(request.images ?? []).map(imagePart),
  ];

  return {
    systemInstruction: { parts: [{ text: request.instruction }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(request.schema.jsonSchema),
      // Interpretation should be reproducible unless a caller says otherwise.
      temperature: request.temperature ?? 0,
      ...(request.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: request.maxOutputTokens }),
    },
  };
}

/**
 * The evidence, as text.
 *
 * Serialised here rather than in the core so nothing assumes every provider
 * takes a single text part. The framing sentence is the one place the
 * "reason only from this" instruction is enforced on the wire (ADR-003).
 */
function buildEvidenceText<T>(request: AiRequest<T>): string {
  const images = request.images ?? [];

  const imageNote =
    images.length === 0
      ? ""
      : `\n\nAttached images, in order: ${images.map((image) => image.label).join(", ")}.`;

  return (
    "Here is the evidence collected about the page. " +
    "Reason only from this evidence; do not infer measurements that are not present.\n\n" +
    `${JSON.stringify(request.evidence, null, 2)}${imageNote}`
  );
}

function imagePart(image: AiImage): Record<string, unknown> {
  return { inlineData: { mimeType: image.mimeType, data: image.dataBase64 } };
}

/**
 * Our schema subset in Gemini's spelling.
 *
 * Gemini's `responseSchema` follows the OpenAPI 3.0 subset, whose `type` is an
 * upper-case enum. This is the whole of the translation, and the reason
 * `JsonSchema` stays vendor-neutral in `types.ts`.
 */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const translated: Record<string, unknown> = { type: schema.type.toUpperCase() };

  if (schema.description !== undefined) translated.description = schema.description;
  if (schema.nullable !== undefined) translated.nullable = schema.nullable;
  if (schema.enum !== undefined) translated.enum = [...schema.enum];
  if (schema.required !== undefined) translated.required = [...schema.required];
  if (schema.items !== undefined) translated.items = toGeminiSchema(schema.items);

  if (schema.properties !== undefined) {
    translated.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }

  return translated;
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

function networkError(
  cause: unknown,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
  apiKey: string,
): AiError {
  // A caller's own cancellation is not a provider failure, and saying so lets a
  // caller distinguish "the user navigated away" from "the model is slow".
  if (callerSignal?.aborted === true) {
    return new AiError({
      code: "aborted",
      provider: GEMINI_PROVIDER_NAME,
      message: "The request was cancelled by the caller.",
      cause,
    });
  }

  if (isAbortLike(cause)) {
    return new AiError({
      code: "timeout",
      provider: GEMINI_PROVIDER_NAME,
      message: `The provider did not respond within ${timeoutMs}ms.`,
      cause,
    });
  }

  return new AiError({
    code: "provider_unavailable",
    provider: GEMINI_PROVIDER_NAME,
    message: redactSecrets(
      `Could not reach the provider: ${describe(cause)}`,
      [apiKey],
    ),
    cause,
  });
}

function httpError(status: number, bodyText: string, apiKey: string): AiError {
  const detail = readErrorMessage(bodyText);
  const message = redactSecrets(
    detail === null ? `The provider returned HTTP ${status}.` : detail,
    [apiKey],
  );

  if (status === 401 || status === 403) {
    return new AiError({
      code: "authentication_failed",
      provider: GEMINI_PROVIDER_NAME,
      status,
      message: "The provider rejected the configured API key.",
    });
  }

  if (status === 429) {
    return new AiError({
      code: "rate_limited",
      provider: GEMINI_PROVIDER_NAME,
      status,
      message: "The provider is rate limiting requests.",
    });
  }

  if (status >= 500) {
    return new AiError({
      code: "provider_unavailable",
      provider: GEMINI_PROVIDER_NAME,
      status,
      message,
    });
  }

  return new AiError({
    code: "invalid_request",
    provider: GEMINI_PROVIDER_NAME,
    status,
    message,
  });
}

/** The vendor's own error message, when the body carries one. */
function readErrorMessage(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as GeminiResponse;
    const message = parsed.error?.message;
    return typeof message === "string" && message.length > 0 ? message : null;
  } catch {
    return null;
  }
}

function isAbortLike(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    (cause.name === "AbortError" || cause.name === "TimeoutError")
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function readUsage(response: GeminiResponse): AiUsage {
  const usage = response.usageMetadata;

  return {
    inputTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage?.candidatesTokenCount ?? null,
    totalTokens: usage?.totalTokenCount ?? null,
  };
}

function emptyUsage(): AiUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}
