/**
 * Cookie attribute checks.
 *
 * Reads only cookie **names and attributes** — never values. See cookies.ts for
 * why the value is not captured at all.
 */

import type { HttpResponseData } from "@/lib/analysis/http";
import type { Finding } from "@/lib/types/finding";

import { parseSetCookies, type ParsedCookie } from "../cookies";
import { httpEvidence, securityFinding } from "../finding-builder";

import { isHttps } from "./transport";

/** Names, for evidence. Bounded so a site setting many cookies stays readable. */
function names(cookies: readonly ParsedCookie[], limit = 5): string {
  const shown = cookies.slice(0, limit).map((cookie) => cookie.name);
  const extra = cookies.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} (+${extra} more)` : shown.join(", ");
}

export function checkCookies(response: HttpResponseData): Finding[] {
  const cookies = parseSetCookies(response.setCookie);

  if (cookies.length === 0) {
    return [
      securityFinding({
        id: "security.cookies.none",
        severity: "info",
        status: "pass",
        evidence: [httpEvidence("The response set no cookies.")],
        explanation:
          "There are no cookie attributes to assess on this response. Cookies set later by JavaScript are not visible here.",
        recommendation: "Set Secure, HttpOnly and SameSite on any cookie added later.",
      }),
    ];
  }

  const findings: Finding[] = [];
  const secure = isHttps(response);

  // SameSite=None without Secure is rejected outright by current browsers, so
  // the cookie simply does not work. That is a different problem from a merely
  // weak attribute, and is reported first.
  const noneWithoutSecure = cookies.filter(
    (cookie) => cookie.sameSite === "none" && !cookie.secure,
  );

  if (noneWithoutSecure.length > 0) {
    findings.push(
      securityFinding({
        id: "security.cookies.samesite_none_insecure",
        severity: "serious",
        status: "fail",
        evidence: [
          httpEvidence(
            `${noneWithoutSecure.length} cookie(s) declare SameSite=None without Secure.`,
            names(noneWithoutSecure),
          ),
        ],
        explanation:
          "Current browsers reject a cookie that declares SameSite=None without Secure, so these cookies are discarded entirely and whatever depends on them will not work.",
        recommendation: "Add the Secure attribute to these cookies.",
      }),
    );
  }

  const missingSecure = cookies.filter((cookie) => !cookie.secure);

  if (secure && missingSecure.length > 0) {
    findings.push(
      securityFinding({
        id: "security.cookies.missing_secure",
        severity: "serious",
        status: "fail",
        evidence: [
          httpEvidence(
            `${missingSecure.length} of ${cookies.length} cookie(s) have no Secure attribute.`,
            names(missingSecure),
          ),
        ],
        explanation:
          "A cookie without Secure is sent over plain HTTP as well as HTTPS, so a single unencrypted request to this domain exposes it.",
        recommendation: "Add the Secure attribute to every cookie on an HTTPS site.",
      }),
    );
  }

  const missingHttpOnly = cookies.filter((cookie) => !cookie.httpOnly);

  if (missingHttpOnly.length > 0) {
    findings.push(
      securityFinding({
        id: "security.cookies.missing_httponly",
        severity: "moderate",
        status: "warn",
        evidence: [
          httpEvidence(
            `${missingHttpOnly.length} of ${cookies.length} cookie(s) have no HttpOnly attribute.`,
            names(missingHttpOnly),
          ),
        ],
        explanation:
          "A cookie without HttpOnly can be read by JavaScript, so any script running on the page — including an injected one — can take it. Some cookies are read by scripts deliberately, so this is not automatically wrong.",
        recommendation:
          "Add HttpOnly to any cookie that scripts do not need to read, especially session cookies.",
      }),
    );
  }

  const missingSameSite = cookies.filter((cookie) => cookie.sameSite === null);

  if (missingSameSite.length > 0) {
    findings.push(
      securityFinding({
        id: "security.cookies.missing_samesite",
        severity: "minor",
        status: "warn",
        evidence: [
          httpEvidence(
            `${missingSameSite.length} of ${cookies.length} cookie(s) declare no SameSite attribute.`,
            names(missingSameSite),
          ),
        ],
        explanation:
          "Without SameSite the browser applies its own default, which varies between browsers and versions. Declaring it makes the behaviour explicit rather than inherited.",
        recommendation:
          "Declare SameSite=Lax on cookies unless a cross-site flow needs otherwise.",
      }),
    );
  }

  if (findings.length > 0) return findings;

  return [
    securityFinding({
      id: "security.cookies.ok",
      severity: "info",
      status: "pass",
      evidence: [
        httpEvidence(
          `All ${cookies.length} cookie(s) declare Secure, HttpOnly and SameSite.`,
          names(cookies),
        ),
      ],
      explanation:
        "The cookies on this response declare the protective attributes. Their values were not read and are not part of this report.",
      recommendation: "Apply the same attributes to any cookie added later.",
    }),
  ];
}
