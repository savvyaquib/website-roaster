/**
 * HTTP analyzer result types.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 2, docs/DECISIONS.md ADR-035.
 *
 * The analyzer either produces a complete response or an explicit failure.
 * A 404 or a 503 is a *successful fetch* carrying an error status — that is an
 * observation about the site, not a failure of ours, and it is reported as
 * data (ADR-021).
 */

import type { AnalysisStatus } from "@/lib/types/analysis";

/** Why the analyzer could not obtain a response. */
export const HTTP_FAILURE_CODES = [
  /** The submitted URL failed Phase 1 validation. */
  "invalid_url",
  /** The URL or its resolved address is one we refuse to contact. */
  "blocked",
  /** A redirect pointed somewhere we refuse to follow. */
  "blocked_redirect",
  /** The hostname does not resolve. */
  "dns_failure",
  /** Nothing is listening, or the connection was actively refused. */
  "connection_refused",
  /** The connection was established and then dropped. */
  "connection_reset",
  /** TLS negotiation failed, e.g. an expired or untrusted certificate. */
  "tls_error",
  /** The time budget was exhausted. */
  "timeout",
  /** More redirects than we are willing to follow. */
  "too_many_redirects",
  /** The redirect chain revisited a URL. */
  "redirect_loop",
  /** A redirect had no usable `Location`. */
  "invalid_redirect",
  /** The body exceeded the size budget. */
  "response_too_large",
  /** Anything else at the network layer. */
  "network_error",
] as const;

export type HttpFailureCode = (typeof HTTP_FAILURE_CODES)[number];

/** One hop in a redirect chain. */
export interface RedirectHop {
  /** The URL that was requested. */
  readonly url: string;
  readonly status: number;
  /** The absolute URL the `Location` header resolved to. */
  readonly location: string;
  readonly elapsedMs: number;
}

/**
 * Phase timings for the final request, in milliseconds.
 *
 * A phase is `null` when it did not occur or could not be observed — a plain
 * HTTP request has no TLS phase, and a cached DNS answer produces no lookup
 * event. `null` means "not measured", never "zero" (ADR-021).
 */
export interface HttpTiming {
  readonly dnsMs: number | null;
  readonly connectMs: number | null;
  readonly tlsMs: number | null;
  /** Request sent to first byte of the response. */
  readonly ttfbMs: number | null;
  /** First byte to last byte of the body. */
  readonly downloadMs: number | null;
  /** Start of the final request to its completion. */
  readonly totalMs: number;
}

/**
 * Response headers, lowercased. Repeated headers are joined with `, `.
 *
 * `set-cookie` is excluded and reported separately: it is the one header where
 * joining is lossy, because a cookie value may itself contain a comma.
 */
export type HttpHeaders = Readonly<Record<string, string>>;

export interface HttpResponseData {
  /** The URL actually requested last, after following redirects. */
  readonly finalUrl: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: HttpHeaders;
  /**
   * Raw `Set-Cookie` values, one entry per cookie.
   *
   * Kept separate from `headers` so Phase 6 can inspect each cookie's
   * attributes without having to unpick a joined string.
   */
  readonly setCookie: readonly string[];
  /** Media type only, lowercased, e.g. `text/html`. Null if not declared. */
  readonly contentType: string | null;
  /** Charset from the Content-Type header, lowercased. Null if not declared. */
  readonly charset: string | null;
  /** Whether the body was treated as HTML and therefore downloaded. */
  readonly isHtml: boolean;
  /**
   * The decoded body, or `null` when it was not downloaded.
   *
   * Non-HTML bodies are deliberately not downloaded: the analyzer has no use
   * for the bytes of a PDF or a video, and streaming one would waste the size
   * budget. `contentLength` still reports what the server declared.
   */
  readonly html: string | null;
  /** `Content-Length` as declared by the server. Null if absent or unparseable. */
  readonly contentLength: number | null;
  /** Bytes actually received on the wire. Null when the body was not read. */
  readonly transferredBytes: number | null;
  /** Bytes after decompression. Equals `transferredBytes` when not compressed. */
  readonly decodedBytes: number | null;
  /** The `Content-Encoding` applied by the server, lowercased, if any. */
  readonly contentEncoding: string | null;
  /** Redirects followed to reach `finalUrl`. Empty when there were none. */
  readonly redirects: readonly RedirectHop[];
  readonly timing: HttpTiming;
  /** Wall-clock time for the whole chain, including every redirect. */
  readonly totalElapsedMs: number;
}

export interface HttpFailure {
  readonly code: HttpFailureCode;
  /** Explanation suitable for showing to the person who submitted the URL. */
  readonly message: string;
  /** Redirects followed before the failure. */
  readonly redirects: readonly RedirectHop[];
  /** Status of the final response, when the failure happened after headers. */
  readonly status: number | null;
  readonly totalElapsedMs: number;
}

export type HttpFetchResult =
  | { readonly ok: true; readonly response: HttpResponseData }
  | { readonly ok: false; readonly failure: HttpFailure };

/**
 * Map a fetch failure to the analysis job state it should produce (ADR-011).
 *
 * Mirrors `analysisStatusForRejection` in the URL layer: a timeout, a refusal
 * and a network error are three different outcomes and must not collapse.
 */
export function analysisStatusForHttpFailure(
  code: HttpFailureCode,
): Extract<AnalysisStatus, "failed" | "timeout" | "blocked" | "invalid_url"> {
  switch (code) {
    case "invalid_url":
      return "invalid_url";
    case "blocked":
    case "blocked_redirect":
      return "blocked";
    case "timeout":
      return "timeout";
    default:
      return "failed";
  }
}
