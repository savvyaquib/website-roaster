/**
 * Phase 7 — Accessibility analyzer.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 7, docs/DECISIONS.md ADR-047.
 *
 * Normalizes the results of an established accessibility engine into the
 * Website Roaster finding model. The standard itself is not reimplemented — the
 * engine is the authority on the rules, and this phase's job is to carry its
 * verdicts across without losing the trail back to them.
 *
 * ## Automated testing is a floor, not a ceiling
 *
 * Automated tooling can only reach a fraction of the accessibility success
 * criteria. It cannot tell whether alt text is *meaningful*, whether a reading
 * order makes sense, or whether a custom control is usable with a screen
 * reader.
 *
 * So this analyzer never reports that a page is accessible. Passing rules are
 * summarised as "these automated checks found no problem", which is the honest
 * claim. The same reasoning as ADR-046 applies: a section that reads as a clean
 * bill of health invites someone to stop looking.
 *
 * ## Pure
 *
 * `analyzeAccessibility` performs no I/O. `runAxe` produces the audit and this
 * turns it into findings, which keeps the mapping deterministic and testable.
 */

import { findingFactory } from "@/lib/analysis/finding-builder";
import type { Finding } from "@/lib/types/finding";

import { normalizeAxeResults } from "./normalize";
import type { AccessibilityAnalysisInput, AccessibilityFailure } from "./types";

const accessibilityFinding = findingFactory("accessibility");

/** How each failure is explained to the person who submitted the URL. */
const FAILURE_EXPLANATIONS: Readonly<Record<string, string>> = {
  invalid_url: "The URL could not be analyzed, so no accessibility audit was run.",
  blocked: "The address cannot be analyzed, so no accessibility audit was run.",
  browser_unavailable:
    "No browser was available to run the accessibility audit, so nothing is claimed about this page's accessibility.",
  navigation_failed:
    "The page could not be loaded in a browser, so the accessibility audit did not run.",
  timeout:
    "The accessibility audit did not finish within its time budget, so its results are unknown.",
  engine_injection_failed:
    "The accessibility engine could not be loaded into the page — a strict Content-Security-Policy will do this — so the audit did not run.",
  audit_failed: "The accessibility engine did not complete, so its results are unknown.",
  browser_error:
    "The accessibility audit could not run, so nothing is claimed about this page's accessibility.",
};

/**
 * Turn an audit into findings.
 *
 * When the audit is missing or failed, a single `could_not_determine` finding
 * is returned. That is deliberate: dropping the section would let a reader
 * assume accessibility was fine, and reporting a pass would be a lie (ADR-021).
 */
export function analyzeAccessibility(input: AccessibilityAnalysisInput = {}): Finding[] {
  const { audit } = input;

  if (audit === undefined) {
    return [
      notDetermined({
        code: "audit_failed",
        message: "No accessibility audit was supplied.",
      }),
    ];
  }

  if (!audit.ok) return [notDetermined(audit.failure)];

  const findings = normalizeAxeResults(audit.results);

  // An audit that ran and found nothing at all is itself worth reporting, so
  // the section is never silently empty.
  if (findings.length === 0) {
    return [
      accessibilityFinding({
        id: "accessibility.axe.no_results",
        severity: "info",
        status: "could_not_determine",
        evidence: [
          {
            kind: "measured",
            source: "axe",
            summary: "The audit ran but reported no rule results.",
          },
        ],
        explanation:
          "The accessibility engine completed without evaluating any rules, which usually means the page had no content to test.",
        recommendation: "Confirm the page renders content, then run the analysis again.",
      }),
    ];
  }

  return findings;
}

function notDetermined(failure: AccessibilityFailure): Finding {
  return accessibilityFinding({
    id: `accessibility.audit.${failure.code}`,
    severity: "info",
    status: "could_not_determine",
    evidence: [
      {
        kind: "measured",
        source: "axe",
        summary: "The accessibility audit did not produce results.",
        detail: failure.message,
      },
    ],
    explanation:
      FAILURE_EXPLANATIONS[failure.code] ??
      "The accessibility audit could not run, so nothing is claimed about this page's accessibility.",
    recommendation:
      "Re-run the analysis. If this keeps happening, test the page with an accessibility tool directly.",
  });
}
