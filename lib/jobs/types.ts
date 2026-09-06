/**
 * The analysis job record.
 *
 * Source of truth: docs/DECISIONS.md ADR-011, ADR-019, ADR-022, ADR-031,
 * ADR-057.
 *
 * ADR-031: an asynchronous API needs state that outlives a request, so the job
 * store arrives with this phase. Route handlers are stateless, the dev server
 * reloads modules, and module-level state would appear to work locally and fail
 * everywhere else.
 */

import type { AiInterpretation } from "@/lib/ai/interpretation";
import type { RecommendationReport } from "@/lib/recommendations";
import type { Roast } from "@/lib/roast";
import type { ScoreReport } from "@/lib/scoring";
import type { AnalysisStatus } from "@/lib/types/analysis";
import type { Finding } from "@/lib/types/finding";

/**
 * Bumped when the stored shape changes incompatibly.
 *
 * A record written by an older version is readable or it is not; guessing is
 * how a report from last week starts rendering wrong numbers (ADR-022).
 */
export const JOB_SCHEMA_VERSION = 1;

/** Why a job ended without a report. Both fields are safe to show a client. */
export interface JobError {
  /** Stable, machine-readable. Clients branch on this, never on the message. */
  readonly code: string;
  /** Plain language, written for the person who submitted the URL. */
  readonly message: string;
}

/**
 * A finished analysis.
 *
 * A snapshot: the findings, the score computed from them, the ranking, the
 * roast, and the AI interpretation when there was one. Stored whole so a report
 * can be re-read without re-running anything (ADR-012, ADR-022).
 */
export interface AnalysisReport {
  /** The normalized URL that was actually analyzed. */
  readonly url: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly findings: readonly Finding[];
  readonly score: ScoreReport;
  readonly recommendations: RecommendationReport;
  readonly roast: Roast;
  /** Null when AI was unavailable or its answer was refused (ADR-016). */
  readonly interpretation: AiInterpretation | null;
  /** Why there is no interpretation. Null when there is one. */
  readonly interpretationUnavailableReason: string | null;
  /** Analyzers that did not run in this phase, named rather than hidden. */
  readonly notRun: readonly string[];
  readonly durationMs: number;
}

export interface AnalysisJob {
  /** An unguessable identifier. Also the store's filename, so it is validated. */
  readonly id: string;
  readonly status: AnalysisStatus;
  /**
   * The normalized URL from the validator.
   *
   * Null only when validation refused the submission. **Everything downstream
   * uses this, never `submittedUrl`** — that is what stops a client smuggling
   * an unvalidated target past the URL layer (ADR-057).
   */
  readonly url: string | null;
  /**
   * What the client actually sent, truncated.
   *
   * Kept so an `invalid_url` refusal can show the user what they typed. Never
   * fetched, never resolved, never used as an input to anything.
   */
  readonly submittedUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: JobError | null;
  readonly report: AnalysisReport | null;
  readonly schemaVersion: number;
}

/** The fields a running analysis is allowed to change. */
export type JobPatch = Partial<
  Pick<AnalysisJob, "status" | "startedAt" | "finishedAt" | "error" | "report" | "url">
>;

/**
 * Where job state lives.
 *
 * Deliberately tiny. ADR-031 requires the simplest thing that survives a
 * process restart, and a store this narrow can be swapped for SQLite when
 * Phase 19 needs history and retention, without a route changing.
 */
export interface JobStore {
  create(job: AnalysisJob): Promise<void>;
  get(id: string): Promise<AnalysisJob | null>;
  /** @returns the updated job, or null when the id is unknown. */
  update(id: string, patch: JobPatch): Promise<AnalysisJob | null>;
}
