/**
 * Structured API errors.
 *
 * Source of truth: CLAUDE.md § API DESIGN and § ERROR HANDLING, ADR-021,
 * ADR-057.
 *
 * ## Every error is the same shape
 *
 * ```json
 * { "error": { "code": "invalid_url", "message": "…", "details": { … } } }
 * ```
 *
 * `code` is stable and machine-readable; clients branch on it. `message` is
 * plain language written for the person who submitted the URL. `details` is
 * optional and carries only what a client can act on — never a stack trace,
 * never a file path, never anything from the environment.
 *
 * ## Nothing internal escapes
 *
 * `internal_error` deliberately carries no detail. An unexpected exception is
 * logged in full on the server and reported to the client as one sentence:
 * whatever is in an unexpected error message is by definition something nobody
 * decided was safe to publish (CLAUDE.md § SECURITY RULES).
 */

/** Machine-readable error codes. Clients branch on these, never on prose. */
export const API_ERROR_CODES = [
  /** The body was not valid JSON. */
  "invalid_json",
  /** The body was JSON but not the shape this endpoint accepts. */
  "invalid_body",
  /** The body was larger than this endpoint accepts. */
  "payload_too_large",
  /** The submitted URL is not a usable public HTTP(S) URL. */
  "invalid_url",
  /** The submitted URL resolves somewhere this application will not go. */
  "blocked",
  /** No job with that id. Also returned for a malformed id — see below. */
  "not_found",
  /** Something failed that nobody planned for. */
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** The HTTP status each code is reported with. */
export const STATUS_FOR_CODE: Readonly<Record<ApiErrorCode, number>> = {
  invalid_json: 400,
  invalid_body: 400,
  payload_too_large: 413,
  invalid_url: 400,
  blocked: 403,
  not_found: 404,
  internal_error: 500,
};

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, string | number | boolean>>;
  };
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): ApiErrorBody {
  return {
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
}

/**
 * The message shown for an unexpected failure.
 *
 * One sentence, the same every time. The real cause goes to the log with a
 * correlation id, not to the client.
 */
export const INTERNAL_ERROR_MESSAGE =
  "Something went wrong while handling this request. The failure has been logged.";
