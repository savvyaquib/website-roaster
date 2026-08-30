/**
 * DNS resolution with address validation and connection pinning.
 *
 * Source of truth: docs/DECISIONS.md ADR-035, Phase 2 column.
 *
 * ## The problem this solves
 *
 * Phase 1 established that `http://10.0.0.1/` is refused. It cannot establish
 * anything about `http://example.com/`, because the address behind that name is
 * not known until it is resolved — and an attacker controls their own DNS.
 *
 * Two attacks follow:
 *
 *  1. **A public name pointing at a private address.** `evil.com` simply has an
 *     A record of `169.254.169.254`.
 *  2. **DNS rebinding (TOCTOU).** The name resolves to a public address when we
 *     check it, and to a private one a moment later when the socket connects.
 *     Validating a name and then letting the HTTP client resolve it *again* is
 *     exactly the hole CLAUDE.md warns about.
 *
 * ## The fix
 *
 * Resolve once, validate every address returned, and hand the socket a single
 * validated **address** rather than a name. The connection can then only reach
 * the address that was checked; there is no second resolution to poison.
 *
 * The `Host` header and the TLS server name still carry the original hostname,
 * so virtual hosting and certificate validation are unaffected.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";

import type { HttpSecurityPolicy } from "./policy";

/** Set on the error raised when every resolved address was refused. */
export const BLOCKED_ADDRESS_ERROR_CODE = "WR_BLOCKED_ADDRESS";

/** Resolves a hostname to every address it maps to. Injectable for tests. */
export type AddressResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

const systemResolver: AddressResolver = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export class BlockedAddressError extends Error {
  readonly code = BLOCKED_ADDRESS_ERROR_CODE;
  readonly hostname: string;
  readonly addresses: readonly string[];

  constructor(hostname: string, addresses: readonly string[], detail: string) {
    super(`Refused to connect to ${hostname}: ${detail}`);
    this.name = "BlockedAddressError";
    this.hostname = hostname;
    this.addresses = addresses;
  }
}

/**
 * Build a `lookup` function for `http.request`, enforcing `policy`.
 *
 * Every address the resolver returns is validated. If *any* is refused, the
 * whole connection is refused rather than quietly falling through to a sibling
 * address — a name that resolves to both a public and a private address is
 * either misconfigured or hostile, and neither deserves a request.
 */
export function createPinnedLookup(
  policy: HttpSecurityPolicy,
  resolver: AddressResolver = systemResolver,
): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          const error: NodeJS.ErrnoException = new Error(
            `No addresses found for ${hostname}`,
          );
          error.code = "ENOTFOUND";
          callback(error, "", 0);
          return;
        }

        for (const entry of addresses) {
          const refusal = policy.validateAddress(entry.address);

          if (refusal !== null) {
            callback(
              new BlockedAddressError(
                hostname,
                addresses.map((a) => a.address),
                `${entry.address} is ${refusal}`,
              ),
              "",
              0,
            );
            return;
          }
        }

        // Pin: hand back exactly one validated address. `options.all` decides
        // the shape the caller expects, not how many addresses we supply.
        const [pinned] = addresses;
        if (pinned === undefined) return;

        if (options.all === true) {
          callback(null, [pinned]);
          return;
        }

        callback(null, pinned.address, pinned.family);
      },
      (error: NodeJS.ErrnoException) => {
        callback(error, "", 0);
      },
    );
  };
}
