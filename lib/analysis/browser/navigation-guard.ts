/**
 * The request guard applied to everything the rendered page asks for.
 *
 * Source of truth: docs/DECISIONS.md ADR-035 (Phase 3 column) and ADR-042.
 *
 * ## Why this exists
 *
 * Phases 1 and 2 govern requests *we* make. A rendered page makes its own, and
 * it decides what they are: an attacker's page can simply contain
 * `fetch('http://169.254.169.254/latest/meta-data/')`. That is the largest part
 * of the SSRF surface and neither earlier phase touches it.
 *
 * Every request the browser makes is therefore checked against the same policy
 * used by the HTTP analyzer, and refused if it points anywhere we would not go
 * ourselves.
 *
 * ## What this is not
 *
 * This is an application-level control, not isolation. Chromium performs its own
 * DNS resolution, so a name that resolves to a public address when we check it
 * could resolve to a private one when the browser connects — the rebinding
 * window that Phase 2 closes by pinning cannot be closed here, because we do
 * not own the socket.
 *
 * Closing it properly requires a network boundary the process cannot cross: a
 * container without a route to private ranges, or an egress firewall. That is a
 * deployment control and is tracked for Phase 20. Treat this guard as
 * defence in depth, and do not describe the browser as isolated because of it.
 */

import type { HttpSecurityPolicy } from "@/lib/analysis/http";
import type { AddressResolver } from "@/lib/analysis/http";
import { lookup as dnsLookup } from "node:dns/promises";

/**
 * Schemes that carry no network access and are safe to allow unchecked.
 *
 * `data:` and `blob:` are in-memory, `about:` is the browser's own. Refusing
 * them would break ordinary pages while preventing nothing.
 */
const INERT_SCHEMES = new Set(["data:", "blob:", "about:", "javascript:"]);

export interface GuardDecision {
  readonly allowed: boolean;
  /** Short machine-readable reason when refused. */
  readonly reason: string | null;
}

const ALLOW: GuardDecision = { allowed: true, reason: null };

export interface NavigationGuard {
  /** Decide whether the browser may issue this request. */
  check(url: string): Promise<GuardDecision>;
  /** URLs refused so far, in order, deduplicated. */
  readonly blocked: readonly string[];
}

export interface NavigationGuardOptions {
  readonly policy: HttpSecurityPolicy;
  readonly resolver?: AddressResolver;
}

const systemResolver: AddressResolver = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export function createNavigationGuard(options: NavigationGuardOptions): NavigationGuard {
  const { policy, resolver = systemResolver } = options;

  // A page makes hundreds of requests to a handful of hosts. Without a cache
  // this would issue a DNS lookup per subresource and dominate the page load.
  const hostCache = new Map<string, Promise<GuardDecision>>();
  const blocked: string[] = [];
  const blockedSeen = new Set<string>();

  function refuse(url: string, reason: string): GuardDecision {
    if (!blockedSeen.has(url)) {
      blockedSeen.add(url);
      blocked.push(url);
    }
    return { allowed: false, reason };
  }

  async function checkHost(hostname: string): Promise<GuardDecision> {
    let addresses;
    try {
      addresses = await resolver(hostname);
    } catch {
      // Unresolvable is not a policy refusal: let the browser fail naturally so
      // the failure is reported as the network error it actually is.
      return ALLOW;
    }

    if (addresses.length === 0) return ALLOW;

    for (const entry of addresses) {
      const refusal = policy.validateAddress(entry.address);
      if (refusal !== null) {
        return { allowed: false, reason: refusal };
      }
    }

    return ALLOW;
  }

  return {
    get blocked() {
      return blocked;
    },

    async check(url: string): Promise<GuardDecision> {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return refuse(url, "malformed");
      }

      if (INERT_SCHEMES.has(parsed.protocol)) return ALLOW;

      // Everything else — file:, ftp:, and anything exotic — is refused. Only
      // http and https are things a website legitimately fetches.
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return refuse(url, "unsupported_protocol");
      }

      const verdict = policy.validateUrl(url);
      if (!verdict.valid) {
        return refuse(url, verdict.code);
      }

      const hostname = parsed.hostname;
      let cached = hostCache.get(hostname);
      if (cached === undefined) {
        cached = checkHost(hostname);
        hostCache.set(hostname, cached);
      }

      const decision = await cached;
      if (!decision.allowed) {
        return refuse(url, decision.reason ?? "blocked_address");
      }

      return ALLOW;
    },
  };
}
