/**
 * URL validation result types.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 1, docs/DECISIONS.md ADR-035.
 */

import type { AnalysisStatus } from "@/lib/types/analysis";

/**
 * Why a URL was refused.
 *
 * The specification requires only a human-readable `reason`. A machine-readable
 * code is carried alongside it because ADR-011 defines two *different* terminal
 * job states for refusal — `invalid_url` and `blocked` — and the caller cannot
 * choose between them by pattern-matching on English prose.
 */
export const URL_REJECTION_CODES = [
  // --- Syntax: the input was not a usable URL. Maps to `invalid_url`.
  /** Nothing was submitted. */
  "empty",
  /** Longer than we are willing to parse. */
  "too_long",
  /** Contains control characters or embedded whitespace. */
  "malformed",
  /** A scheme other than http/https, e.g. `file:`, `javascript:`, `ftp:`. */
  "unsupported_protocol",
  /** No host component at all. */
  "missing_hostname",
  /** Host is syntactically impossible, e.g. `-example.com`, `example..com`. */
  "malformed_hostname",

  // --- Policy and safety: the URL was understood and refused. Maps to `blocked`.
  /** Embedded `user:password@` credentials. */
  "credentials_present",
  /** An explicit non-default port. */
  "disallowed_port",
  /** 127.0.0.0/8, ::1, or a `localhost` name. */
  "loopback",
  /** RFC 1918 IPv4, IPv6 unique-local, and similar. */
  "private_network",
  /** 169.254.0.0/16 or fe80::/10. */
  "link_local",
  /** A known cloud instance-metadata address or hostname. */
  "metadata_endpoint",
  /** 0.0.0.0 or :: — "this host, any interface". */
  "unspecified_address",
  /** 100.64.0.0/10 carrier-grade NAT. */
  "shared_address_space",
  /** Multicast. Never a website. */
  "multicast_address",
  /** Documentation, benchmarking, and other non-routable reservations. */
  "reserved_address",
  /** `.local`, `.internal`, a bare single-label name, and similar. */
  "internal_hostname",
] as const;

export type UrlRejectionCode = (typeof URL_REJECTION_CODES)[number];

/** Codes that mean "this was not a URL", as opposed to "we refuse this URL". */
const SYNTAX_REJECTION_CODES = [
  "empty",
  "too_long",
  "malformed",
  "unsupported_protocol",
  "missing_hostname",
  "malformed_hostname",
] as const satisfies readonly UrlRejectionCode[];

export interface ValidUrlResult {
  readonly valid: true;
  /** Canonical absolute URL. Safe to log; never contains credentials. */
  readonly normalizedUrl: string;
}

export interface InvalidUrlResult {
  readonly valid: false;
  readonly code: UrlRejectionCode;
  /** Explanation intended for the person who submitted the URL. */
  readonly reason: string;
}

export type UrlValidationResult = ValidUrlResult | InvalidUrlResult;

/**
 * Map a rejection to the analysis job state it should produce (ADR-011).
 *
 * A malformed string and a deliberate attempt to reach 169.254.169.254 are both
 * refusals, but they are not the same event and must not collapse into one
 * state.
 */
export function analysisStatusForRejection(
  code: UrlRejectionCode,
): Extract<AnalysisStatus, "invalid_url" | "blocked"> {
  return (SYNTAX_REJECTION_CODES as readonly string[]).includes(code)
    ? "invalid_url"
    : "blocked";
}
