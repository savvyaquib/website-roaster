/**
 * Hostname syntax checks and internal-name classification.
 *
 * Source of truth: docs/DECISIONS.md ADR-035 (Phase 1 owns "reject `localhost`
 * and internal-only hostname patterns").
 *
 * Pure string logic. Nothing here resolves a name — that is Phase 2.
 */

import type { UrlRejectionCode } from "./types";

export type HostnameBlockReason = Extract<
  UrlRejectionCode,
  "loopback" | "internal_hostname" | "metadata_endpoint"
>;

/** Cloud metadata names. Most also match an internal suffix; these are clearer. */
const METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/**
 * Suffixes that never belong to a public website.
 *
 * Split into two groups only for documentation; both are refused.
 */
const INTERNAL_SUFFIXES = [
  // Special-use names reserved by RFC 6761 / RFC 6762 / RFC 8375.
  "local",
  "localhost",
  "localdomain",
  "test",
  "example",
  "invalid",
  "home.arpa",
  "arpa",
  "onion",

  // Conventional private-network suffixes. Not reserved by an RFC, but a public
  // site is not served from them and they are common in split-horizon DNS.
  "internal",
  "intranet",
  "private",
  "corp",
  "lan",
  "home",
] as const;

/** Longest hostname we will consider, per DNS limits. */
const MAX_HOSTNAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

/**
 * Canonicalise a hostname for comparison.
 *
 * Strips the trailing root dot, which is otherwise a trivial way to slip
 * `localhost.` past a suffix check.
 */
export function normalizeHostname(hostname: string): string {
  const lowered = hostname.toLowerCase();
  return lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;
}

/**
 * Is this a syntactically possible DNS hostname?
 *
 * Rejects empty labels (`example..com`), labels that begin or end with a hyphen
 * (`-example.com`), over-long labels, and any character outside the letter,
 * digit and hyphen set. Punycode labels (`xn--…`) pass, which is what makes
 * internationalised domains work.
 *
 * Underscores are refused: they are not valid in hostnames per RFC 1123, even
 * though they appear in other DNS record types.
 */
export function isSyntacticallyValidHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > MAX_HOSTNAME_LENGTH) return false;

  const labels = hostname.split(".");

  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
  }

  return true;
}

/**
 * Classify a hostname that is not an IP literal.
 *
 * @param hostname must already be normalised by {@link normalizeHostname}.
 * @returns the reason it is disallowed, or `null` if it looks like a public name.
 */
export function classifyHostname(hostname: string): HostnameBlockReason | null {
  if (METADATA_HOSTNAMES.has(hostname)) return "metadata_endpoint";

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "loopback";
  }

  // A name with no dot cannot be a public website. It is a machine on the local
  // network, a search-domain completion, or a container alias — `router`,
  // `intranet`, `metadata`. This single rule covers a large family of internal
  // names without needing to enumerate them.
  if (!hostname.includes(".")) return "internal_hostname";

  for (const suffix of INTERNAL_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) {
      return "internal_hostname";
    }
  }

  return null;
}
