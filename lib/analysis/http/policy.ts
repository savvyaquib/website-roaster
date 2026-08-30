/**
 * The security policy the HTTP analyzer enforces.
 *
 * Source of truth: docs/DECISIONS.md ADR-035.
 *
 * Phase 1 validated the *submitted string*. This phase must additionally decide
 * two things at request time:
 *
 *  1. is each redirect target acceptable? — reuses the Phase 1 validator
 *     unchanged, because a redirect target is just another submitted URL;
 *  2. is each resolved IP address acceptable? — reuses the Phase 1 address
 *     classifier, because `example.com` resolving to 10.0.0.1 must be refused
 *     just as `http://10.0.0.1/` is.
 *
 * Expressing both as an injectable interface keeps the production rules in one
 * place while letting tests point the analyzer at a local server. The default
 * is strict; a test that needs loopback supplies its own policy and the shipped
 * code contains no bypass.
 */

import { classifyIpLiteral } from "@/lib/analysis/url/ip";
import { validateUrl } from "@/lib/analysis/url";
import type { UrlValidationResult } from "@/lib/analysis/url";

export interface HttpSecurityPolicy {
  /** Applied to the initial URL and to every redirect target. */
  validateUrl(url: string): UrlValidationResult;
  /**
   * Applied to every address a hostname resolves to.
   *
   * @returns `null` if the address may be contacted, or a short reason if not.
   */
  validateAddress(address: string): string | null;
}

/**
 * The policy used in production: public internet only.
 *
 * Both members delegate to Phase 1, so there is exactly one definition of
 * "an address we refuse to contact" in the codebase.
 */
export const publicHttpSecurityPolicy: HttpSecurityPolicy = {
  validateUrl,
  validateAddress(address: string): string | null {
    const classification = classifyIpLiteral(address);

    // A resolver returned something that is not an address. Refuse it rather
    // than hand it to the socket layer and hope.
    if (classification.kind !== "ip") return "not_an_ip_address";

    return classification.reason;
  },
};
