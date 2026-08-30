/**
 * Phase 2 — Basic HTTP analyzer.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 2, docs/DECISIONS.md ADR-035.
 *
 * Retrieves a single public page and reports what was observed: final URL,
 * status, headers, content type, size, redirect chain, timings and — when the
 * response is HTML — the decoded body.
 *
 * ## Why `node:http` rather than `fetch`
 *
 * Three of this phase's requirements are not expressible through `fetch`:
 * pinning the connection to a pre-validated address (`lookup`), following
 * redirects manually so each hop can be re-validated, and aborting a response
 * mid-stream once it exceeds the size budget. `node:http` supports all three
 * and is already in the platform, so no dependency is added (ADR-023).
 *
 * ## Scope
 *
 * No rendering, no JavaScript execution, no Lighthouse, no parsing beyond the
 * headers — the body is returned as text and interpreted in Phase 4 onwards.
 */

import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import zlib from "node:zlib";

import { analysisStatusForRejection } from "@/lib/analysis/url";
import { createLogger, type Logger } from "@/lib/observability/logger";

import { BLOCKED_ADDRESS_ERROR_CODE, createPinnedLookup } from "./pinned-lookup";
import { publicHttpSecurityPolicy, type HttpSecurityPolicy } from "./policy";
import type {
  HttpFailureCode,
  HttpFetchResult,
  HttpHeaders,
  HttpResponseData,
  HttpTiming,
  RedirectHop,
} from "./types";

/** Total budget for the whole chain, including every redirect. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Applied to both the transferred and the decompressed body. */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export const DEFAULT_MAX_REDIRECTS = 5;

export const DEFAULT_USER_AGENT =
  "WebsiteRoaster/0.1 (automated website quality analysis)";

/** Media types whose body we download. Everything else is metadata-only. */
const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);

/** Statuses we follow, provided a usable `Location` is present. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Charset labels Node can decode directly.
 *
 * Anything else falls back to UTF-8, which is the correct guess for the
 * overwhelming majority of the modern web. A full encoding table is not worth a
 * dependency at this stage; if mis-decoding shows up in practice, revisit.
 */
const CHARSET_ALIASES: Readonly<Record<string, BufferEncoding>> = {
  "utf-8": "utf8",
  utf8: "utf8",
  "us-ascii": "latin1",
  "iso-8859-1": "latin1",
  latin1: "latin1",
  "windows-1252": "latin1",
  "utf-16le": "utf16le",
};

export interface FetchPageOptions {
  /** Total budget for the whole chain. Default 15s. */
  readonly timeoutMs?: number;
  /** Size budget, applied to transferred and decoded bytes. Default 5 MiB. */
  readonly maxBytes?: number;
  /** Default 5. */
  readonly maxRedirects?: number;
  readonly userAgent?: string;
  /** Default: public-internet-only. See policy.ts. */
  readonly policy?: HttpSecurityPolicy;
  readonly logger?: Logger;
  /**
   * Overrides DNS resolution and address pinning.
   *
   * Present so tests can reach a local server. Production callers must leave it
   * unset, which yields the pinned, policy-enforcing lookup.
   */
  readonly lookup?: LookupFunction;
}

/** What a single request turned into. */
type RequestOutcome =
  | { readonly kind: "response"; readonly response: SingleResponse }
  | {
      readonly kind: "redirect";
      readonly status: number;
      readonly location: string;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: "failure";
      readonly code: HttpFailureCode;
      readonly message: string;
      readonly status: number | null;
    };

interface SingleResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: HttpHeaders;
  readonly setCookie: readonly string[];
  readonly contentType: string | null;
  readonly charset: string | null;
  readonly isHtml: boolean;
  readonly html: string | null;
  readonly contentLength: number | null;
  readonly transferredBytes: number | null;
  readonly decodedBytes: number | null;
  readonly contentEncoding: string | null;
  readonly timing: HttpTiming;
}

/**
 * Fetch a page and report what was observed.
 *
 * Never throws for an expected condition. A 404, a timeout, a refused redirect
 * and an oversized body are all returned as values, because the caller has to
 * report each of them differently (ADR-021).
 */
export async function fetchPage(
  inputUrl: string,
  options: FetchPageOptions = {},
): Promise<HttpFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const policy = options.policy ?? publicHttpSecurityPolicy;
  const log = options.logger ?? createLogger("analysis.http");
  const lookup = options.lookup ?? createPinnedLookup(policy);

  const startedAt = Date.now();
  const redirects: RedirectHop[] = [];
  const elapsed = () => Date.now() - startedAt;

  function fail(
    code: HttpFailureCode,
    message: string,
    status: number | null = null,
  ): HttpFetchResult {
    log.warn("http.fetch.failed", { code, url: inputUrl, elapsedMs: elapsed() });
    return {
      ok: false,
      failure: { code, message, redirects, status, totalElapsedMs: elapsed() },
    };
  }

  const initial = policy.validateUrl(inputUrl);
  if (!initial.valid) {
    const code =
      analysisStatusForRejection(initial.code) === "invalid_url"
        ? "invalid_url"
        : "blocked";
    return fail(code, initial.reason);
  }

  let currentUrl = initial.normalizedUrl;
  const visited = new Set<string>([currentUrl]);

  log.info("http.fetch.started", { url: currentUrl });

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remainingMs = timeoutMs - elapsed();
    if (remainingMs <= 0) {
      return fail("timeout", `The site did not respond within ${timeoutMs}ms.`);
    }

    const outcome = await performRequest(currentUrl, {
      timeoutMs: remainingMs,
      maxBytes,
      userAgent,
      lookup,
    });

    if (outcome.kind === "failure") {
      return fail(outcome.code, outcome.message, outcome.status);
    }

    if (outcome.kind === "response") {
      log.info("http.fetch.completed", {
        url: currentUrl,
        status: outcome.response.status,
        redirects: redirects.length,
        elapsedMs: elapsed(),
      });

      return {
        ok: true,
        response: buildResponseData(
          currentUrl,
          outcome.response,
          redirects,
          elapsed(),
        ),
      };
    }

    // A redirect. Resolve it, re-validate it, and only then follow it.
    let target: string;
    try {
      target = new URL(outcome.location, currentUrl).href;
    } catch {
      return fail(
        "invalid_redirect",
        "The site redirected to an address that could not be understood.",
        outcome.status,
      );
    }

    const validated = policy.validateUrl(target);
    if (!validated.valid) {
      // The classic SSRF bypass: a public URL that redirects inward.
      log.warn("http.redirect.blocked", {
        from: currentUrl,
        code: validated.code,
      });
      return fail(
        "blocked_redirect",
        `The site redirected somewhere that cannot be analyzed. ${validated.reason}`,
        outcome.status,
      );
    }

    redirects.push({
      url: currentUrl,
      status: outcome.status,
      location: validated.normalizedUrl,
      elapsedMs: outcome.elapsedMs,
    });

    if (visited.has(validated.normalizedUrl)) {
      return fail("redirect_loop", "The site redirects in a loop.", outcome.status);
    }

    visited.add(validated.normalizedUrl);
    currentUrl = validated.normalizedUrl;

    log.debug("http.redirect.followed", { to: currentUrl, status: outcome.status });
  }

  return fail(
    "too_many_redirects",
    `The site redirected more than ${maxRedirects} times.`,
  );
}

interface RequestConfig {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly userAgent: string;
  readonly lookup: LookupFunction;
}

/**
 * Issue one request. Resolves with an outcome; never rejects.
 *
 * Written against the callback API rather than a promise wrapper because the
 * size cap has to abort the response mid-stream, which needs the raw handles.
 */
function performRequest(url: string, config: RequestConfig): Promise<RequestOutcome> {
  return new Promise((resolve) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;

    const t0 = Date.now();
    let tLookup: number | null = null;
    let tConnect: number | null = null;
    let tSecure: number | null = null;
    let tFirstByte: number | null = null;

    let settled = false;
    let timedOut = false;
    let sizeExceeded = false;
    let responseStatus: number | null = null;

    const request = transport.request(
      url,
      {
        method: "GET",
        lookup: config.lookup,
        // No connection pooling: each analysis gets a fresh, separately
        // validated connection, and timings are not skewed by a reused socket.
        agent: false,
        headers: {
          "user-agent": config.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en-US,en;q=0.9",
        },
      },
      handleResponse,
    );

    const timer = setTimeout(() => {
      timedOut = true;
      request.destroy();
    }, config.timeoutMs);

    function settle(outcome: RequestOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(outcome);
    }

    function failWith(code: HttpFailureCode, message: string): void {
      settle({ kind: "failure", code, message, status: responseStatus });
    }

    request.on("socket", (socket) => {
      socket.on("lookup", () => {
        tLookup = Date.now();
      });
      socket.on("connect", () => {
        tConnect = Date.now();
      });
      socket.on("secureConnect", () => {
        tSecure = Date.now();
      });
    });

    request.on("error", (error: NodeJS.ErrnoException) => {
      if (timedOut) {
        failWith("timeout", "The site took too long to respond.");
        return;
      }
      if (sizeExceeded) return; // already settled by the size guard
      failWith(...classifyRequestError(error));
    });

    request.end();

    function handleResponse(response: IncomingMessage): void {
      const status = response.statusCode ?? 0;
      responseStatus = status;
      tFirstByte = Date.now();

      const location = firstHeader(response.headers.location);
      if (REDIRECT_STATUSES.has(status) && location !== null) {
        response.destroy();
        settle({ kind: "redirect", status, location, elapsedMs: Date.now() - t0 });
        return;
      }

      const headers = normalizeHeaders(response);
      const setCookie = response.headers["set-cookie"] ?? [];
      const { mediaType, charset } = parseContentType(headers["content-type"]);
      const contentEncoding = headers["content-encoding"]?.toLowerCase() ?? null;
      const contentLength = parseContentLength(headers["content-length"]);
      const isHtml = mediaType !== null && HTML_MEDIA_TYPES.has(mediaType);

      const finish = (
        html: string | null,
        transferredBytes: number | null,
        decodedBytes: number | null,
      ): void => {
        settle({
          kind: "response",
          response: {
            status,
            statusText: response.statusMessage ?? "",
            headers,
            setCookie,
            contentType: mediaType,
            charset,
            isHtml,
            html,
            contentLength,
            transferredBytes,
            decodedBytes,
            contentEncoding,
            timing: buildTiming({
              t0,
              tLookup,
              tConnect,
              tSecure,
              tFirstByte,
              tEnd: Date.now(),
            }),
          },
        });
      };

      // Metadata only for non-HTML: downloading a video to measure it would
      // burn the whole size budget for nothing.
      if (!isHtml) {
        response.destroy();
        finish(null, null, null);
        return;
      }

      // Refuse before reading a byte when the server already told us it is
      // too big.
      if (contentLength !== null && contentLength > config.maxBytes) {
        response.destroy();
        failWith(
          "response_too_large",
          `The page is larger than ${config.maxBytes} bytes.`,
        );
        return;
      }

      let transferred = 0;
      let decoded = 0;
      const chunks: Buffer[] = [];

      const exceeded = (): void => {
        sizeExceeded = true;
        response.destroy();
        failWith(
          "response_too_large",
          `The page is larger than ${config.maxBytes} bytes.`,
        );
      };

      // Both listeners are attached in this tick, so no data escapes before
      // the stream starts flowing.
      response.on("data", (chunk: Buffer) => {
        transferred += chunk.length;
        if (transferred > config.maxBytes) exceeded();
      });

      const decoder = createDecoder(contentEncoding);
      const body = decoder === null ? response : response.pipe(decoder);

      if (decoder !== null) {
        decoder.on("error", () => {
          failWith("network_error", "The page could not be decompressed.");
        });
      }

      body.on("data", (chunk: Buffer) => {
        decoded += chunk.length;
        // Also the zip-bomb guard: a small transfer can decompress enormously.
        if (decoded > config.maxBytes) {
          exceeded();
          return;
        }
        chunks.push(chunk);
      });

      body.on("end", () => {
        if (settled) return;
        const encoding = resolveEncoding(charset);
        finish(Buffer.concat(chunks).toString(encoding), transferred, decoded);
      });

      response.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        if (timedOut) {
          failWith("timeout", "The site took too long to respond.");
          return;
        }
        failWith(...classifyRequestError(error));
      });
    }
  });
}

/** Map a Node network error onto an explicit, reportable failure. */
function classifyRequestError(
  error: NodeJS.ErrnoException,
): [HttpFailureCode, string] {
  const code = error.code ?? "";

  if (code === BLOCKED_ADDRESS_ERROR_CODE) {
    return ["blocked", "That address cannot be analyzed."];
  }

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return ["dns_failure", "That domain name could not be resolved."];
    case "ECONNREFUSED":
      return ["connection_refused", "The server refused the connection."];
    case "ECONNRESET":
    case "EPIPE":
      return ["connection_reset", "The connection was closed unexpectedly."];
    case "ETIMEDOUT":
    case "ESOCKETTIMEDOUT":
      return ["timeout", "The site took too long to respond."];
    case "EPROTO":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return ["tls_error", "The site's HTTPS certificate could not be verified."];
    default:
      return ["network_error", "The site could not be reached."];
  }
}

function createDecoder(contentEncoding: string | null): zlib.Gunzip | null {
  switch (contentEncoding) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Lowercased headers, arrays joined. `set-cookie` is reported separately. */
function normalizeHeaders(response: IncomingMessage): HttpHeaders {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(response.headers)) {
    if (value === undefined || key === "set-cookie") continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  return headers;
}

function parseContentType(value: string | undefined): {
  mediaType: string | null;
  charset: string | null;
} {
  if (value === undefined) return { mediaType: null, charset: null };

  const [type = "", ...parameters] = value.split(";");
  const mediaType = type.trim().toLowerCase() || null;

  let charset: string | null = null;
  for (const parameter of parameters) {
    const [name = "", raw = ""] = parameter.split("=");
    if (name.trim().toLowerCase() === "charset") {
      charset = raw.trim().toLowerCase().replace(/^"|"$/g, "") || null;
    }
  }

  return { mediaType, charset };
}

function parseContentLength(value: string | undefined): number | null {
  if (value === undefined) return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function resolveEncoding(charset: string | null): BufferEncoding {
  if (charset === null) return "utf8";
  return CHARSET_ALIASES[charset] ?? "utf8";
}

interface TimingMarks {
  readonly t0: number;
  readonly tLookup: number | null;
  readonly tConnect: number | null;
  readonly tSecure: number | null;
  readonly tFirstByte: number | null;
  readonly tEnd: number;
}

function buildTiming(marks: TimingMarks): HttpTiming {
  const { t0, tLookup, tConnect, tSecure, tFirstByte, tEnd } = marks;

  const connectStart = tLookup ?? t0;
  const requestStart = tSecure ?? tConnect ?? t0;

  return {
    dnsMs: tLookup === null ? null : tLookup - t0,
    connectMs: tConnect === null ? null : tConnect - connectStart,
    tlsMs: tSecure === null || tConnect === null ? null : tSecure - tConnect,
    ttfbMs: tFirstByte === null ? null : tFirstByte - requestStart,
    downloadMs: tFirstByte === null ? null : tEnd - tFirstByte,
    totalMs: tEnd - t0,
  };
}

function buildResponseData(
  finalUrl: string,
  response: SingleResponse,
  redirects: readonly RedirectHop[],
  totalElapsedMs: number,
): HttpResponseData {
  return {
    finalUrl,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    setCookie: response.setCookie,
    contentType: response.contentType,
    charset: response.charset,
    isHtml: response.isHtml,
    html: response.html,
    contentLength: response.contentLength,
    transferredBytes: response.transferredBytes,
    decodedBytes: response.decodedBytes,
    contentEncoding: response.contentEncoding,
    redirects,
    timing: response.timing,
    totalElapsedMs,
  };
}
