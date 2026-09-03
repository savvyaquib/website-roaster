/**
 * Extraction of raw measurements from an engine report.
 *
 * Source of truth: docs/DECISIONS.md ADR-012, ADR-030, ADR-048.
 *
 * Pure: report in, measurements out. Values are copied in the engine's own
 * units and are never normalised, rounded into a score, or combined. Anything
 * derived belongs to Phase 12, and the point of keeping this layer dumb is that
 * a later change to the weights cannot silently corrupt the evidence.
 */

import type {
  LighthouseAudit,
  LighthouseReport,
  PerformanceMeasurements,
  ResourceGroup,
} from "./types";

/**
 * Why INP is never produced here.
 *
 * Stated once, and attached to every set of measurements, so the absence is
 * always explained wherever the data travels.
 */
export const INP_UNAVAILABLE_REASON =
  "Interaction to Next Paint is a field metric: it measures response to real user interactions, which a synthetic page load cannot produce. Total Blocking Time is reported instead as the established lab proxy.";

/** Audit identifiers this phase reads, named once so they are greppable. */
export const AUDIT_IDS = {
  lcp: "largest-contentful-paint",
  cls: "cumulative-layout-shift",
  tbt: "total-blocking-time",
  fcp: "first-contentful-paint",
  speedIndex: "speed-index",
  interactive: "interactive",
  serverResponse: "server-response-time",
  totalByteWeight: "total-byte-weight",
  networkRequests: "network-requests",
  resourceSummary: "resource-summary",
  bootupTime: "bootup-time",
  mainThread: "mainthread-work-breakdown",
  unusedJavaScript: "unused-javascript",
  // Lighthouse 13 replaced several legacy opportunity audits with "insight"
  // audits. These identifiers were confirmed against a real report rather than
  // assumed from older documentation.
  renderBlocking: "render-blocking-insight",
  imageDelivery: "image-delivery-insight",
  cache: "cache-insight",
  documentLatency: "document-latency-insight",
  legacyJavaScript: "legacy-javascript-insight",
  duplicatedJavaScript: "duplicated-javascript-insight",
  inpBreakdown: "inp-breakdown-insight",
} as const;

/** A finite numeric value, or null. Never coerces a missing audit to zero. */
function numeric(audit: LighthouseAudit | undefined): number | null {
  const value = audit?.numericValue;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function savingsBytes(audit: LighthouseAudit | undefined): number | null {
  const direct = audit?.details?.overallSavingsBytes;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;

  const items = audit?.details?.items;
  if (items === undefined) return null;

  let total = 0;
  let found = false;
  for (const item of items) {
    const wasted = item["wastedBytes"];
    if (typeof wasted === "number" && Number.isFinite(wasted)) {
      total += wasted;
      found = true;
    }
  }

  return found ? total : null;
}

function itemCount(audit: LighthouseAudit | undefined): number | null {
  const items = audit?.details?.items;
  return Array.isArray(items) ? items.length : null;
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Per-resource-type weight, in the order the engine reported it. */
function resourceBreakdown(audit: LighthouseAudit | undefined): ResourceGroup[] {
  const items = audit?.details?.items;
  if (!Array.isArray(items)) return [];

  const groups: ResourceGroup[] = [];

  for (const item of items) {
    const type = item["resourceType"];
    if (typeof type !== "string") continue;

    groups.push({
      type,
      requestCount: readNumber(item, "requestCount"),
      transferBytes: readNumber(item, "transferSize"),
    });
  }

  return groups;
}

/**
 * Read the raw measurements out of a report.
 *
 * Every field is independent: a missing or malformed audit yields `null` for
 * that one measurement and leaves the rest intact. A partial report is far more
 * useful than none, and it is exactly what a slow or unusual page produces.
 */
export function extractMeasurements(report: LighthouseReport): PerformanceMeasurements {
  const audits = report.audits ?? {};
  const audit = (id: string): LighthouseAudit | undefined => audits[id];

  const renderBlocking = audit(AUDIT_IDS.renderBlocking);

  return {
    lcpMs: numeric(audit(AUDIT_IDS.lcp)),

    // Never measured in a lab run. The reason travels with the data (ADR-030).
    inpMs: null,
    inpUnavailableReason: INP_UNAVAILABLE_REASON,

    clsScore: numeric(audit(AUDIT_IDS.cls)),
    tbtMs: numeric(audit(AUDIT_IDS.tbt)),
    fcpMs: numeric(audit(AUDIT_IDS.fcp)),
    speedIndexMs: numeric(audit(AUDIT_IDS.speedIndex)),
    timeToInteractiveMs: numeric(audit(AUDIT_IDS.interactive)),
    serverResponseMs: numeric(audit(AUDIT_IDS.serverResponse)),

    totalByteWeight: numeric(audit(AUDIT_IDS.totalByteWeight)),
    requestCount: itemCount(audit(AUDIT_IDS.networkRequests)),
    resourceBreakdown: resourceBreakdown(audit(AUDIT_IDS.resourceSummary)),

    javaScriptBootupMs: numeric(audit(AUDIT_IDS.bootupTime)),
    mainThreadWorkMs: numeric(audit(AUDIT_IDS.mainThread)),
    unusedJavaScriptBytes: savingsBytes(audit(AUDIT_IDS.unusedJavaScript)),

    imagePotentialSavingsBytes: savingsBytes(audit(AUDIT_IDS.imageDelivery)),
    renderBlockingWastedMs:
      typeof renderBlocking?.details?.overallSavingsMs === "number"
        ? renderBlocking.details.overallSavingsMs
        : null,
    renderBlockingCount: itemCount(renderBlocking),

    engineName: report.lighthouseVersion === undefined ? null : "lighthouse",
    engineVersion: report.lighthouseVersion ?? null,
    measuredUrl: report.finalDisplayedUrl ?? report.requestedUrl ?? null,
  };
}

/** Measurements for a page that could not be audited: everything unknown. */
export function emptyMeasurements(): PerformanceMeasurements {
  return {
    lcpMs: null,
    inpMs: null,
    inpUnavailableReason: INP_UNAVAILABLE_REASON,
    clsScore: null,
    tbtMs: null,
    fcpMs: null,
    speedIndexMs: null,
    timeToInteractiveMs: null,
    serverResponseMs: null,
    totalByteWeight: null,
    requestCount: null,
    resourceBreakdown: [],
    javaScriptBootupMs: null,
    mainThreadWorkMs: null,
    unusedJavaScriptBytes: null,
    imagePotentialSavingsBytes: null,
    renderBlockingWastedMs: null,
    renderBlockingCount: null,
    engineName: null,
    engineVersion: null,
    measuredUrl: null,
  };
}
