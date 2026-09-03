/**
 * Turning an engine report into findings.
 *
 * Source of truth: docs/DECISIONS.md ADR-048.
 *
 * Pure: report and measurements in, `Finding[]` out.
 *
 * ## The engine's score decides status, not severity of ours
 *
 * Lighthouse gives each audit a 0-1 score. That is the **engine's** verdict on
 * that one audit, and it is used here the same way axe's `impact` is used in
 * Phase 7 — to decide whether a finding passes, warns or fails.
 *
 * It is emphatically **not** the Website Roaster score. No number from this
 * module reaches the category score; Phase 12 computes that from the raw
 * measurements under weights we control (ADR-002, ADR-012).
 */

import { findingFactory, preview } from "@/lib/analysis/finding-builder";
import type {
  Evidence,
  Finding,
  FindingSeverity,
  FindingStatus,
} from "@/lib/types/finding";

import { AUDIT_IDS } from "./extract-measurements";
import type { LighthouseAudit, LighthouseReport, PerformanceMeasurements } from "./types";

const performanceFinding = findingFactory("performance");

/** Below this the engine considers an audit failed; above, a pass. */
const PASS_SCORE = 0.9;
const WARN_SCORE = 0.5;

function auditEvidence(summary: string, detail?: string): Evidence {
  return {
    kind: "measured",
    source: "lighthouse",
    summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

/** Map the engine's 0-1 score onto a finding status. */
export function statusForScore(score: number | null | undefined): FindingStatus {
  // A null score means the audit is informational — it reports a number without
  // judging it. That is not a pass, and pretending otherwise would invent a
  // verdict the engine declined to give.
  if (score === null || score === undefined) return "could_not_determine";
  if (score >= PASS_SCORE) return "pass";
  if (score >= WARN_SCORE) return "warn";
  return "fail";
}

/**
 * Severity for a failing audit.
 *
 * Fixed per audit rather than derived from the score: how much a problem
 * matters depends on what it is, not on how far below a threshold it landed.
 */
const AUDIT_SEVERITY: Readonly<Record<string, FindingSeverity>> = {
  [AUDIT_IDS.lcp]: "serious",
  [AUDIT_IDS.cls]: "serious",
  [AUDIT_IDS.tbt]: "serious",
  [AUDIT_IDS.totalByteWeight]: "moderate",
  [AUDIT_IDS.renderBlocking]: "moderate",
  [AUDIT_IDS.imageDelivery]: "moderate",
  [AUDIT_IDS.bootupTime]: "moderate",
  [AUDIT_IDS.mainThread]: "moderate",
  [AUDIT_IDS.unusedJavaScript]: "minor",
  [AUDIT_IDS.cache]: "minor",
  [AUDIT_IDS.documentLatency]: "moderate",
  [AUDIT_IDS.legacyJavaScript]: "minor",
  [AUDIT_IDS.duplicatedJavaScript]: "minor",
  [AUDIT_IDS.serverResponse]: "moderate",
};

/** Audits turned into findings, in report order. */
const REPORTED_AUDITS: readonly string[] = [
  AUDIT_IDS.lcp,
  AUDIT_IDS.cls,
  AUDIT_IDS.tbt,
  AUDIT_IDS.serverResponse,
  AUDIT_IDS.totalByteWeight,
  AUDIT_IDS.renderBlocking,
  AUDIT_IDS.imageDelivery,
  AUDIT_IDS.bootupTime,
  AUDIT_IDS.mainThread,
  AUDIT_IDS.unusedJavaScript,
  AUDIT_IDS.legacyJavaScript,
  AUDIT_IDS.duplicatedJavaScript,
  AUDIT_IDS.cache,
  AUDIT_IDS.documentLatency,
];

function findingForAudit(auditId: string, audit: LighthouseAudit): Finding {
  const status = statusForScore(audit.score);
  const severity: FindingSeverity =
    status === "pass" || status === "could_not_determine"
      ? "info"
      : (AUDIT_SEVERITY[auditId] ?? "moderate");

  const evidence: Evidence[] = [
    auditEvidence(
      audit.displayValue !== undefined && audit.displayValue.length > 0
        ? `${audit.title ?? auditId}: ${audit.displayValue}`
        : `${audit.title ?? auditId} was evaluated.`,
      typeof audit.numericValue === "number"
        ? `${audit.numericValue} ${audit.numericUnit ?? ""}`.trim()
        : undefined,
    ),
  ];

  const affected = audit.details?.items?.length ?? 0;
  if (affected > 0) {
    evidence.push(auditEvidence(`${affected} resource(s) were implicated.`));
  }

  return performanceFinding({
    id: `performance.lighthouse.${auditId}`,
    severity,
    status,
    evidence,
    explanation: preview(audit.description ?? audit.title ?? auditId, 400),
    recommendation:
      status === "pass"
        ? "Keep an eye on this as the page grows; performance regresses quietly."
        : status === "could_not_determine"
          ? "The engine reported this without judging it. Review the measurement yourself."
          : (audit.title ?? "Address this audit."),
  });
}

/**
 * A finding stating what could not be measured.
 *
 * INP always lands here from a lab run, and saying so plainly is better than
 * omitting the metric and letting a reader assume it was fine (ADR-021).
 */
function inpFinding(measurements: PerformanceMeasurements): Finding {
  return performanceFinding({
    id: "performance.inp.not_measurable",
    severity: "info",
    status: "could_not_determine",
    evidence: [
      auditEvidence(
        "Interaction to Next Paint was not measured.",
        measurements.inpUnavailableReason ?? undefined,
      ),
      ...(measurements.tbtMs === null
        ? []
        : [
            auditEvidence(
              `Total Blocking Time, the lab proxy for the same concern, was ${Math.round(measurements.tbtMs)} ms.`,
            ),
          ]),
    ],
    explanation:
      "INP measures how quickly a page responds to real user interactions, so it can only come from real visitors. A synthetic load has nobody to interact with the page.",
    recommendation:
      "Collect INP from real users through field data if you need it. Total Blocking Time is the closest signal available here.",
  });
}

/** A finding carrying the page-weight measurements, whatever the engine scored. */
function pageWeightFinding(measurements: PerformanceMeasurements): Finding {
  const evidence: Evidence[] = [];

  if (measurements.totalByteWeight !== null) {
    evidence.push(
      auditEvidence(
        `The page transferred ${Math.round(measurements.totalByteWeight / 1024)} KiB in total.`,
      ),
    );
  }
  if (measurements.requestCount !== null) {
    evidence.push(auditEvidence(`It made ${measurements.requestCount} request(s).`));
  }
  for (const group of measurements.resourceBreakdown) {
    if (group.type === "total") continue;
    evidence.push(
      auditEvidence(
        `${group.type}: ${group.requestCount} request(s), ${Math.round(group.transferBytes / 1024)} KiB.`,
      ),
    );
  }

  const measured = evidence.length > 0;

  return performanceFinding({
    id: "performance.page_weight.measured",
    severity: "info",
    status: measured ? "pass" : "could_not_determine",
    evidence: measured ? evidence : [auditEvidence("Page weight could not be measured.")],
    explanation: measured
      ? "This records what the page weighed and how many requests it made. Whether that is too much is decided when the score is calculated, not here."
      : "The engine did not report page weight, so nothing is claimed about it.",
    recommendation: measured
      ? "Watch this figure over time; page weight grows one dependency at a time."
      : "Re-run the analysis to collect page weight.",
  });
}

/**
 * Build findings from a report.
 *
 * Audits the engine did not run are skipped rather than reported as passes —
 * an audit that never executed has established nothing.
 */
export function normalizeLighthouseReport(
  report: LighthouseReport,
  measurements: PerformanceMeasurements,
): Finding[] {
  const findings: Finding[] = [];

  for (const auditId of REPORTED_AUDITS) {
    const audit = report.audits?.[auditId];
    if (audit === undefined) continue;

    findings.push(findingForAudit(auditId, audit));
  }

  findings.push(pageWeightFinding(measurements));
  findings.push(inpFinding(measurements));

  return findings;
}
