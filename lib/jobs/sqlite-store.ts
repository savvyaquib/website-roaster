/**
 * The job store, backed by SQLite.
 *
 * Source of truth: ADR-031, ADR-057, ADR-060.
 *
 * Replaces the file-per-job store Phase 16 shipped. ADR-057 chose that one
 * because every access was by primary key and nothing needed a query; this
 * phase adds history and retention, which is exactly where indexed reads and
 * transactions start to matter, and the `JobStore` interface existed so the
 * swap would cost one file.
 *
 * ## Writing decomposes, reading recomposes
 *
 * A report is not stored as one blob. Findings and category scores get their
 * own rows, and **recommendations and roast lines get no rows at all** — both
 * are pure functions of the findings and the score, so storing them would be
 * storing a third and fourth copy of every finding (the duplication ADR-057
 * recorded as a known limitation).
 *
 * What a *model* wrote is stored, because it cannot be derived from anything:
 * punchlines and interpretation prose, each against a finding id. Reading
 * rebuilds the full `AnalysisReport` by joining prose back to facts, so nothing
 * upstream of the store knows this happened.
 */

import type { DatabaseSync } from "node:sqlite";

import type { AiInterpretation } from "@/lib/ai/interpretation";
import { buildRecommendations } from "@/lib/recommendations";
import { observationFor } from "@/lib/roast";
import type { Roast, RoastLine } from "@/lib/roast";
import type { CategoryScore, ScoreReport } from "@/lib/scoring";
import type { AnalysisStatus } from "@/lib/types/analysis";
import type { Finding } from "@/lib/types/finding";

import { isJobId } from "./id";
import type { AnalysisJob, AnalysisReport, JobPatch, JobStore } from "./types";

/** Keep analyses for four weeks unless a deployment says otherwise. */
export const DEFAULT_RETENTION_DAYS = 30;

/** How often a write may trigger a retention sweep. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface SqliteJobStoreOptions {
  readonly db: DatabaseSync;
  /** Days to keep an analysis. Zero or below keeps everything. */
  readonly retentionDays?: number;
  readonly now?: () => Date;
}

export interface SqliteJobStore extends JobStore {
  /** Delete analyses older than the retention window. @returns rows removed. */
  pruneExpired(): number;
  /** Ids most recently created first. For history and for tests. */
  listRecent(limit: number): string[];
  /** Analyses currently stored. */
  count(): number;
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface AnalysisRow {
  id: string;
  status: string;
  url: string | null;
  submitted_url: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  record_version: number;
  final_url: string | null;
  http_status: number | null;
  duration_ms: number | null;
  not_run: string | null;
  scoring_version: number | null;
  overall_score: number | null;
  overall_grade: string | null;
  overall_explanation: string | null;
  assessed_categories: string | null;
  not_assessed_categories: string | null;
  overall_weighting: string | null;
  performance_metrics: string | null;
  interpretation: string | null;
  interpretation_unavailable_reason: string | null;
  roast: string | null;
}

interface FindingRow {
  finding_id: string;
  category: string;
  severity: string;
  status: string;
  explanation: string;
  recommendation: string | null;
  evidence: string;
}

interface CategoryRow {
  category: string;
  status: string;
  score: number | null;
  grade: string | null;
  method: string;
  finding_count: number;
  total_deducted: number;
  deductions: string;
  metrics: string;
  not_assessed_reason: string | null;
  explanation: string;
}

/** The model's words, kept against the finding they are about. */
interface StoredRoast {
  readonly source: Roast["source"];
  readonly fallbackReason: string | null;
  readonly note: string | null;
  readonly meta: Roast["meta"];
  readonly lines: readonly { findingId: string; punchline: string }[];
}

interface StoredInterpretation {
  readonly executiveSummary: string;
  readonly meta: AiInterpretation["meta"];
  readonly strengths: readonly { findingId: string; whyItHelps: string }[];
  readonly problems: readonly {
    findingId: string;
    whyItMatters: string;
    recommendation: string;
  }[];
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parse<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;

  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------

export function createSqliteJobStore(options: SqliteJobStoreOptions): SqliteJobStore {
  const { db } = options;
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const now = options.now ?? (() => new Date());

  let lastSweep = 0;

  const statements = {
    insertAnalysis: db.prepare(`
      INSERT INTO analyses (
        id, status, url, submitted_url, created_at, updated_at, started_at,
        finished_at, error_code, error_message, record_version, final_url,
        http_status, duration_ms, not_run, scoring_version, overall_score,
        overall_grade, overall_explanation, assessed_categories,
        not_assessed_categories, overall_weighting, performance_metrics,
        interpretation, interpretation_unavailable_reason, roast
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `),
    deleteAnalysis: db.prepare("DELETE FROM analyses WHERE id = ?"),
    selectAnalysis: db.prepare("SELECT * FROM analyses WHERE id = ?"),
    selectFindings: db.prepare(
      "SELECT * FROM findings WHERE analysis_id = ? ORDER BY position",
    ),
    selectCategories: db.prepare(
      "SELECT * FROM category_scores WHERE analysis_id = ? ORDER BY position",
    ),
    insertFinding: db.prepare(`
      INSERT INTO findings (
        analysis_id, position, finding_id, category, severity, status,
        explanation, recommendation, evidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertCategory: db.prepare(`
      INSERT INTO category_scores (
        analysis_id, position, category, status, score, grade, method,
        finding_count, total_deducted, deductions, metrics,
        not_assessed_reason, explanation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    prune: db.prepare("DELETE FROM analyses WHERE created_at < ?"),
    listRecent: db.prepare("SELECT id FROM analyses ORDER BY created_at DESC LIMIT ?"),
    count: db.prepare("SELECT COUNT(*) AS n FROM analyses"),
  };

  /** Write a job, replacing anything already stored under its id. */
  function write(job: AnalysisJob): void {
    db.exec("BEGIN");

    try {
      // Findings and scores go with it, by cascade.
      statements.deleteAnalysis.run(job.id);

      const report = job.report;
      const roast: StoredRoast | null =
        report === null
          ? null
          : {
              source: report.roast.source,
              fallbackReason: report.roast.fallbackReason,
              note: report.roast.note,
              meta: report.roast.meta,
              lines: report.roast.lines.map((line) => ({
                findingId: line.finding.id,
                punchline: line.punchline,
              })),
            };

      const interpretation: StoredInterpretation | null =
        report === null || report.interpretation === null
          ? null
          : {
              executiveSummary: report.interpretation.executiveSummary,
              meta: report.interpretation.meta,
              strengths: report.interpretation.strengths.map((strength) => ({
                findingId: strength.finding.id,
                whyItHelps: strength.whyItHelps,
              })),
              problems: report.interpretation.problems.map((problem) => ({
                findingId: problem.finding.id,
                whyItMatters: problem.whyItMatters,
                recommendation: problem.recommendation,
              })),
            };

      statements.insertAnalysis.run(
        job.id,
        job.status,
        job.url,
        job.submittedUrl,
        job.createdAt,
        job.updatedAt,
        job.startedAt,
        job.finishedAt,
        job.error?.code ?? null,
        job.error?.message ?? null,
        job.schemaVersion,
        report?.finalUrl ?? null,
        report?.httpStatus ?? null,
        report?.durationMs ?? null,
        report === null ? null : json(report.notRun),
        report?.score.scoringVersion ?? null,
        report?.score.overall.score ?? null,
        report?.score.overall.grade ?? null,
        report?.score.overall.explanation ?? null,
        report === null ? null : json(report.score.overall.assessedCategories),
        report === null ? null : json(report.score.overall.notAssessedCategories),
        report === null ? null : json(report.score.overall.weighting),
        // Raw metrics live on the Performance category's contributions, which
        // are stored with it. There is no separate blob to keep.
        null,
        interpretation === null ? null : json(interpretation),
        report?.interpretationUnavailableReason ?? null,
        roast === null ? null : json(roast),
      );

      report?.findings.forEach((finding, position) => {
        statements.insertFinding.run(
          job.id,
          position,
          finding.id,
          finding.category,
          finding.severity,
          finding.status,
          finding.explanation,
          finding.recommendation ?? null,
          json(finding.evidence),
        );
      });

      report?.score.categories.forEach((category, position) => {
        statements.insertCategory.run(
          job.id,
          position,
          category.category,
          category.status,
          category.score,
          category.grade,
          category.method,
          category.findingCount,
          category.totalDeducted,
          json(category.deductions),
          json(category.metrics),
          category.notAssessedReason,
          category.explanation,
        );
      });

      db.exec("COMMIT");
    } catch (cause) {
      db.exec("ROLLBACK");
      throw cause;
    }
  }

  /** Rebuild the report a caller expects from the rows that were kept. */
  function read(id: string): AnalysisJob | null {
    const row = statements.selectAnalysis.get(id) as unknown as AnalysisRow | undefined;
    if (row === undefined) return null;

    const base = {
      id: row.id,
      status: row.status as AnalysisStatus,
      url: row.url,
      submittedUrl: row.submitted_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error:
        row.error_code === null
          ? null
          : { code: row.error_code, message: row.error_message ?? "" },
      schemaVersion: row.record_version,
    };

    if (row.scoring_version === null) {
      return { ...base, report: null };
    }

    const findings = (statements.selectFindings.all(id) as unknown as FindingRow[]).map(
      (finding): Finding => ({
        id: finding.finding_id,
        category: finding.category as Finding["category"],
        severity: finding.severity as Finding["severity"],
        status: finding.status as Finding["status"],
        evidence: parse(finding.evidence, []),
        explanation: finding.explanation,
        ...(finding.recommendation === null
          ? {}
          : { recommendation: finding.recommendation }),
      }),
    );

    const categories = (
      statements.selectCategories.all(id) as unknown as CategoryRow[]
    ).map((category): CategoryScore => ({
      category: category.category as CategoryScore["category"],
      status: category.status as CategoryScore["status"],
      score: category.score,
      grade: category.grade as CategoryScore["grade"],
      method: category.method as CategoryScore["method"],
      findingCount: category.finding_count,
      deductions: parse(category.deductions, []),
      totalDeducted: category.total_deducted,
      metrics: parse(category.metrics, []),
      notAssessedReason: category.not_assessed_reason,
      explanation: category.explanation,
    }));

    const score: ScoreReport = {
      scoringVersion: row.scoring_version,
      overall: {
        score: row.overall_score,
        grade: row.overall_grade as ScoreReport["overall"]["grade"],
        weighting: parse(row.overall_weighting, []),
        assessedCategories: parse(row.assessed_categories, []),
        notAssessedCategories: parse(row.not_assessed_categories, []),
        explanation: row.overall_explanation ?? "",
      },
      categories,
    };

    // Derived on read rather than stored: pure over the findings and the score,
    // both of which are above (ADR-060).
    const recommendations = buildRecommendations({ findings, score });
    const findingsById = new Map(findings.map((finding) => [finding.id, finding]));

    const report: AnalysisReport = {
      url: row.url ?? "",
      finalUrl: row.final_url ?? "",
      httpStatus: row.http_status ?? 0,
      findings,
      score,
      recommendations,
      roast: rebuildRoast(parse<StoredRoast | null>(row.roast, null), findingsById),
      interpretation: rebuildInterpretation(
        parse<StoredInterpretation | null>(row.interpretation, null),
        findingsById,
        recommendations,
      ),
      interpretationUnavailableReason: row.interpretation_unavailable_reason,
      notRun: parse(row.not_run, []),
      durationMs: row.duration_ms ?? 0,
    };

    return { ...base, report };
  }

  function maybePrune(): void {
    if (retentionDays <= 0) return;

    const current = now().getTime();
    if (current - lastSweep < SWEEP_INTERVAL_MS) return;

    lastSweep = current;
    pruneExpired();
  }

  /**
   * Delete what the retention window no longer covers.
   *
   * ADR-020 rules out a scheduler, and this application has no cron. Sweeping
   * opportunistically on write, at most hourly, keeps the store bounded without
   * new infrastructure — an installation that stops being used stops growing,
   * which is the only case where a missed sweep matters.
   */
  function pruneExpired(): number {
    if (retentionDays <= 0) return 0;

    const cutoff = new Date(now().getTime() - retentionDays * 24 * 60 * 60 * 1000);

    return Number(statements.prune.run(cutoff.toISOString()).changes);
  }

  return {
    create(job) {
      write(job);
      maybePrune();
      return Promise.resolve();
    },

    get(id) {
      if (!isJobId(id)) return Promise.resolve(null);

      return Promise.resolve(read(id));
    },

    update(id, patch: JobPatch) {
      if (!isJobId(id)) return Promise.resolve(null);

      const existing = read(id);
      if (existing === null) return Promise.resolve(null);

      const updated: AnalysisJob = {
        ...existing,
        ...patch,
        updatedAt: now().toISOString(),
      };

      write(updated);
      return Promise.resolve(updated);
    },

    pruneExpired,

    listRecent(limit) {
      return (statements.listRecent.all(limit) as unknown as { id: string }[]).map(
        (row) => row.id,
      );
    },

    count() {
      return Number((statements.count.get() as unknown as { n: number }).n);
    },
  };
}

/**
 * Put the roast back together.
 *
 * A punchline whose finding is missing is dropped rather than shown against
 * nothing: the observation half of a roast line comes from the finding, and a
 * joke with no fact above it is exactly what Phase 15 was built to prevent.
 */
function rebuildRoast(
  stored: StoredRoast | null,
  findingsById: ReadonlyMap<string, Finding>,
): Roast {
  if (stored === null) {
    return {
      lines: [],
      source: "deterministic",
      fallbackReason: null,
      note: null,
      meta: null,
    };
  }

  const lines: RoastLine[] = [];

  for (const line of stored.lines) {
    const finding = findingsById.get(line.findingId);
    if (finding === undefined) continue;

    lines.push({
      finding,
      observation: observationFor(finding),
      punchline: line.punchline,
    });
  }

  return {
    lines,
    source: stored.source,
    fallbackReason: stored.fallbackReason,
    note: stored.note,
    meta: stored.meta,
  };
}

function rebuildInterpretation(
  stored: StoredInterpretation | null,
  findingsById: ReadonlyMap<string, Finding>,
  recommendations: ReturnType<typeof buildRecommendations>,
): AiInterpretation | null {
  if (stored === null) return null;

  const ranks = new Map(
    recommendations.recommendations.map((item) => [item.findingId, item.rank]),
  );

  return {
    executiveSummary: stored.executiveSummary,
    meta: stored.meta,
    strengths: stored.strengths.flatMap((strength) => {
      const finding = findingsById.get(strength.findingId);
      return finding === undefined ? [] : [{ finding, whyItHelps: strength.whyItHelps }];
    }),
    problems: stored.problems.flatMap((problem) => {
      const finding = findingsById.get(problem.findingId);

      return finding === undefined
        ? []
        : [
            {
              finding,
              whyItMatters: problem.whyItMatters,
              recommendation: problem.recommendation,
              deterministicRank: ranks.get(problem.findingId) ?? null,
            },
          ];
    }),
  };
}
