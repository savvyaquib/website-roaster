/**
 * Integration tests for the analysis API.
 *
 * These drive the same functions the route files call, with real `Request`
 * objects and a real job store, so the request path under test is the one that
 * runs in production. Only two things are substituted: the store is in-memory,
 * and the pipeline runner is a stub — a test that fetched a live website would
 * be testing the internet.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryJobStore } from "@/lib/jobs";
import type { AnalysisJob, MemoryJobStore } from "@/lib/jobs";
import type { AnalysisOutcome, AnalysisRunner } from "@/lib/pipeline";
import { createLogger } from "@/lib/observability/logger";

import {
  handleCreateAnalysis,
  handleGetAnalysis,
  MAX_BODY_BYTES,
} from "./analysis-service";

const silent = createLogger("test", { level: "silent" });

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A runner that always produces `outcome`, recording what it was asked. */
function stubRunner(outcome: AnalysisOutcome, spy = vi.fn()): AnalysisRunner {
  return (url) => {
    spy(url);
    return Promise.resolve(outcome);
  };
}

const completed: AnalysisOutcome = {
  status: "completed",
  report: {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    httpStatus: 200,
    findings: [],
    score: {
      scoringVersion: 1,
      overall: {
        score: 72,
        grade: "C",
        weighting: [],
        assessedCategories: [],
        notAssessedCategories: [],
        explanation: "x",
      },
      categories: [],
    },
    recommendations: {
      recommendations: [],
      weightBasis: "effective",
      summary: {
        total: 0,
        fixes: 0,
        needsReview: 0,
        byLevel: { high: 0, medium: 0, low: 0, none: 0 },
        byTier: { 1: 0, 2: 0, 3: 0, 4: 0 },
        byCategory: {},
        recoverablePoints: 0,
        unquantified: 0,
        passingFindings: 0,
      },
    },
    roast: {
      lines: [],
      source: "deterministic",
      fallbackReason: null,
      note: null,
      meta: null,
    },
    interpretation: null,
    interpretationUnavailableReason: "AI was not used for this analysis.",
    notRun: ["accessibility", "performance", "mobile"],
    durationMs: 12,
  },
};

/** Run one analysis to completion, returning the create response and the job. */
async function analyse(
  url: unknown,
  outcome: AnalysisOutcome = completed,
  runnerSpy = vi.fn(),
): Promise<{ store: MemoryJobStore; response: Response; body: Record<string, never> }> {
  const store = createMemoryJobStore();
  let execution: Promise<void> | undefined;

  const response = await handleCreateAnalysis(post({ url }), {
    store,
    logger: silent,
    runner: stubRunner(outcome, runnerSpy),
    onStarted: (promise) => {
      execution = promise;
    },
  });

  await execution;

  return { store, response, body: (await response.json()) as Record<string, never> };
}

function jobOf(body: Record<string, never>): AnalysisJob {
  return (body as unknown as { job: AnalysisJob }).job;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The main workflow
// ---------------------------------------------------------------------------

describe("the main workflow", () => {
  it("accepts a valid URL and returns a queued job", async () => {
    const store = createMemoryJobStore();

    const response = await handleCreateAnalysis(post({ url: "https://example.com" }), {
      store,
      logger: silent,
      runner: stubRunner(completed),
    });

    expect(response.status).toBe(202);

    const job = jobOf((await response.json()) as Record<string, never>);
    expect(job.status).toBe("queued");
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("normalizes the URL it stores", async () => {
    const { body } = await analyse("HTTPS://Example.COM");

    expect(jobOf(body).url).toBe("https://example.com/");
  });

  it("runs the analysis and reaches completed", async () => {
    const { store, body } = await analyse("https://example.com");
    const stored = await store.get(jobOf(body).id);

    expect(stored?.status).toBe("completed");
    expect(stored?.report?.score.overall.score).toBe(72);
  });

  it("records when it started and finished", async () => {
    const { store, body } = await analyse("https://example.com");
    const stored = await store.get(jobOf(body).id);

    expect(stored?.startedAt).not.toBeNull();
    expect(stored?.finishedAt).not.toBeNull();
  });

  it("retrieves the finished analysis by id", async () => {
    const { store, body } = await analyse("https://example.com");

    const response = await handleGetAnalysis(jobOf(body).id, { store, logger: silent });
    expect(response.status).toBe(200);

    const fetched = jobOf((await response.json()) as Record<string, never>);
    expect(fetched.status).toBe("completed");
    expect(fetched.report).not.toBeNull();
  });

  it("tells a client when to stop polling", async () => {
    const { store, body } = await analyse("https://example.com");

    const response = await handleGetAnalysis(jobOf(body).id, { store, logger: silent });
    const fetched = (await response.json()) as { job: { terminal: boolean } };

    expect(fetched.job.terminal).toBe(true);
  });

  it("responds before the analysis finishes", async () => {
    // The point of an asynchronous API: the POST does not wait.
    const store = createMemoryJobStore();
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const response = await handleCreateAnalysis(post({ url: "https://example.com" }), {
      store,
      logger: silent,
      runner: async () => {
        await blocked;
        return completed;
      },
    });

    const job = jobOf((await response.json()) as Record<string, never>);
    expect(response.status).toBe(202);
    expect((await store.get(job.id))?.status).not.toBe("completed");

    release();
  });

  it("never caches a response", async () => {
    const { response } = await analyse("https://example.com");

    // A cached 202 would strand a client on "queued" forever.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns JSON", async () => {
    const { response } = await analyse("https://example.com");

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

// ---------------------------------------------------------------------------
// A client cannot bypass URL validation
// ---------------------------------------------------------------------------

describe("URL validation cannot be bypassed", () => {
  it("runs the analysis against the normalized URL, not the submitted string", async () => {
    const spy = vi.fn();
    await analyse("HTTPS://Example.COM/../", completed, spy);

    // Whatever the client typed, the runner sees the validator's output.
    expect(spy).toHaveBeenCalledWith("https://example.com/");
  });

  it("ignores extra fields a client invents", async () => {
    const store = createMemoryJobStore();
    const spy = vi.fn();
    let execution: Promise<void> | undefined;

    await handleCreateAnalysis(
      post({
        url: "https://example.com",
        normalizedUrl: "http://169.254.169.254/latest/meta-data/",
        status: "completed",
        report: { score: 100 },
      }),
      {
        store,
        logger: silent,
        runner: stubRunner(completed, spy),
        onStarted: (promise) => {
          execution = promise;
        },
      },
    );
    await execution;

    expect(spy).toHaveBeenCalledWith("https://example.com/");
    expect(store.all()[0]?.report?.score.overall.score).toBe(72);
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://metadata.google.internal/",
    "http://0.0.0.0/",
  ])("refuses %s as blocked, and never runs it", async (url) => {
    const spy = vi.fn();
    const { response } = await analyse(url, completed, spy);

    expect(response.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://example.com/",
    "not a url",
    "example.com",
    "",
  ])("refuses %s as invalid, and never runs it", async (url) => {
    const spy = vi.fn();
    const { response } = await analyse(url, completed, spy);

    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls the runner with the URL and nothing else", async () => {
    // runAnalysis takes an options object carrying a network-policy override,
    // which exists only so an end-to-end test can reach 127.0.0.1. This pins
    // that the API never supplies one, so no request can reach it.
    const calls: unknown[][] = [];
    const store = createMemoryJobStore();
    let execution: Promise<void> | undefined;

    await handleCreateAnalysis(post({ url: "https://example.com" }), {
      store,
      logger: silent,
      runner: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(completed);
      },
      onStarted: (promise) => {
        execution = promise;
      },
    });
    await execution;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["https://example.com/"]);
  });

  it("stores no URL at all for a refused submission", async () => {
    const { store } = await analyse("http://127.0.0.1/");

    // Nothing downstream may find an unvalidated value to act on.
    expect(store.all()[0]?.url).toBeNull();
  });

  it("keeps what the user typed, so the refusal can be explained", async () => {
    const { store } = await analyse("not a url");

    expect(store.all()[0]?.submittedUrl).toBe("not a url");
  });
});

// ---------------------------------------------------------------------------
// Refusals are analyses too
// ---------------------------------------------------------------------------

describe("refused submissions", () => {
  it("records an invalid URL as an invalid_url job", async () => {
    const { store, body } = await analyse("not a url");

    expect(store.all()[0]?.status).toBe("invalid_url");
    expect(jobOf(body).status).toBe("invalid_url");
  });

  it("records a blocked URL as a blocked job", async () => {
    const { store } = await analyse("http://169.254.169.254/");

    expect(store.all()[0]?.status).toBe("blocked");
  });

  it("returns the structured error alongside the job", async () => {
    const { body } = await analyse("http://127.0.0.1/");
    const parsed = body as unknown as {
      error: { code: string; message: string; details: { reason: string } };
    };

    expect(parsed.error.code).toBe("blocked");
    expect(parsed.error.message.length).toBeGreaterThan(0);
    expect(parsed.error.details.reason).toBe("loopback");
  });

  it("makes a refusal retrievable like any other analysis", async () => {
    const { store, body } = await analyse("not a url");

    const response = await handleGetAnalysis(jobOf(body).id, { store, logger: silent });

    expect(response.status).toBe(200);
    expect(jobOf((await response.json()) as Record<string, never>).status).toBe(
      "invalid_url",
    );
  });

  it("finishes a refusal immediately", async () => {
    const { store } = await analyse("not a url");

    expect(store.all()[0]?.finishedAt).not.toBeNull();
    expect(store.all()[0]?.startedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Malformed requests
// ---------------------------------------------------------------------------

describe("malformed requests", () => {
  async function create(body: unknown, headers?: Record<string, string>) {
    const response = await handleCreateAnalysis(post(body, headers), {
      store: createMemoryJobStore(),
      logger: silent,
      runner: stubRunner(completed),
    });

    return {
      response,
      body: (await response.json()) as { error: { code: string; message: string } },
    };
  }

  it("refuses a body that is not JSON", async () => {
    const { response, body } = await create("{not json");

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_json");
  });

  it.each([
    ["an array", []],
    ["a string", '"https://example.com"'],
    ["a number", "42"],
    ["null", "null"],
  ])("refuses %s as the body", async (_name, value) => {
    const { response, body } = await create(value);

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_body");
  });

  it("refuses a missing url", async () => {
    const { response, body } = await create({});

    // An absent url is an invalid url, not an invalid body: the shape was fine.
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_url");
  });

  it.each([
    ["a number", 42],
    ["null", null],
    ["an object", { href: "x" }],
  ])("refuses a url that is %s", async (_name, url) => {
    const { response, body } = await create({ url });

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_url");
  });

  it("refuses an oversized body by its declared length", async () => {
    const { response, body } = await create(
      { url: "https://example.com" },
      { "content-length": String(MAX_BODY_BYTES + 1) },
    );

    expect(response.status).toBe(413);
    expect(body.error.code).toBe("payload_too_large");
  });

  it("refuses an oversized body whose declared length lied", async () => {
    // content-length is a claim, not a guarantee.
    const { response, body } = await create(
      { url: `https://example.com/${"x".repeat(MAX_BODY_BYTES)}` },
      { "content-length": "10" },
    );

    expect(response.status).toBe(413);
    expect(body.error.code).toBe("payload_too_large");
  });
});

// ---------------------------------------------------------------------------
// Failures during analysis
// ---------------------------------------------------------------------------

describe("failures during the analysis", () => {
  it.each([
    ["failed", "dns_failure", "The host could not be resolved."],
    ["timeout", "timeout", "The page took too long."],
    ["blocked", "blocked_address", "A redirect led somewhere private."],
  ] as const)("records a %s outcome", async (status, code, message) => {
    const { store, body } = await analyse("https://example.com", {
      status,
      code,
      message,
    });

    const stored = await store.get(jobOf(body).id);

    expect(stored?.status).toBe(status);
    expect(stored?.error).toEqual({ code, message });
    expect(stored?.report).toBeNull();
  });

  it("keeps a mid-analysis block distinct from a refused submission", async () => {
    // A redirect into private space is discovered while running, not at POST.
    const { store, body } = await analyse("https://example.com", {
      status: "blocked",
      code: "blocked_address",
      message: "A redirect led somewhere private.",
    });

    const stored = await store.get(jobOf(body).id);

    expect(stored?.status).toBe("blocked");
    expect(stored?.url).toBe("https://example.com/");
    expect(stored?.startedAt).not.toBeNull();
  });

  it("marks a job failed when the runner throws", async () => {
    const store = createMemoryJobStore();
    let execution: Promise<void> | undefined;

    const response = await handleCreateAnalysis(post({ url: "https://example.com" }), {
      store,
      logger: silent,
      runner: () => Promise.reject(new Error("secret internal detail: /etc/passwd")),
      onStarted: (promise) => {
        execution = promise;
      },
    });

    await execution;

    const job = jobOf((await response.json()) as Record<string, never>);
    const stored = await store.get(job.id);

    expect(stored?.status).toBe("failed");
    expect(stored?.error?.code).toBe("internal_error");
  });

  it("never leaks an internal message into a stored job", async () => {
    const store = createMemoryJobStore();
    let execution: Promise<void> | undefined;

    await handleCreateAnalysis(post({ url: "https://example.com" }), {
      store,
      logger: silent,
      runner: () => Promise.reject(new Error("secret internal detail: /etc/passwd")),
      onStarted: (promise) => {
        execution = promise;
      },
    });
    await execution;

    expect(JSON.stringify(store.all())).not.toContain("/etc/passwd");
  });

  it("does not reject when the runner throws", async () => {
    // An unhandled rejection from an un-awaited promise can take the process
    // down, which would turn one bad analysis into an outage.
    const store = createMemoryJobStore();
    let execution: Promise<void> | undefined;

    await handleCreateAnalysis(post({ url: "https://example.com" }), {
      store,
      logger: silent,
      runner: () => Promise.reject(new Error("boom")),
      onStarted: (promise) => {
        execution = promise;
      },
    });

    await expect(execution).resolves.toBeUndefined();
  });

  it("returns 500 with no detail when the store fails", async () => {
    const broken = {
      create: () => Promise.reject(new Error("disk on fire at /var/data")),
      get: () => Promise.resolve(null),
      update: () => Promise.resolve(null),
    };

    const response = await handleCreateAnalysis(post({ url: "https://example.com" }), {
      store: broken,
      logger: silent,
      runner: stubRunner(completed),
    });

    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).not.toContain("/var/data");
    expect(body.error.message).not.toContain("disk on fire");
  });

  it("returns 500 with no detail when a read fails", async () => {
    const broken = {
      create: () => Promise.resolve(),
      get: () => Promise.reject(new Error("disk on fire at /var/data")),
      update: () => Promise.resolve(null),
    };

    const response = await handleGetAnalysis("00000000-0000-4000-8000-000000000000", {
      store: broken,
      logger: silent,
    });

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("/var/data");
  });
});

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

describe("retrieving an analysis", () => {
  it("returns 404 for an id that does not exist", async () => {
    const response = await handleGetAnalysis("00000000-0000-4000-8000-000000000000", {
      store: createMemoryJobStore(),
      logger: silent,
    });

    expect(response.status).toBe(404);
  });

  it.each([
    "not-an-id",
    "../../../etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    "00000000-0000-4000-8000-000000000000.json",
    "",
    "0",
  ])("returns 404 for the malformed id %s", async (id) => {
    const response = await handleGetAnalysis(id, {
      store: createMemoryJobStore(),
      logger: silent,
    });

    // Not a validation error: telling an enumerating client which guesses were
    // the right shape helps only the client.
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "not_found",
    );
  });

  it("never reaches the store for a malformed id", async () => {
    const spy = vi.fn(() => Promise.resolve(null));

    await handleGetAnalysis("../../etc/passwd", {
      store: {
        create: () => Promise.resolve(),
        get: spy,
        update: () => Promise.resolve(null),
      },
      logger: silent,
    });

    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// What a response may contain
// ---------------------------------------------------------------------------

describe("responses expose nothing internal", () => {
  it("returns exactly the documented fields", async () => {
    const { body } = await analyse("https://example.com");

    expect(Object.keys(jobOf(body)).sort()).toEqual([
      "createdAt",
      "error",
      "finishedAt",
      "id",
      "report",
      "startedAt",
      "status",
      "submittedUrl",
      "terminal",
      "updatedAt",
      "url",
    ]);
  });

  it("does not expose the stored schema version", async () => {
    // An internal storage concern, not something a client acts on.
    const { body } = await analyse("https://example.com");

    expect(jobOf(body)).not.toHaveProperty("schemaVersion");
  });

  it("carries no environment values", async () => {
    process.env.WEBSITE_ROASTER_TEST_SECRET = "super-secret-value";

    try {
      const { body } = await analyse("https://example.com");

      expect(JSON.stringify(body)).not.toContain("super-secret-value");
      expect(JSON.stringify(body)).not.toContain("AI_API_KEY");
    } finally {
      delete process.env.WEBSITE_ROASTER_TEST_SECRET;
    }
  });

  it("carries no stack traces or absolute paths", async () => {
    const { body } = await analyse("https://example.com");
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain("at Object.");
    expect(serialised).not.toContain(process.cwd());
  });
});
