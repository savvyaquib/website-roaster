/**
 * Response-header checks: CSP, X-Content-Type-Options, Referrer-Policy and
 * frame protection.
 *
 * Pure functions over the Phase 2 response.
 */

import type { HttpResponseData } from "@/lib/analysis/http";
import type { Finding } from "@/lib/types/finding";

import { effectiveSources, parseCsp } from "../directives";
import { httpEvidence, preview, securityFinding } from "../finding-builder";
import { RISKY_CSP_SOURCES, UNSAFE_REFERRER_POLICIES } from "../thresholds";

export function checkContentSecurityPolicy(response: HttpResponseData): Finding[] {
  const enforced = response.headers["content-security-policy"];
  const reportOnly = response.headers["content-security-policy-report-only"];

  if (enforced === undefined && reportOnly === undefined) {
    return [
      securityFinding({
        id: "security.csp.absent",
        severity: "moderate",
        status: "fail",
        evidence: [httpEvidence("No Content-Security-Policy header was sent.")],
        explanation:
          "A Content-Security-Policy limits where scripts, styles and other resources may be loaded from. Without one, any script injected into the page — through a vulnerability or a compromised third-party dependency — runs unrestricted.",
        recommendation:
          "Introduce a Content-Security-Policy, starting in report-only mode to find what it would break.",
      }),
    ];
  }

  if (enforced === undefined && reportOnly !== undefined) {
    return [
      securityFinding({
        id: "security.csp.report_only",
        severity: "minor",
        status: "warn",
        evidence: [
          httpEvidence(
            "Only Content-Security-Policy-Report-Only was sent.",
            preview(reportOnly),
          ),
        ],
        explanation:
          "A report-only policy records what it would have blocked but does not block anything, so it provides no protection on its own. This is the correct first step, and is usually meant to be temporary.",
        recommendation:
          "Once the reports are quiet, move the policy to the enforcing Content-Security-Policy header.",
      }),
    ];
  }

  const header = enforced ?? "";
  const directives = parseCsp(header);
  const evidence = httpEvidence(
    "A Content-Security-Policy is enforced.",
    preview(header, 200),
  );

  const scriptSources = effectiveSources(directives, "script-src") ?? [];
  const risky = scriptSources.filter((source) =>
    RISKY_CSP_SOURCES.includes(source.toLowerCase().replace(/^'|'$/g, "")),
  );

  if (risky.length > 0) {
    return [
      securityFinding({
        id: "security.csp.unsafe_script_sources",
        severity: "moderate",
        status: "warn",
        evidence: [
          evidence,
          httpEvidence(
            `The script source list permits ${risky.join(", ")}.`,
            preview(scriptSources.join(" "), 200),
          ),
        ],
        explanation:
          "These sources allow inline or dynamically evaluated script, which is what a content-injection attack relies on. A policy permitting them blocks much less than it appears to.",
        recommendation:
          "Replace inline scripts with external files or nonces, then remove these sources from the policy.",
      }),
    ];
  }

  if (scriptSources.length === 0) {
    return [
      securityFinding({
        id: "security.csp.no_script_restriction",
        severity: "minor",
        status: "warn",
        evidence: [evidence],
        explanation:
          "The policy declares neither script-src nor default-src, so it places no restriction on where scripts may come from.",
        recommendation: "Add a script-src directive, or a default-src to cover it.",
      }),
    ];
  }

  return [
    securityFinding({
      id: "security.csp.present",
      severity: "info",
      status: "pass",
      evidence: [evidence],
      explanation:
        "A Content-Security-Policy is enforced and restricts script sources. This analyzer reads the policy's shape, not whether it is correct for this application.",
      recommendation:
        "Review the policy when adding third-party scripts, so it is tightened rather than widened by default.",
    }),
  ];
}

export function checkContentTypeOptions(response: HttpResponseData): Finding[] {
  const header = response.headers["x-content-type-options"];

  if (header === undefined) {
    return [
      securityFinding({
        id: "security.content_type_options.absent",
        severity: "minor",
        status: "fail",
        evidence: [httpEvidence("No X-Content-Type-Options header was sent.")],
        explanation:
          "Without nosniff, a browser may ignore the declared content type and guess. An uploaded file served as text can then be treated as script.",
        recommendation: "Send X-Content-Type-Options: nosniff on every response.",
      }),
    ];
  }

  if (header.trim().toLowerCase() !== "nosniff") {
    return [
      securityFinding({
        id: "security.content_type_options.invalid",
        severity: "minor",
        status: "warn",
        evidence: [
          httpEvidence("X-Content-Type-Options has an unexpected value.", header),
        ],
        explanation:
          "`nosniff` is the only value browsers act on. Anything else has no effect.",
        recommendation: "Set the header value to exactly nosniff.",
      }),
    ];
  }

  return [
    securityFinding({
      id: "security.content_type_options.ok",
      severity: "info",
      status: "pass",
      evidence: [httpEvidence("X-Content-Type-Options: nosniff is set.")],
      explanation: "Browsers are told not to guess content types on this response.",
      recommendation: "Keep the header on every response, not only on documents.",
    }),
  ];
}

export function checkReferrerPolicy(response: HttpResponseData): Finding[] {
  const header = response.headers["referrer-policy"];

  if (header === undefined) {
    return [
      securityFinding({
        id: "security.referrer_policy.absent",
        severity: "minor",
        status: "warn",
        evidence: [httpEvidence("No Referrer-Policy header was sent.")],
        explanation:
          "Without an explicit policy the browser default applies, which sends the page's address to other sites the visitor navigates to. On pages whose URL contains identifiers, that leaks more than intended.",
        recommendation:
          "Send Referrer-Policy: strict-origin-when-cross-origin, or a stricter value.",
      }),
    ];
  }

  // The last valid token wins, which is how browsers read a list.
  const value = header.split(",").pop()?.trim().toLowerCase() ?? "";

  if (UNSAFE_REFERRER_POLICIES.includes(value)) {
    return [
      securityFinding({
        id: "security.referrer_policy.permissive",
        severity: "minor",
        status: "warn",
        evidence: [httpEvidence("Referrer-Policy is permissive.", header)],
        explanation:
          "This policy sends the full page address to other origins, including any identifiers in the path or query string.",
        recommendation:
          "Use strict-origin-when-cross-origin, which sends only the origin to other sites.",
      }),
    ];
  }

  return [
    securityFinding({
      id: "security.referrer_policy.ok",
      severity: "info",
      status: "pass",
      evidence: [httpEvidence("A Referrer-Policy is declared.", header)],
      explanation: "The page controls what is sent in the Referer header.",
      recommendation: "Keep the policy in place as new pages are added.",
    }),
  ];
}

/**
 * Clickjacking protection.
 *
 * `frame-ancestors` in a CSP supersedes `X-Frame-Options`, so the two are
 * assessed together rather than as separate findings — a site with a correct
 * CSP is fully protected, and reporting a missing legacy header alongside it
 * would be noise.
 */
export function checkFrameProtection(response: HttpResponseData): Finding[] {
  const csp = response.headers["content-security-policy"];
  const frameAncestors = csp === undefined ? undefined : parseCsp(csp)["frame-ancestors"];
  const legacy = response.headers["x-frame-options"];

  if (frameAncestors !== undefined) {
    return [
      securityFinding({
        id: "security.frame_protection.csp",
        severity: "info",
        status: "pass",
        evidence: [
          httpEvidence(
            "The Content-Security-Policy declares frame-ancestors.",
            preview(frameAncestors.join(" ")),
          ),
        ],
        explanation:
          "Framing is controlled by the content security policy, which supersedes X-Frame-Options in browsers that support it.",
        recommendation:
          "Keep frame-ancestors in the policy; X-Frame-Options is only needed for very old browsers.",
      }),
    ];
  }

  if (legacy === undefined) {
    return [
      securityFinding({
        id: "security.frame_protection.absent",
        severity: "moderate",
        status: "fail",
        evidence: [
          httpEvidence(
            "Neither a frame-ancestors directive nor an X-Frame-Options header was sent.",
          ),
        ],
        explanation:
          "Any site can embed this page in an invisible frame and trick a visitor into clicking something they cannot see — a clickjacking attack.",
        recommendation:
          "Add frame-ancestors 'self' to the Content-Security-Policy, or send X-Frame-Options: SAMEORIGIN.",
      }),
    ];
  }

  const value = legacy.trim().toUpperCase();

  if (value.startsWith("ALLOW-FROM")) {
    return [
      securityFinding({
        id: "security.frame_protection.deprecated",
        severity: "minor",
        status: "warn",
        evidence: [httpEvidence("X-Frame-Options uses ALLOW-FROM.", legacy)],
        explanation:
          "ALLOW-FROM was never widely supported and is ignored by current browsers, so this page is effectively unprotected against framing.",
        recommendation:
          "Replace it with a frame-ancestors directive in the Content-Security-Policy.",
      }),
    ];
  }

  if (value !== "DENY" && value !== "SAMEORIGIN") {
    return [
      securityFinding({
        id: "security.frame_protection.invalid",
        severity: "minor",
        status: "warn",
        evidence: [httpEvidence("X-Frame-Options has an unrecognised value.", legacy)],
        explanation:
          "Only DENY and SAMEORIGIN are acted on. An unrecognised value leaves the page unprotected.",
        recommendation: "Use SAMEORIGIN, or move to a frame-ancestors directive.",
      }),
    ];
  }

  return [
    securityFinding({
      id: "security.frame_protection.legacy",
      severity: "info",
      status: "pass",
      evidence: [httpEvidence(`X-Frame-Options is set to ${value}.`)],
      explanation: "Framing is restricted through the legacy header.",
      recommendation:
        "Consider adding frame-ancestors to a Content-Security-Policy, which is the current mechanism.",
    }),
  ];
}
