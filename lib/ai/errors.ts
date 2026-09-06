/**
 * The normalized AI failure vocabulary.
 *
 * Source of truth: docs/DECISIONS.md ADR-004, ADR-016, ADR-018, ADR-054.
 *
 * Every provider fails differently — HTTP status codes, vendor error bodies,
 * SDK exception types, network errors. Callers must not have to know any of
 * that, so an adapter's one job on the failure path is to turn whatever it saw
 * into one of these codes.
 *
 * ADR-016 requires that AI failure never breaks the deterministic report. That
 * is a property of how callers treat these errors, so `AiError` carries
 * `retryable` and a message written to be shown to a person, and the provider
 * interface returns failures rather than throwing them (see `types.ts`).
 */

/**
 * Why an AI call did not produce a usable answer.
 *
 * Deliberately small. A caller decides what to do from this code alone, without
 * inspecting a vendor's error body.
 */
export const AI_ERROR_CODES = [
  /** No provider is configured. Expected, and not a failure of anything. */
  "not_configured",
  /** The call exceeded its deadline. */
  "timeout",
  /** The caller aborted the call. */
  "aborted",
  /** The key was rejected. */
  "authentication_failed",
  /** Quota or rate limit. Retryable, later. */
  "rate_limited",
  /** The provider is down, unreachable, or returned 5xx. */
  "provider_unavailable",
  /** We sent something the provider refused. A bug on our side. */
  "invalid_request",
  /** The provider's safety systems blocked the prompt or the response. */
  "content_filtered",
  /** The model answered, but not with the structure that was asked for. */
  "malformed_output",
  /** The model hit its output limit mid-answer. */
  "response_truncated",
  /** Anything an adapter could not classify. */
  "unknown",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Codes worth trying again on, unchanged, later. */
const RETRYABLE: readonly AiErrorCode[] = [
  "timeout",
  "rate_limited",
  "provider_unavailable",
];

export interface AiErrorOptions {
  readonly code: AiErrorCode;
  readonly message: string;
  readonly provider: string;
  /** HTTP status, when the failure came from a response. */
  readonly status?: number;
  /** Validation issues, for `malformed_output`. */
  readonly issues?: readonly string[];
  /**
   * A short excerpt of what the model actually returned.
   *
   * Only set for `malformed_output`, where the text is the evidence. Truncated,
   * because a full response in an error is a log-flooding hazard.
   */
  readonly rawPreview?: string;
  readonly cause?: unknown;
}

/**
 * A normalized AI failure.
 *
 * Carries no secrets: adapters build messages through `redactSecrets` and the
 * API key is sent in a header rather than a URL, so it cannot arrive here by
 * way of a request line (ADR-018).
 */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly provider: string;
  readonly status: number | undefined;
  readonly issues: readonly string[];
  readonly rawPreview: string | undefined;
  readonly retryable: boolean;

  constructor(options: AiErrorOptions) {
    super(options.message, options.cause === undefined ? {} : { cause: options.cause });

    this.name = "AiError";
    this.code = options.code;
    this.provider = options.provider;
    this.status = options.status;
    this.issues = options.issues ?? [];
    this.rawPreview = options.rawPreview;
    this.retryable = RETRYABLE.includes(options.code);
  }

  /**
   * A sentence suitable for showing to the person who asked for the report.
   *
   * The deterministic report is always available, so every one of these says
   * what is missing rather than announcing a catastrophe.
   */
  get userMessage(): string {
    switch (this.code) {
      case "not_configured":
        return "AI interpretation is not configured, so this report contains the measured results only.";
      case "timeout":
      case "aborted":
        return "The AI interpretation took too long and was stopped. The measured results are unaffected.";
      case "rate_limited":
        return "The AI provider is rate limiting requests. The measured results are unaffected.";
      case "authentication_failed":
      case "invalid_request":
        return "The AI interpretation could not be requested because of a configuration problem. The measured results are unaffected.";
      case "provider_unavailable":
        return "The AI provider is currently unavailable. The measured results are unaffected.";
      case "content_filtered":
        return "The AI provider declined to interpret this page's content. The measured results are unaffected.";
      case "malformed_output":
      case "response_truncated":
        return "The AI interpretation could not be read and was discarded. The measured results are unaffected.";
      case "unknown":
        return "The AI interpretation failed. The measured results are unaffected.";
    }
  }

  /** Fields safe to log: no message body, no model output, no secrets. */
  toLogFields(): Readonly<Record<string, string | number | boolean>> {
    return {
      provider: this.provider,
      code: this.code,
      retryable: this.retryable,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.issues.length === 0 ? {} : { issueCount: this.issues.length }),
    };
  }
}

/**
 * Remove known secret values from a string.
 *
 * Defence in depth. Adapters send the key in a header rather than a query
 * string precisely so it cannot end up in a URL, a log line or an error — this
 * exists so that a vendor echoing something back cannot undo that.
 */
export function redactSecrets(
  text: string,
  secrets: readonly (string | undefined)[],
): string {
  let result = text;

  for (const secret of secrets) {
    // A very short value would match everywhere and redact the whole message.
    if (secret === undefined || secret.length < 8) continue;
    result = result.split(secret).join("[redacted]");
  }

  return result;
}

/** Shorten model output for use as error evidence. */
export function previewText(text: string, maxLength = 300): string {
  const collapsed = text.split(/\s+/).join(" ").trim();

  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 1)}…`;
}
