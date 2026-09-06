/**
 * Running one analysis, end to end.
 *
 * Source of truth: docs/ARCHITECTURE.md, docs/DECISIONS.md ADR-011, ADR-016,
 * ADR-021, ADR-036, ADR-057.
 *
 * Takes a URL that has **already been validated** and produces a report, or an
 * explicit reason there is none.
 *
 * ## Every failure has a state, not an exception
 *
 * `runAnalysis` returns an outcome. A timeout is `timeout`, a redirect into
 * private address space is `blocked`, a DNS failure is `failed` — three
 * different things that must not collapse into one (ADR-011, ADR-021). The
 * mapping is not invented here: Phase 1 and Phase 2 already export
 * `analysisStatusForRejection` and `analysisStatusForHttpFailure`.
 *
 * ## What this phase does not run
 *
 * Accessibility, performance and mobile need a real browser and a Lighthouse
 * run (ADR-006, ADR-007, ADR-033). They are **not wired in here**, and their
 * categories come back as *not assessed* with the weights redistributed
 * (ADR-036) rather than as zeros. `notRun` names them in the report, so a
 * reader is told what was skipped instead of quietly seeing a partial score
 * presented as a whole one.
 */

import { resolveAiProviderFromEnv } from "@/lib/ai";
import { AiError } from "@/lib/ai/errors";
import { interpretAnalysis } from "@/lib/ai/interpretation";
import type { AiInterpretation } from "@/lib/ai/interpretation";
import { analyzeContent, extractContent } from "@/lib/analysis/content";
import { extractPageData } from "@/lib/analysis/dom";
import { analysisStatusForHttpFailure, fetchPage } from "@/lib/analysis/http";
import type { HttpResponseData, HttpSecurityPolicy } from "@/lib/analysis/http";
import { analyzeSeo, fetchSiteFiles } from "@/lib/analysis/seo";
import { analyzeSecurity } from "@/lib/analysis/security";
import { analyzeUx, collectUxSignals } from "@/lib/analysis/ux";
import { createLogger } from "@/lib/observability/logger";
import type { Logger } from "@/lib/observability/logger";
import { buildRecommendations } from "@/lib/recommendations";
import { generateRoast } from "@/lib/roast";
import { scoreAnalysis } from "@/lib/scoring";
import type { AnalysisReport } from "@/lib/jobs";
import type { AnalysisStatus } from "@/lib/types/analysis";
import type { Finding } from "@/lib/types/finding";

/** Analyzers this phase does not run, named in every report. */
export const NOT_RUN_IN_THIS_PHASE: readonly string[] = [
  "accessibility",
  "performance",
  "mobile",
];

/** Whole-analysis budget. Generous: a slow site is not a failed one. */
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 60_000;

export type AnalysisOutcome =
  | { readonly status: "completed"; readonly report: AnalysisReport }
  | {
      readonly status: Exclude<AnalysisStatus, "completed" | "queued" | "running">;
      readonly code: string;
      readonly message: string;
    };

export interface RunAnalysisOptions {
  readonly timeoutMs?: number;
  readonly logger?: Logger;
  /** Environment source for AI configuration. Injectable for tests. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Skips the AI call entirely. The deterministic report is unaffected. */
  readonly skipAi?: boolean;
  /**
   * The network policy to fetch under. **Test seam. Do not pass in production.**
   *
   * It exists so an end-to-end test can reach a server on 127.0.0.1, which the
   * production policy correctly refuses. Omitting it uses the public-internet
   * policy, which is the only thing the API ever does — `handleCreateAnalysis`
   * calls the runner with the URL and nothing else, and a test pins that, so
   * there is no path from a request to this field.
   */
  readonly httpPolicy?: HttpSecurityPolicy;
}

/**
 * How the analysis pipeline is run.
 *
 * The API depends on this type rather than on the function below, so a test can
 * drive the whole route without a network.
 */
export type AnalysisRunner = (
  url: string,
  options?: RunAnalysisOptions,
) => Promise<AnalysisOutcome>;

/**
 * Analyze one already-validated URL.
 *
 * @param url the **normalized** URL from `validateUrl`. Passing a raw client
 *   string here would defeat the URL layer, which is why the API stores the
 *   normalized form and reads it back (ADR-057).
 */
export const runAnalysis: AnalysisRunner = async (url, options = {}) => {
  const startedAt = Date.now();
  const log = options.logger ?? createLogger("analysis.pipeline");
  const timeoutMs = options.timeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS;

  log.info("analysis.started", { url });

  const fetched = await fetchPage(url, {
    timeoutMs,
    logger: log,
    ...(options.httpPolicy === undefined ? {} : { policy: options.httpPolicy }),
  });

  if (!fetched.ok) {
    const status = analysisStatusForHttpFailure(fetched.failure.code);
    log.warn("analysis.fetch_failed", { url, code: fetched.failure.code, status });

    // The mapping is Phase 2’s, and its return type already excludes the
    // non-terminal states, so there is nothing to narrow here.
    return { status, code: fetched.failure.code, message: fetched.failure.message };
  }

  const response = fetched.response;

  if (response.body === null) {
    return {
      status: "failed",
      code: "no_html",
      message: "The page responded, but not with HTML, so there was nothing to analyze.",
    };
  }

  const findings = await collectFindings(
    response,
    response.body,
    url,
    log,
    timeoutMs,
    options.httpPolicy,
  );
  const score = scoreAnalysis({ findings });
  const recommendations = buildRecommendations({ findings, score });

  const availability = options.skipAi
    ? undefined
    : resolveAiProviderFromEnv(options.env ?? process.env);

  const roast = await generateRoast(
    availability ?? {
      available: false,
      reason: "AI was not used for this analysis.",
      error: aiSkipped(),
    },
    { url, findings, recommendations },
  );

  const interpretation = await interpret(
    availability,
    url,
    findings,
    score,
    recommendations,
    log,
  );

  log.info("analysis.completed", {
    url,
    findings: findings.length,
    score: score.overall.score,
  });

  return {
    status: "completed",
    report: {
      url,
      finalUrl: response.finalUrl,
      httpStatus: response.status,
      findings,
      score,
      recommendations,
      roast,
      interpretation: interpretation.value,
      interpretationUnavailableReason: interpretation.reason,
      notRun: NOT_RUN_IN_THIS_PHASE,
      durationMs: Date.now() - startedAt,
    },
  };
};

/**
 * Every analyzer this phase runs.
 *
 * One analyzer failing does not fail the analysis: its category is simply not
 * assessed, the weights redistribute (ADR-036), and the report says so. That is
 * the difference between "we could not measure this" and "this scored zero"
 * (ADR-021).
 */
async function collectFindings(
  response: HttpResponseData,
  html: string,
  url: string,
  log: Logger,
  timeoutMs: number,
  httpPolicy: HttpSecurityPolicy | undefined,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const page = extractPageData(html, url);
  const siteFiles = await fetchSiteFiles(url, {
    logger: log,
    fetchOptions: {
      timeoutMs,
      ...(httpPolicy === undefined ? {} : { policy: httpPolicy }),
    },
  });

  const analyzers: { name: string; run: () => Finding[] }[] = [
    { name: "seo", run: () => analyzeSeo({ page, siteFiles }) },
    { name: "security", run: () => analyzeSecurity({ response }) },
    {
      name: "content",
      run: () => analyzeContent({ inventory: extractContent(html, url) }),
    },
    { name: "ux", run: () => analyzeUx({ signals: collectUxSignals(html, url) }) },
  ];

  for (const analyzer of analyzers) {
    try {
      findings.push(...analyzer.run());
    } catch (cause) {
      // The analysis continues. A thrown analyzer is a bug worth logging, not
      // a reason to lose the other three categories.
      log.error("analysis.analyzer_failed", {
        analyzer: analyzer.name,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return findings;
}

async function interpret(
  availability: ReturnType<typeof resolveAiProviderFromEnv> | undefined,
  url: string,
  findings: readonly Finding[],
  score: ReturnType<typeof scoreAnalysis>,
  recommendations: ReturnType<typeof buildRecommendations>,
  log: Logger,
): Promise<{ value: AiInterpretation | null; reason: string | null }> {
  if (availability === undefined) {
    return { value: null, reason: "AI was not used for this analysis." };
  }

  const result = await interpretAnalysis(availability, {
    url,
    findings,
    score,
    recommendations,
  });

  if (result.ok) return { value: result.interpretation, reason: null };

  log.info("analysis.interpretation_unavailable", result.error.toLogFields());

  return { value: null, reason: result.error.userMessage };
}

/** The "AI was not asked" availability, so the roast still gets written. */
function aiSkipped(): AiError {
  return new AiError({
    code: "not_configured",
    provider: "none",
    message: "AI was not used for this analysis.",
  });
}
