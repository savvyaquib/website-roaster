/**
 * The analysis API, without HTTP.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 16, CLAUDE.md § API DESIGN,
 * ADR-011, ADR-021, ADR-031, ADR-057.
 *
 * Route files are three lines each and delegate here. Everything that decides
 * anything — validation, job creation, status codes, what a client is told —
 * lives in this module, which takes a `Request` and returns a `Response` and
 * knows nothing about Next.js, React or how a page renders.
 *
 * That is what "keep the API independent from frontend presentation" means in
 * practice, and it is also what makes the integration tests real: they drive
 * the same function the route does, with the same `Request`.
 */

import { analysisStatusForRejection, validateUrl } from "@/lib/analysis/url";
import { createLogger } from "@/lib/observability/logger";
import type { Logger } from "@/lib/observability/logger";
import { createJobId, getJobStore, isJobId } from "@/lib/jobs";
import type { AnalysisJob, JobStore } from "@/lib/jobs";
import { JOB_SCHEMA_VERSION } from "@/lib/jobs";
import { runAnalysis } from "@/lib/pipeline";
import type { AnalysisRunner } from "@/lib/pipeline";

import { toAnalysisJobDto } from "./analysis-dto";
import {
  apiError,
  INTERNAL_ERROR_MESSAGE,
  STATUS_FOR_CODE,
  type ApiErrorCode,
} from "./errors";

/** Largest request body accepted. A URL does not need more than this. */
export const MAX_BODY_BYTES = 4096;

/** How much of a rejected submission is kept, for showing the user. */
const MAX_SUBMITTED_URL_LENGTH = 500;

export interface AnalysisApiDeps {
  readonly store?: JobStore;
  readonly runner?: AnalysisRunner;
  readonly logger?: Logger;
  readonly now?: () => Date;
  /**
   * Receives the background execution promise.
   *
   * Production ignores it — the point of the async API is that the response
   * does not wait. Tests use it to await completion instead of polling, which
   * keeps them deterministic rather than timing-dependent.
   */
  readonly onStarted?: (execution: Promise<void>) => void;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // A report is per-job state that changes while it runs; a cached 202
      // would strand a client on "queued" forever.
      "cache-control": "no-store",
    },
  });
}

function errorResponse(
  code: ApiErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): Response {
  return json(apiError(code, message, details), STATUS_FOR_CODE[code]);
}

// ---------------------------------------------------------------------------
// POST — start an analysis
// ---------------------------------------------------------------------------

type BodyResult =
  | { readonly ok: true; readonly url: unknown }
  | { readonly ok: false; readonly response: Response };

/**
 * Read `{ "url": ... }` out of a request.
 *
 * Every failure here is the client's, and each gets its own code: a client
 * cannot fix "bad request", but it can fix "the body was not JSON".
 */
async function readBody(request: Request): Promise<BodyResult> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse(
        "payload_too_large",
        `The request body must be ${MAX_BODY_BYTES} bytes or fewer.`,
      ),
    };
  }

  let text: string;

  try {
    text = await request.text();
  } catch {
    return {
      ok: false,
      response: errorResponse("invalid_body", "The request body could not be read."),
    };
  }

  // Checked again after reading: content-length is a claim, not a guarantee.
  if (text.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse(
        "payload_too_large",
        `The request body must be ${MAX_BODY_BYTES} bytes or fewer.`,
      ),
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      response: errorResponse("invalid_json", "The request body must be valid JSON."),
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      response: errorResponse(
        "invalid_body",
        'The request body must be a JSON object with a "url" property.',
      ),
    };
  }

  return { ok: true, url: (parsed as Record<string, unknown>).url };
}

/**
 * Start an analysis.
 *
 * A refused submission still becomes a job. ADR-011 makes `invalid_url` and
 * `blocked` analysis *states*, so a refusal is an analysis that was refused,
 * retrievable at its own URL like any other. The response carries the error
 * immediately as well, so a client never has to poll to learn it typed
 * something wrong.
 */
export async function handleCreateAnalysis(
  request: Request,
  deps: AnalysisApiDeps = {},
): Promise<Response> {
  const log = deps.logger ?? createLogger("api.analyze");
  const now = deps.now ?? (() => new Date());

  try {
    const body = await readBody(request);
    if (!body.ok) return body.response;

    const store = deps.store ?? getJobStore();
    const validation = validateUrl(body.url);
    const timestamp = now().toISOString();

    const submittedUrl =
      typeof body.url === "string" ? body.url.slice(0, MAX_SUBMITTED_URL_LENGTH) : "";

    if (!validation.valid) {
      const status = analysisStatusForRejection(validation.code);
      const job: AnalysisJob = {
        id: createJobId(),
        status,
        // Never the submitted string: nothing downstream may treat an
        // unvalidated value as a target (ADR-057).
        url: null,
        submittedUrl,
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: null,
        finishedAt: timestamp,
        error: { code: validation.code, message: validation.reason },
        report: null,
        schemaVersion: JOB_SCHEMA_VERSION,
      };

      await store.create(job);
      log.info("api.analysis_refused", { status, code: validation.code });

      return json(
        {
          ...apiError(
            status === "blocked" ? "blocked" : "invalid_url",
            validation.reason,
            { reason: validation.code },
          ),
          job: toAnalysisJobDto(job),
        },
        STATUS_FOR_CODE[status === "blocked" ? "blocked" : "invalid_url"],
      );
    }

    const job: AnalysisJob = {
      id: createJobId(),
      status: "queued",
      url: validation.normalizedUrl,
      submittedUrl,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      error: null,
      report: null,
      schemaVersion: JOB_SCHEMA_VERSION,
    };

    await store.create(job);
    log.info("api.analysis_queued", { id: job.id, url: job.url });

    // Deliberately not awaited: the response is the point of an async API.
    const execution = executeJob(job.id, validation.normalizedUrl, {
      ...deps,
      store,
      logger: log,
    });

    deps.onStarted?.(execution);

    return json({ job: toAnalysisJobDto(job) }, 202);
  } catch (cause) {
    log.error("api.analysis_create_failed", {
      message: cause instanceof Error ? cause.message : String(cause),
    });

    return errorResponse("internal_error", INTERNAL_ERROR_MESSAGE);
  }
}

/**
 * Run a job to a terminal state.
 *
 * Never throws: it is not awaited by anything that could catch it, so an
 * escaping rejection would become an unhandled rejection and, depending on the
 * runtime, take the process with it.
 */
async function executeJob(
  id: string,
  url: string,
  deps: AnalysisApiDeps & { store: JobStore },
): Promise<void> {
  const log = deps.logger ?? createLogger("api.analyze");
  const run = deps.runner ?? runAnalysis;
  const now = deps.now ?? (() => new Date());

  try {
    await deps.store.update(id, { status: "running", startedAt: now().toISOString() });

    // The URL comes from the stored, validated record — never from a client.
    const outcome = await run(url);

    if (outcome.status === "completed") {
      await deps.store.update(id, {
        status: "completed",
        finishedAt: now().toISOString(),
        report: outcome.report,
        error: null,
      });
      log.info("api.analysis_completed", { id });
      return;
    }

    await deps.store.update(id, {
      status: outcome.status,
      finishedAt: now().toISOString(),
      error: { code: outcome.code, message: outcome.message },
      report: null,
    });
    log.info("api.analysis_ended", { id, status: outcome.status, code: outcome.code });
  } catch (cause) {
    // The detail goes to the log. The client is told an analysis failed, which
    // is true and is all anybody outside this process needs to know.
    log.error("api.analysis_crashed", {
      id,
      message: cause instanceof Error ? cause.message : String(cause),
    });

    await deps.store
      .update(id, {
        status: "failed",
        finishedAt: now().toISOString(),
        error: {
          code: "internal_error",
          message: "The analysis stopped because of an internal error.",
        },
        report: null,
      })
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// GET — retrieve an analysis
// ---------------------------------------------------------------------------

/**
 * Fetch one job.
 *
 * A malformed id is reported as `not_found` rather than as a validation error.
 * Distinguishing "that is not a job id" from "no such job" would tell an
 * enumerating client which of its guesses were the right shape, and there is
 * nothing to gain from the distinction: neither is a job.
 */
export async function handleGetAnalysis(
  id: string,
  deps: AnalysisApiDeps = {},
): Promise<Response> {
  const log = deps.logger ?? createLogger("api.analyze");

  try {
    if (!isJobId(id)) {
      return errorResponse("not_found", "No analysis was found with that id.");
    }

    const store = deps.store ?? getJobStore();
    const job = await store.get(id);

    if (job === null) {
      return errorResponse("not_found", "No analysis was found with that id.");
    }

    return json({ job: toAnalysisJobDto(job) }, 200);
  } catch (cause) {
    log.error("api.analysis_read_failed", {
      message: cause instanceof Error ? cause.message : String(cause),
    });

    return errorResponse("internal_error", INTERNAL_ERROR_MESSAGE);
  }
}
