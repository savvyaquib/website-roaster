/**
 * Phase 1 — URL validation.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 1, docs/DECISIONS.md ADR-035.
 *
 * Accepts an untrusted string and either returns a canonical URL that is safe
 * to hand to Phase 2, or refuses it with a reason.
 *
 * ## Scope
 *
 * This module performs **no I/O**. It does not resolve DNS and it does not open
 * a connection, which is what makes the Phase 1 acceptance criterion — "no
 * network request happens before validation succeeds" — structurally true
 * rather than merely intended.
 *
 * It also does **not** close the SSRF risk. A hostname that passes here can
 * still resolve to a private address, and the address it resolves to can change
 * between this check and the connection (DNS rebinding). Pinning the connection
 * to a validated address and re-validating every redirect hop belong to
 * Phase 2; isolating the browser belongs to Phase 3. See ADR-035.
 */

import { classifyIpLiteral } from "./ip";
import {
  classifyHostname,
  isSyntacticallyValidHostname,
  normalizeHostname,
} from "./hostname";
import type { UrlRejectionCode, UrlValidationResult } from "./types";

/** Schemes we will analyse. Everything else is refused. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Ports we will analyse.
 *
 * Only the default port for each scheme. A public website is served on 80 or
 * 443; permitting arbitrary ports would turn a public analysis tool into a port
 * scanner. See ADR-039.
 *
 * The WHATWG parser already removes an explicitly written default port, so by
 * the time we inspect `URL.port` a non-empty value is always non-default.
 */
const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  "http:": "80",
  "https:": "443",
};

/** Upper bound on input length, as a cheap guard against absurd input. */
const MAX_URL_LENGTH = 2048;

/**
 * Does the input contain a C0 control character or DEL?
 *
 * This matters because the URL parser *silently removes* tab, CR and LF from
 * input rather than rejecting them, so a newline hidden inside a hostname
 * would quietly disappear and change which host we contact.
 *
 * A space is deliberately allowed: the parser percent-encodes it, which is
 * visible and harmless.
 */
function containsForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }

  return false;
}

const REJECTION_REASONS: Readonly<Record<UrlRejectionCode, string>> = {
  empty: "Enter a website URL.",
  too_long: `That URL is longer than ${MAX_URL_LENGTH} characters.`,
  malformed: "That does not look like a valid URL.",
  unsupported_protocol: "Only http:// and https:// URLs can be analyzed.",
  missing_hostname: "That URL does not include a website address.",
  malformed_hostname: "That website address is not valid.",
  credentials_present:
    "Remove the username and password from the URL before analyzing it.",
  disallowed_port: "Only the standard ports (80 and 443) can be analyzed.",
  loopback: "That address points at the machine running this tool, not a public website.",
  private_network: "That address is on a private network and cannot be analyzed.",
  link_local: "That is a link-local address and cannot be analyzed.",
  metadata_endpoint: "That is a cloud metadata endpoint and cannot be analyzed.",
  unspecified_address: "That is not a routable address.",
  shared_address_space:
    "That address is in carrier-grade NAT space and cannot be analyzed.",
  multicast_address: "That is a multicast address, not a website.",
  reserved_address: "That address is reserved and cannot be analyzed.",
  internal_hostname: "That hostname is internal-only and cannot be analyzed.",
};

function reject(code: UrlRejectionCode): UrlValidationResult {
  return { valid: false, code, reason: REJECTION_REASONS[code] };
}

/** The scheme assumed when someone types a bare hostname. */
const INFERRED_SCHEME = "https://";

/** A scheme, as the URL standard spells one, at the very start of the input. */
const LEADING_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * The string to validate, with a scheme added when one was clearly omitted.
 *
 * Typing `example.com` is what people do, and refusing it taught them nothing
 * they wanted to know. Inferring `https://` costs no safety: the result goes
 * through every check below exactly as a typed URL would, so `localhost`
 * becomes `https://localhost` and is refused as loopback rather than as a
 * syntax error — a better answer to the same question.
 *
 * ## The scheme is detected textually, not by parsing
 *
 * An earlier version prefixed anything the parser refused, which meant a
 * mistyped `https://exa mple.com` became `https://https://exa mple.com` and was
 * reported as a bad *hostname* instead of a bad URL. Whether a scheme was
 * written is a question about the text, and it is answered before any parsing.
 *
 * ## Dotted schemes are the one rewrite
 *
 * `example.com:8080` is legal as a scheme named `example.com`, because a scheme
 * name may contain dots. Nobody means that; they mean a host and a port. Only
 * dotted scheme names are rewritten, so `javascript:`, `mailto:`, `data:` and
 * `file:` are untouched and stay refused for their protocol.
 */
function withInferredScheme(input: string): string {
  const scheme = LEADING_SCHEME.exec(input);

  if (scheme === null) return `${INFERRED_SCHEME}${input}`;

  return scheme[1]?.includes(".") === true ? `${INFERRED_SCHEME}${input}` : input;
}

/**
 * Validate and normalize an untrusted URL string.
 *
 * Checks run security-first: a private address is reported as such even when
 * the URL also has, say, a disallowed port.
 *
 * @param input the raw string a user submitted.
 * @returns the canonical URL, or the reason it was refused.
 */
export function validateUrl(input: unknown): UrlValidationResult {
  if (typeof input !== "string") return reject("empty");

  const trimmed = input.trim();
  if (trimmed.length === 0) return reject("empty");
  if (trimmed.length > MAX_URL_LENGTH) return reject("too_long");

  // Checked before parsing rather than after: see containsForbiddenCharacter.
  if (containsForbiddenCharacter(trimmed)) return reject("malformed");

  let url: URL;
  try {
    url = new URL(withInferredScheme(trimmed));
  } catch {
    return reject("malformed");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return reject("unsupported_protocol");

  // `https://user:pass@example.com` — credentials would be forwarded to the
  // target and would end up in logs and in the shareable result (ADR-035).
  if (url.username.length > 0 || url.password.length > 0) {
    return reject("credentials_present");
  }

  if (url.hostname.length === 0) return reject("missing_hostname");

  const hostname = normalizeHostname(url.hostname);

  const ipClassification = classifyIpLiteral(hostname);

  if (ipClassification.kind === "ip") {
    if (ipClassification.reason !== null) return reject(ipClassification.reason);
  } else {
    if (!isSyntacticallyValidHostname(hostname)) return reject("malformed_hostname");

    const hostnameReason = classifyHostname(hostname);
    if (hostnameReason !== null) return reject(hostnameReason);
  }

  if (url.port.length > 0 && url.port !== DEFAULT_PORTS[url.protocol]) {
    return reject("disallowed_port");
  }

  return { valid: true, normalizedUrl: buildNormalizedUrl(url, hostname) };
}

/**
 * Produce the canonical form of an accepted URL.
 *
 * - the fragment is dropped: it is never sent to the server, so two URLs that
 *   differ only by fragment are the same analysis;
 * - a trailing root dot is removed from the hostname;
 * - scheme, host lowercasing, punycode encoding and default-port removal have
 *   already been done by the URL parser.
 *
 * The query string is preserved, because it routinely changes what the page
 * actually renders.
 */
function buildNormalizedUrl(url: URL, canonicalHostname: string): string {
  const normalized = new URL(url.href);

  normalized.hash = "";

  if (normalized.hostname !== canonicalHostname) {
    normalized.hostname = canonicalHostname;
  }

  return normalized.href;
}
