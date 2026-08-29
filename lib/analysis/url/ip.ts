/**
 * IP literal parsing and range classification.
 *
 * Source of truth: docs/DECISIONS.md ADR-035 (Phase 1 owns "reject hostnames
 * that are IP literals in disallowed ranges").
 *
 * Pure functions over strings and numbers. No DNS, no network — resolving a
 * hostname to an address and validating *that* belongs to Phase 2.
 *
 * ## Why this operates on the parsed hostname
 *
 * `http://2130706433/`, `http://0x7f.0.0.1/`, `http://0177.0.0.1/`,
 * `http://127.1/` and `http://①②⑦.0.0.1/` are all 127.0.0.1. The WHATWG URL
 * parser normalises every one of them to dotted-decimal before we see it, so
 * these functions are given `URL.hostname` and never the raw user input.
 * Classifying the raw string instead would miss all five.
 */

import type { UrlRejectionCode } from "./types";

/** The subset of rejection codes this module can produce. */
export type IpBlockReason = Extract<
  UrlRejectionCode,
  | "loopback"
  | "private_network"
  | "link_local"
  | "metadata_endpoint"
  | "unspecified_address"
  | "shared_address_space"
  | "multicast_address"
  | "reserved_address"
>;

/**
 * Cloud instance-metadata addresses.
 *
 * Each already falls inside a blocked range, so this table only sharpens the
 * reported reason from "link-local" to "metadata endpoint". Keeping it explicit
 * also documents *why* those ranges matter.
 */
const METADATA_IPV4 = new Set([
  /** AWS, Azure, GCP, DigitalOcean, Oracle. */
  "169.254.169.254",
  /** Alibaba Cloud. */
  "100.100.100.200",
  /** GCP legacy metadata endpoint. */
  "169.254.169.253",
]);

/** AWS IMDS over IPv6, expressed as normalised hextets. */
const METADATA_IPV6 = new Set(["fd00:ec2:0:0:0:0:0:254"]);

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------

/**
 * Parse a dotted-decimal IPv4 address into four octets.
 *
 * Deliberately strict: exactly four base-10 parts, each 0-255, no leading
 * zeros. Shorthand and alternate bases are the URL parser's job, not ours —
 * accepting them here would mean two components disagreeing about what an
 * address is, which is how bypasses happen.
 *
 * @returns four octets, or `null` if the string is not a plain IPv4 address.
 */
export function parseIpv4(hostname: string): readonly number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];

  for (const part of parts) {
    if (part.length === 0 || part.length > 3) return null;
    if (!/^\d+$/.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;

    const value = Number(part);
    if (value > 255) return null;

    octets.push(value);
  }

  return octets;
}

/**
 * Classify an IPv4 address against the ranges a public website can never use.
 *
 * @returns the reason it is disallowed, or `null` if it is publicly routable.
 */
export function classifyIpv4(octets: readonly number[]): IpBlockReason | null {
  const [a = 0, b = 0, c = 0, d = 0] = octets;

  if (METADATA_IPV4.has(`${a}.${b}.${c}.${d}`)) return "metadata_endpoint";

  // 0.0.0.0/8 — "this network"; 0.0.0.0 means every local interface.
  if (a === 0) return "unspecified_address";

  // 127.0.0.0/8
  if (a === 127) return "loopback";

  // 169.254.0.0/16 — link-local, which is where cloud metadata lives.
  if (a === 169 && b === 254) return "link_local";

  // RFC 1918.
  if (a === 10) return "private_network";
  if (a === 172 && b >= 16 && b <= 31) return "private_network";
  if (a === 192 && b === 168) return "private_network";

  // 100.64.0.0/10 — carrier-grade NAT.
  if (a === 100 && b >= 64 && b <= 127) return "shared_address_space";

  // 224.0.0.0/4.
  if (a >= 224 && a <= 239) return "multicast_address";

  // 240.0.0.0/4, including 255.255.255.255.
  if (a >= 240) return "reserved_address";

  // 192.0.0.0/24 IETF protocol assignments; 192.0.2.0/24 TEST-NET-1.
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return "reserved_address";

  // 192.88.99.0/24 — deprecated 6to4 relay anycast.
  if (a === 192 && b === 88 && c === 99) return "reserved_address";

  // 198.18.0.0/15 — benchmarking.
  if (a === 198 && (b === 18 || b === 19)) return "reserved_address";

  // 198.51.100.0/24 TEST-NET-2 and 203.0.113.0/24 TEST-NET-3.
  if (a === 198 && b === 51 && c === 100) return "reserved_address";
  if (a === 203 && b === 0 && c === 113) return "reserved_address";

  return null;
}

// ---------------------------------------------------------------------------
// IPv6
// ---------------------------------------------------------------------------

/**
 * Parse an IPv6 address into eight 16-bit hextets.
 *
 * Handles `::` compression and a trailing embedded IPv4 form
 * (`::ffff:127.0.0.1`). Surrounding brackets are accepted because
 * `URL.hostname` returns them.
 *
 * @returns eight hextets, or `null` if the string is not a valid IPv6 address.
 */
export function parseIpv6(hostname: string): readonly number[] | null {
  let text = hostname;

  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1);
  }

  // A zone identifier (`%eth0`) is meaningful only on a local interface.
  if (text.includes("%")) return null;
  if (text.length === 0) return null;

  const doubleColonCount = text.split("::").length - 1;
  if (doubleColonCount > 1) return null;

  const [headText = "", tailText = ""] =
    doubleColonCount === 1 ? text.split("::") : [text, undefined];

  const hasCompression = doubleColonCount === 1;

  function parseGroups(section: string): number[] | null {
    if (section.length === 0) return [];

    const groups: number[] = [];
    const parts = section.split(":");

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] ?? "";

      // A trailing dotted-quad contributes two hextets.
      if (part.includes(".")) {
        if (i !== parts.length - 1) return null;

        const octets = parseIpv4(part);
        if (octets === null) return null;

        groups.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0));
        groups.push(((octets[2] ?? 0) << 8) | (octets[3] ?? 0));
        continue;
      }

      if (part.length === 0 || part.length > 4) return null;
      if (!/^[0-9a-fA-F]+$/.test(part)) return null;

      groups.push(Number.parseInt(part, 16));
    }

    return groups;
  }

  const head = parseGroups(headText);
  const tail = hasCompression ? parseGroups(tailText) : [];
  if (head === null || tail === null) return null;

  if (!hasCompression) {
    return head.length === 8 ? head : null;
  }

  const missing = 8 - head.length - tail.length;
  // `::` must stand for at least one group.
  if (missing < 1) return null;

  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/** Render hextets in the plain, uncompressed lowercase hex form. */
function formatIpv6(hextets: readonly number[]): string {
  return hextets.map((h) => h.toString(16)).join(":");
}

/**
 * Classify an IPv6 address.
 *
 * Addresses that embed an IPv4 address (IPv4-mapped, IPv4-compatible, NAT64 and
 * 6to4) are resolved to that IPv4 address and classified with the IPv4 rules,
 * because that is the host the connection would actually reach.
 *
 * @returns the reason it is disallowed, or `null` if it is publicly routable.
 */
export function classifyIpv6(hextets: readonly number[]): IpBlockReason | null {
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = hextets;

  if (METADATA_IPV6.has(formatIpv6(hextets))) return "metadata_endpoint";

  const allZeroExceptLast = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;

  // ::
  if (allZeroExceptLast && h5 === 0 && h6 === 0 && h7 === 0) {
    return "unspecified_address";
  }

  // ::1
  if (allZeroExceptLast && h5 === 0 && h6 === 0 && h7 === 1) {
    return "loopback";
  }

  // ::ffff:a.b.c.d — IPv4-mapped.
  if (allZeroExceptLast && h5 === 0xffff) {
    return classifyEmbeddedIpv4(h6, h7);
  }

  // ::a.b.c.d — deprecated IPv4-compatible.
  if (allZeroExceptLast && h5 === 0) {
    return classifyEmbeddedIpv4(h6, h7);
  }

  // 64:ff9b::/96 — NAT64.
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return classifyEmbeddedIpv4(h6, h7);
  }

  // 2002::/16 — 6to4, which carries its IPv4 address in the next 32 bits.
  if (h0 === 0x2002) {
    return classifyEmbeddedIpv4(h1, h2) ?? "reserved_address";
  }

  // fe80::/10 — link-local.
  if ((h0 & 0xffc0) === 0xfe80) return "link_local";

  // fc00::/7 — unique local.
  if ((h0 & 0xfe00) === 0xfc00) return "private_network";

  // ff00::/8 — multicast.
  if ((h0 & 0xff00) === 0xff00) return "multicast_address";

  // 100::/64 discard prefix.
  if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) return "reserved_address";

  // 2001:db8::/32 documentation, and 2001::/32 Teredo.
  if (h0 === 0x2001 && h1 === 0x0db8) return "reserved_address";
  if (h0 === 0x2001 && h1 === 0) return "reserved_address";

  return null;
}

function classifyEmbeddedIpv4(high: number, low: number): IpBlockReason | null {
  return classifyIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type IpLiteralClassification =
  | { readonly kind: "not-an-ip" }
  | { readonly kind: "ip"; readonly reason: IpBlockReason | null };

/**
 * Classify a hostname that may or may not be an IP literal.
 *
 * @param hostname a hostname as produced by `URL.hostname`, so IPv6 may be
 *   bracketed and IPv4 is already dotted-decimal.
 */
export function classifyIpLiteral(hostname: string): IpLiteralClassification {
  if (hostname.startsWith("[")) {
    const hextets = parseIpv6(hostname);
    // Bracketed but unparseable: still an IP literal, and not one we will touch.
    if (hextets === null) return { kind: "ip", reason: "reserved_address" };
    return { kind: "ip", reason: classifyIpv6(hextets) };
  }

  const octets = parseIpv4(hostname);
  if (octets !== null) return { kind: "ip", reason: classifyIpv4(octets) };

  return { kind: "not-an-ip" };
}
