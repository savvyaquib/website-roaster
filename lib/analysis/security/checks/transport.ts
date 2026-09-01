/**
 * HTTPS and HSTS checks.
 *
 * Pure functions over the Phase 2 response.
 */

import type { HttpResponseData } from "@/lib/analysis/http";
import type { Finding } from "@/lib/types/finding";

import { parseHsts } from "../directives";
import { httpEvidence, preview, securityFinding } from "../finding-builder";
import { HSTS_MIN_MAX_AGE_SECONDS } from "../thresholds";

/** Was the page finally served over TLS? */
export function isHttps(response: HttpResponseData): boolean {
  try {
    return new URL(response.finalUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export function checkHttps(response: HttpResponseData): Finding[] {
  const secure = isHttps(response);

  // An http:// entry that redirects to https:// is the correct arrangement,
  // and worth reporting as such rather than staying silent about it.
  const upgraded = response.redirects.some((hop) => {
    try {
      return (
        new URL(hop.url).protocol === "http:" &&
        new URL(hop.location).protocol === "https:"
      );
    } catch {
      return false;
    }
  });

  if (!secure) {
    return [
      securityFinding({
        id: "security.https.absent",
        severity: "critical",
        status: "fail",
        evidence: [
          httpEvidence("The page was served over plain HTTP.", response.finalUrl),
        ],
        explanation:
          "Traffic to this page is not encrypted, so anyone between the visitor and the server can read it and change it in transit. Browsers also mark such pages as not private.",
        recommendation:
          "Serve the site over HTTPS with a valid certificate, and redirect HTTP requests to it.",
      }),
    ];
  }

  return [
    securityFinding({
      id: "security.https.present",
      severity: "info",
      status: "pass",
      evidence: [
        httpEvidence("The page was served over HTTPS.", response.finalUrl),
        ...(upgraded ? [httpEvidence("An HTTP request was redirected to HTTPS.")] : []),
      ],
      explanation:
        "The connection to this page was encrypted. This describes the transport only; it says nothing about the rest of the site's configuration.",
      recommendation: "Keep HTTPS enabled and the certificate renewed.",
    }),
  ];
}

export function checkHsts(response: HttpResponseData): Finding[] {
  const header = response.headers["strict-transport-security"];

  // HSTS delivered over plain HTTP is ignored by browsers, so on an HTTP page
  // there is nothing to assess — the HTTPS finding is the one that matters.
  if (!isHttps(response)) {
    return [
      securityFinding({
        id: "security.hsts.not_applicable",
        severity: "info",
        status: "could_not_determine",
        evidence: [
          httpEvidence(
            "The page was not served over HTTPS, so any HSTS header would be ignored by browsers.",
          ),
        ],
        explanation:
          "Whether HSTS is configured cannot be assessed until the site is served over HTTPS.",
        recommendation: "Enable HTTPS first, then add Strict-Transport-Security.",
      }),
    ];
  }

  if (header === undefined) {
    return [
      securityFinding({
        id: "security.hsts.absent",
        severity: "moderate",
        status: "fail",
        evidence: [httpEvidence("No Strict-Transport-Security header was sent.")],
        explanation:
          "Without HSTS, a visitor's first request to this site can still be made over plain HTTP, which leaves room for it to be intercepted and downgraded before the redirect to HTTPS happens.",
        recommendation: `Send Strict-Transport-Security with a max-age of at least ${HSTS_MIN_MAX_AGE_SECONDS} seconds once you are confident every subdomain supports HTTPS.`,
      }),
    ];
  }

  const parsed = parseHsts(header);
  const evidence = httpEvidence(
    "A Strict-Transport-Security header is present.",
    preview(header),
  );

  if (parsed.maxAge === null) {
    return [
      securityFinding({
        id: "security.hsts.no_max_age",
        severity: "moderate",
        status: "fail",
        evidence: [evidence],
        explanation:
          "The HSTS header has no readable max-age, so browsers cannot tell how long to enforce HTTPS and will ignore the header.",
        recommendation: `Add max-age=${HSTS_MIN_MAX_AGE_SECONDS} to the header.`,
      }),
    ];
  }

  if (parsed.maxAge === 0) {
    return [
      securityFinding({
        id: "security.hsts.disabled",
        severity: "moderate",
        status: "fail",
        evidence: [evidence],
        explanation:
          "A max-age of zero tells browsers to stop enforcing HTTPS for this site, which switches HSTS off. This is normally left behind after testing.",
        recommendation: `Set max-age to at least ${HSTS_MIN_MAX_AGE_SECONDS} seconds.`,
      }),
    ];
  }

  if (parsed.maxAge < HSTS_MIN_MAX_AGE_SECONDS) {
    return [
      securityFinding({
        id: "security.hsts.short_max_age",
        severity: "minor",
        status: "warn",
        evidence: [evidence, httpEvidence(`max-age is ${parsed.maxAge} seconds.`)],
        explanation:
          "A short max-age narrows the window in which a returning visitor is protected, because the instruction expires sooner.",
        recommendation: `Raise max-age to at least ${HSTS_MIN_MAX_AGE_SECONDS} seconds once you are confident in the HTTPS setup.`,
      }),
    ];
  }

  if (!parsed.includeSubDomains) {
    return [
      securityFinding({
        id: "security.hsts.no_subdomains",
        severity: "minor",
        status: "warn",
        evidence: [evidence],
        explanation:
          "HSTS is enforced for this hostname but not its subdomains, so a subdomain served over plain HTTP is still reachable without the protection.",
        recommendation:
          "Add includeSubDomains once every subdomain is confirmed to support HTTPS.",
      }),
    ];
  }

  return [
    securityFinding({
      id: "security.hsts.ok",
      severity: "info",
      status: "pass",
      evidence: [evidence, httpEvidence(`max-age is ${parsed.maxAge} seconds.`)],
      explanation: "HSTS is configured with a long lifetime and covers subdomains.",
      recommendation:
        "Keep the header in place; removing it later takes effect only after the previous max-age expires in each browser.",
    }),
  ];
}
