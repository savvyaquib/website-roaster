/**
 * The analysis page: progress, then the report.
 *
 * A server component, reading the job store directly. It does not fetch its own
 * API — that would be an HTTP round trip inside the same process to obtain data
 * already on disk — but it renders exactly what the API would return, because
 * both read the same record.
 *
 * While the job is not terminal, a small client component polls the API and
 * asks this page to re-render. So progress is live, and the finished report is
 * server-rendered and shareable (which is what Phase 18 builds on).
 */

import Link from "next/link";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getJobStore, isJobId } from "@/lib/jobs";
import type { AnalysisJob } from "@/lib/jobs";
import { isTerminalAnalysisStatus } from "@/lib/types/analysis";
import { categoryLabel, formatDuration, hostOf, statusCopy } from "@/lib/ui/format";

import { FindingRow, RecommendationRow, StrengthRow } from "../../_components/findings";
import { Interpretation, RoastPanel, Screenshots } from "../../_components/narrative";
import { Datum, Empty, Masthead, Section, Shell } from "../../_components/primitives";
import { ProgressView } from "../../_components/progress";
import { CategoryBar, OverallScore } from "../../_components/score-scale";

/** How many ranked problems the report leads with before the full list. */
const TOP_ISSUE_COUNT = 5;

async function loadJob(id: string): Promise<AnalysisJob | null> {
  if (!isJobId(id)) return null;

  try {
    return await getJobStore().get(id);
  } catch {
    // A damaged record is not a missing one, but there is nothing a reader can
    // do about the difference, and the store has already logged it.
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/a/[id]">): Promise<Metadata> {
  const { id } = await params;
  const job = await loadJob(id);

  if (job === null) return { title: "Analysis not found — Website Roaster" };

  const host = job.url === null ? job.submittedUrl : hostOf(job.url);
  const score = job.report?.score.overall.score;

  return {
    title:
      score === undefined
        ? `${host} — Website Roaster`
        : `${host} scored ${score}/100 — Website Roaster`,
  };
}

export default async function AnalysisPage({ params }: PageProps<"/a/[id]">) {
  const { id } = await params;
  const job = await loadJob(id);

  if (job === null) notFound();

  const host = job.url === null ? job.submittedUrl : hostOf(job.url);

  return (
    <>
      <Masthead subtle />

      <main className="flex-1">
        <Shell>
          <div className="border-b border-rule py-6">
            <h1 className="font-mono text-lg break-all">{host}</h1>
            {job.url === null ? null : (
              <p className="mt-1 font-mono text-xs break-all text-ink-muted">{job.url}</p>
            )}
          </div>

          {isTerminalAnalysisStatus(job.status) ? (
            <TerminalView job={job} />
          ) : (
            <ProgressView
              jobId={job.id}
              status={job.status}
              startedAt={job.startedAt ?? job.createdAt}
            />
          )}
        </Shell>
      </main>

      <footer className="border-t border-rule">
        <Shell>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 py-6 text-sm text-ink-muted">
            <Link href="/" className="underline">
              Analyze another page
            </Link>
            <span className="font-mono text-xs break-all">{job.id}</span>
          </div>
        </Shell>
      </footer>
    </>
  );
}

function TerminalView({ job }: { job: AnalysisJob }) {
  if (job.report === null) return <FailureView job={job} />;

  return <Report job={job} report={job.report} />;
}

/**
 * A finished analysis with no report.
 *
 * Every one of these states means something specific, so each gets its own
 * words rather than a shared "something went wrong" (ADR-011, ADR-021).
 */
function FailureView({ job }: { job: AnalysisJob }) {
  const copy = statusCopy(job.status);

  return (
    <div className="py-16">
      <h2 className="text-2xl font-semibold tracking-tight">{copy.heading}</h2>
      <p className="mt-2 max-w-[62ch] text-ink-muted">{copy.detail}</p>

      {job.error === null ? null : (
        <div className="mt-6 max-w-[62ch] border-l-2 border-poor py-1 pl-4">
          <p className="text-sm">{job.error.message}</p>
          <p className="mt-1 font-mono text-xs text-ink-muted">{job.error.code}</p>
        </div>
      )}

      <p className="mt-8 text-sm text-ink-muted">
        Nothing was measured, so there is no score. That is not a verdict on the page.
      </p>

      <Link
        href="/"
        className="mt-6 inline-block rounded-[3px] bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:opacity-90"
      >
        Try another address
      </Link>
    </div>
  );
}

function Report({
  job,
  report,
}: {
  job: AnalysisJob;
  report: NonNullable<AnalysisJob["report"]>;
}) {
  const { score, recommendations, findings } = report;

  const fixes = recommendations.recommendations.filter((item) => item.kind === "fix");
  const topIssues = fixes.slice(0, TOP_ISSUE_COUNT);
  const strengths = findings.filter((finding) => finding.status === "pass");
  const undetermined = findings.filter(
    (finding) => finding.status === "could_not_determine",
  );

  return (
    <>
      <section className="py-10">
        <OverallScore
          score={score.overall.score}
          grade={score.overall.grade}
          explanation={score.overall.explanation}
        />

        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Datum label="HTTP status" value={report.httpStatus} />
          <Datum label="Checks run" value={findings.length} />
          <Datum label="Problems found" value={recommendations.summary.fixes} />
          <Datum label="Analysis time" value={formatDuration(report.durationMs)} />
        </dl>
      </section>

      <Section
        title="Category scores"
        description="Every category on the same scale, so they can be compared by eye. The marks are where the grade changes."
      >
        <div className="space-y-4">
          {score.categories.map((category) => (
            <CategoryBar
              key={category.category}
              label={categoryLabel(category.category)}
              score={category.score}
              grade={category.grade}
              notAssessedReason={category.notAssessedReason}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Top issues"
        count={topIssues.length}
        description="Ranked by how much they matter and how far fixing them moves the score."
      >
        {topIssues.length === 0 ? (
          <Empty>
            No failing or warning checks were found. Every check that ran either passed or
            could not reach a verdict.
          </Empty>
        ) : (
          <div>
            {topIssues.map((recommendation) => (
              <RecommendationRow
                key={recommendation.findingId}
                recommendation={recommendation}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Strengths" count={strengths.length}>
        {strengths.length === 0 ? (
          <Empty>
            No check passed outright. That is unusual, and often means the page could not
            be read properly rather than that everything is wrong.
          </Empty>
        ) : (
          <div>
            {strengths.map((finding) => (
              <StrengthRow key={finding.id} finding={finding} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="All recommendations"
        count={recommendations.summary.total}
        description="Everything found, in priority order, with the evidence behind each one."
      >
        {recommendations.recommendations.length === 0 ? (
          <Empty>There is nothing to recommend: no check failed or warned.</Empty>
        ) : (
          <div>
            {recommendations.recommendations.map((recommendation) => (
              <RecommendationRow
                key={recommendation.findingId}
                recommendation={recommendation}
              />
            ))}
          </div>
        )}
      </Section>

      {undetermined.length === 0 ? null : (
        <Section
          title="Could not be determined"
          count={undetermined.length}
          description="These checks ran but established nothing. They are not passes and not failures, and they do not affect the score."
        >
          <div>
            {undetermined.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                title={(finding.evidence[0]?.summary ?? finding.explanation).replace(
                  /\.$/,
                  "",
                )}
              />
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Interpretation"
        description="Written by a model from the findings above, and checked against them before being shown."
      >
        <Interpretation
          interpretation={report.interpretation}
          unavailableReason={report.interpretationUnavailableReason}
        />
      </Section>

      <Section title="The roast">
        <RoastPanel roast={report.roast} />
      </Section>

      <Section title="Screenshots">
        <Screenshots notRun={report.notRun} />
      </Section>

      <Section title="About this report">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Datum
            label="Final URL"
            value={<span className="break-all">{report.finalUrl}</span>}
          />
          <Datum label="Scoring version" value={score.scoringVersion} />
          <Datum
            label="Analyzed"
            value={new Date(job.createdAt).toISOString().slice(0, 16).replace("T", " ")}
          />
          <Datum
            label="Not run"
            value={report.notRun.length === 0 ? "none" : report.notRun.join(", ")}
          />
        </dl>
      </Section>
    </>
  );
}
