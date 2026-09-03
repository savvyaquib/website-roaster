/**
 * Phase 8 — Performance analyzer.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 8, docs/DECISIONS.md ADR-030,
 * ADR-048.
 *
 * Returns two things, deliberately kept apart:
 *
 * - `measurements` — what the engine observed, in its own units;
 * - `findings` — observations drawn from those measurements.
 *
 * Neither is a score. Phase 12 computes the category score from the raw
 * measurements under weights we control, and keeping the layers separate is
 * what makes that score explainable and re-computable without a fresh audit
 * (ADR-002, ADR-012).
 */

import { findingFactory } from "@/lib/analysis/finding-builder";
import type { Finding } from "@/lib/types/finding";

import { emptyMeasurements, extractMeasurements } from "./extract-measurements";
import { normalizeLighthouseReport } from "./normalize";
import type {
  PerformanceAnalysis,
  PerformanceAnalysisInput,
  PerformanceFailure,
} from "./types";

const performanceFinding = findingFactory("performance");

const FAILURE_EXPLANATIONS: Readonly<Record<string, string>> = {
  invalid_url: "The URL could not be analyzed, so no performance audit was run.",
  blocked: "The address cannot be analyzed, so no performance audit was run.",
  browser_unavailable:
    "No browser was available to measure this page, so nothing is claimed about its performance.",
  navigation_failed:
    "The page could not be loaded for measurement, so no metrics were collected.",
  timeout:
    "The performance audit did not finish within its time budget, so its metrics are unknown.",
  audit_error:
    "The engine loaded the page but could not measure it — this usually means the page never rendered content.",
  audit_failed: "The performance engine did not complete, so no metrics were collected.",
  browser_error:
    "The performance audit could not run, so nothing is claimed about this page's performance.",
};

/**
 * Turn an audit into measurements and findings.
 *
 * A missing or failed audit yields empty measurements — every field `null` —
 * and one `could_not_determine` finding. Empty is not zero: a page whose weight
 * was never measured must not look like a page that weighs nothing (ADR-021).
 */
export function analyzePerformance(
  input: PerformanceAnalysisInput = {},
): PerformanceAnalysis {
  const { audit } = input;

  if (audit === undefined) {
    return {
      measurements: emptyMeasurements(),
      findings: [
        notDetermined({
          code: "audit_failed",
          message: "No performance audit was supplied.",
        }),
      ],
    };
  }

  if (!audit.ok) {
    return {
      measurements: emptyMeasurements(),
      findings: [notDetermined(audit.failure)],
    };
  }

  const measurements = extractMeasurements(audit.report);
  const findings = normalizeLighthouseReport(audit.report, measurements);

  return { measurements, findings };
}

function notDetermined(failure: PerformanceFailure): Finding {
  return performanceFinding({
    id: `performance.audit.${failure.code}`,
    severity: "info",
    status: "could_not_determine",
    evidence: [
      {
        kind: "measured",
        source: "lighthouse",
        summary: "The performance audit did not produce measurements.",
        detail: failure.message,
      },
    ],
    explanation:
      FAILURE_EXPLANATIONS[failure.code] ??
      "The performance audit could not run, so nothing is claimed about this page's performance.",
    recommendation:
      "Re-run the analysis. If this keeps happening, measure the page directly with a performance tool.",
  });
}
