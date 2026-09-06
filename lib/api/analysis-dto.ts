/**
 * What the API says about a job.
 *
 * Source of truth: CLAUDE.md § API DESIGN, ADR-011, ADR-018, ADR-057.
 *
 * ## The DTO is built, not filtered
 *
 * Every field is named explicitly. Nothing is spread from the stored record, so
 * a field added to `AnalysisJob` later cannot appear in an API response because
 * somebody forgot to exclude it. That direction matters: a filter fails open,
 * and a whitelist fails closed.
 *
 * ## Independent of the frontend
 *
 * This is data, not presentation. No colours, no labels, no formatted dates, no
 * copy for a screen. Phase 17 decides how a `blocked` job looks; the API's job
 * is to say that it is blocked and why.
 */

import type { AnalysisJob, AnalysisReport } from "@/lib/jobs";
import type { AnalysisStatus } from "@/lib/types/analysis";
import { isTerminalAnalysisStatus } from "@/lib/types/analysis";

export interface AnalysisJobDto {
  readonly id: string;
  readonly status: AnalysisStatus;
  /** True when the status will never change again — stop polling (ADR-011). */
  readonly terminal: boolean;
  /** The normalized URL under analysis. Null when the submission was refused. */
  readonly url: string | null;
  readonly submittedUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly report: AnalysisReport | null;
}

/** The public view of a job. */
export function toAnalysisJobDto(job: AnalysisJob): AnalysisJobDto {
  return {
    id: job.id,
    status: job.status,
    terminal: isTerminalAnalysisStatus(job.status),
    url: job.url,
    submittedUrl: job.submittedUrl,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error:
      job.error === null ? null : { code: job.error.code, message: job.error.message },
    report: job.report,
  };
}
