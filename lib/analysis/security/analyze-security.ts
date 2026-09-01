/**
 * Phase 6 — Security analyzer.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 6, docs/DECISIONS.md ADR-046.
 *
 * Reports **observable security configuration** from the Phase 2 response:
 * transport, response headers, cookie attributes and technology disclosure.
 *
 * ## What this analyzer does not do
 *
 * It never states that a site is secure, and it never reports a vulnerability.
 *
 * Everything here is read from response metadata. That evidence can support
 * "this response does not set a Content-Security-Policy" — a fact. It cannot
 * support "this site is safe", because the analyzer has not tested the
 * application, its dependencies, its authentication, or anything behind it.
 * A passing finding says a header is configured, and says so in those terms.
 *
 * This is not modesty. A security report that reads as a clean bill of health
 * is worse than no report, because it invites someone to stop looking.
 *
 * ## Pure
 *
 * `analyzeSecurity` performs no I/O. It reads the response Phase 2 already
 * retrieved, which keeps every check deterministic and testable.
 */

import type { Finding } from "@/lib/types/finding";

import { checkCookies } from "./checks/cookies";
import { checkServerDisclosure } from "./checks/disclosure";
import {
  checkContentSecurityPolicy,
  checkContentTypeOptions,
  checkFrameProtection,
  checkReferrerPolicy,
} from "./checks/headers";
import { checkHsts, checkHttps } from "./checks/transport";
import type { SecurityAnalysisInput } from "./types";

/**
 * Run every security configuration check.
 *
 * Findings are returned in a fixed order — transport first, since an
 * unencrypted connection undermines everything after it — so the output is
 * deterministic and two runs of the same page are directly comparable.
 *
 * Produces no score. Turning findings into numbers is Phase 12 (ADR-002).
 */
export function analyzeSecurity(input: SecurityAnalysisInput): Finding[] {
  const { response } = input;

  return [
    // Transport first: without TLS, every header below is advisory at best,
    // because an attacker in the middle can rewrite them.
    ...checkHttps(response),
    ...checkHsts(response),

    ...checkContentSecurityPolicy(response),
    ...checkFrameProtection(response),
    ...checkContentTypeOptions(response),
    ...checkReferrerPolicy(response),

    ...checkCookies(response),
    ...checkServerDisclosure(response),
  ];
}
