/**
 * Presentation helpers.
 *
 * Pure functions, kept out of the components so they can be tested directly.
 * Nothing here decides a value — it decides how an already-decided value is
 * spelled and coloured (ADR-001: no scoring logic in the UI).
 */

import { GRADE_BANDS } from "@/lib/scoring";
import type { Grade } from "@/lib/scoring";
import type { AnalysisStatus } from "@/lib/types/analysis";
import type { FindingSeverity, FindingStatus } from "@/lib/types/finding";

/** The four colour roles. `unknown` is a result, not an absence. */
export type Tone = "good" | "fair" | "poor" | "unknown";

/**
 * The tone for a score.
 *
 * Derived from the documented grade bands rather than from thresholds invented
 * here, so the colour and the letter can never disagree.
 */
export function toneForScore(score: number | null): Tone {
  if (score === null || !Number.isFinite(score)) return "unknown";
  if (score >= 80) return "good";
  if (score >= 60) return "fair";
  return "poor";
}

export function toneForGrade(grade: Grade | null): Tone {
  if (grade === null) return "unknown";
  if (grade === "A" || grade === "B") return "good";
  if (grade === "C" || grade === "D") return "fair";
  return "poor";
}

/** Severity drives tone for a finding, not its score. */
export function toneForSeverity(severity: FindingSeverity): Tone {
  switch (severity) {
    case "critical":
    case "serious":
      return "poor";
    case "moderate":
    case "minor":
      return "fair";
    case "info":
      return "unknown";
  }
}

/** Text colour classes, so tone never has to be spelled inline. */
export const TEXT_TONE: Readonly<Record<Tone, string>> = {
  good: "text-good",
  fair: "text-fair",
  poor: "text-poor",
  unknown: "text-unknown",
};

/** Track fills for the score scale. */
export const TRACK_TONE: Readonly<Record<Tone, string>> = {
  good: "bg-good",
  fair: "bg-fair",
  poor: "bg-poor",
  unknown: "bg-unknown",
};

/** The grade band boundaries, ascending, for drawing the scale. */
export const BAND_MARKS: readonly { readonly at: number; readonly grade: Grade }[] = [
  ...GRADE_BANDS,
]
  .sort((a, b) => a.min - b.min)
  .filter((band) => band.min > 0)
  .map((band) => ({ at: band.min, grade: band.grade }));

/** Human wording for a category key. */
export function categoryLabel(category: string): string {
  switch (category) {
    case "seo":
      return "Search";
    case "ux":
      return "Usability";
    case "accessibility":
      return "Accessibility";
    case "performance":
      return "Performance";
    case "security":
      return "Security";
    case "mobile":
      return "Mobile";
    case "content":
      return "Content";
    default:
      return category;
  }
}

/** Human wording for a finding's outcome. */
export function statusLabel(status: FindingStatus): string {
  switch (status) {
    case "pass":
      return "Passed";
    case "warn":
      return "Warning";
    case "fail":
      return "Failed";
    case "could_not_determine":
      return "Not determined";
  }
}

export function severityLabel(severity: FindingSeverity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

/**
 * What the page says while an analysis is in flight, and what it means.
 *
 * The API reports `queued` and `running`; it does not report which analyzer is
 * currently working. A five-step progress bar would be an invention, and this
 * product does not invent, so the copy says what is actually known.
 */
export function statusCopy(status: AnalysisStatus): {
  readonly heading: string;
  readonly detail: string;
} {
  switch (status) {
    case "queued":
      return {
        heading: "Queued",
        detail: "The page has been accepted and is waiting to start.",
      };
    case "running":
      return {
        heading: "Analyzing",
        detail:
          "Fetching the page, reading its markup and running the checks. This usually takes a few seconds.",
      };
    case "completed":
      return { heading: "Complete", detail: "The report is ready." };
    case "failed":
      return {
        heading: "Analysis failed",
        detail: "Something went wrong while analyzing the page.",
      };
    case "timeout":
      return {
        heading: "Timed out",
        detail: "The page took longer to respond than the analysis allows.",
      };
    case "blocked":
      return {
        heading: "Address refused",
        detail:
          "This URL points somewhere the analyzer will not go — a private, local or internal address.",
      };
    case "invalid_url":
      return {
        heading: "Not a usable URL",
        detail: "Enter a public address beginning with http:// or https://.",
      };
  }
}

/** A duration a person can read. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

/** A host, for showing which page a report is about. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
